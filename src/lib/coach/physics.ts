import type { IbtParsed } from "@/lib/ibt/types";

/**
 * Derive compact physics summaries from the already-parsed telemetry.
 * All numbers come from real samples — no fabrication. We slim them
 * aggressively because the AI payload has a hard size cap.
 */

const G = 9.80665;
const BRAKE_ON = 0.18;
const BRAKE_OFF = 0.08;

export interface GGSummary {
  peakLatG: number;
  peakAccelG: number;
  peakBrakeG: number;
  combinedG: number; // sqrt(latPeak^2 + max(accel,brake)^2)
  envelope: number[]; // 12 angular bins, max |g|
}

export interface BrakeSummary {
  peakG: number;
  slopeGPer100: number; // empirical g per 100% pedal
  r2: number;
  linearity: "linear" | "fair" | "noisy";
  pedalBins: (number | null)[]; // 10 bins, median g
  bias?: { avgFront: number; min: number; max: number };
}

export interface SlipSummary {
  peakBetaDeg: number;
  meanBetaLeftHighG: number | null; // β at ay > 0.6g (left turns)
  meanBetaRightHighG: number | null; // β at ay < -0.6g (sign-flipped)
  balance: "neutral" | "loose" | "tight";
  overallDeg: number;
}

export interface CounterfactualSummary {
  zones: Array<{
    startPct: number;
    endPct: number;
    refLap: number;
    bestLap: number;
    gainS: number;
    confidence: number;
    refReleasePct: number | null;
    bestReleasePct: number | null;
    refApexSpeed: number;
    bestApexSpeed: number;
    refExitSpeed: number;
    bestExitSpeed: number;
  }>;
  realisableGainS: number; // sum of high-confidence positive gains
}

export interface PhysicsSummary {
  refLap: number | null;
  gg?: GGSummary;
  brake?: BrakeSummary;
  slip?: SlipSummary;
  counterfactual?: CounterfactualSummary;
}

function pickRange(parsed: IbtParsed, refLap: number | null): { a: number; b: number } {
  if (refLap != null) {
    const l = parsed.laps.find((x) => x.lap === refLap);
    if (l) return { a: l.startTick, b: l.endTick };
  }
  const fastest = parsed.laps
    .filter((l) => l.timeS > 5)
    .reduce<typeof parsed.laps[number] | null>(
      (best, l) => (best == null || l.timeS < best.timeS ? l : best),
      null,
    );
  if (fastest) return { a: fastest.startTick, b: fastest.endTick };
  return { a: 0, b: parsed.meta.numTicks };
}

function ggSummary(parsed: IbtParsed, a: number, b: number): GGSummary | undefined {
  const lat = parsed.channels["LatAccel"]?.data;
  const lon = parsed.channels["LongAccel"]?.data;
  if (!lat || !lon) return undefined;
  const BINS = 12;
  const env = new Array(BINS).fill(0);
  let pLat = 0, pAcc = 0, pBrk = 0;
  for (let t = a; t < b; t++) {
    const x = lat[t] / G;
    const y = lon[t] / G;
    const ax = Math.abs(x);
    if (ax > pLat) pLat = ax;
    if (y > pAcc) pAcc = y;
    if (-y > pBrk) pBrk = -y;
    const r = Math.hypot(x, y);
    if (r < 0.05) continue;
    let ang = Math.atan2(y, x);
    if (ang < 0) ang += Math.PI * 2;
    const bi = Math.min(BINS - 1, Math.floor((ang / (Math.PI * 2)) * BINS));
    if (r > env[bi]) env[bi] = r;
  }
  return {
    peakLatG: +pLat.toFixed(2),
    peakAccelG: +pAcc.toFixed(2),
    peakBrakeG: +pBrk.toFixed(2),
    combinedG: +Math.hypot(pLat, Math.max(pAcc, pBrk)).toFixed(2),
    envelope: env.map((v) => +v.toFixed(2)),
  };
}

function brakeSummary(parsed: IbtParsed, a: number, b: number): BrakeSummary | undefined {
  const brake = parsed.channels["Brake"]?.data;
  const lon = parsed.channels["LongAccel"]?.data;
  if (!brake || !lon) return undefined;
  const BINS = 10;
  const buckets: number[][] = Array.from({ length: BINS }, () => []);
  let peak = 0;
  let n = 0;
  for (let t = a; t < b; t++) {
    const bv = brake[t];
    if (bv < 0.05) continue;
    const decel = -lon[t] / G;
    if (!isFinite(decel) || decel < 0) continue;
    n++;
    const bi = Math.min(BINS - 1, Math.floor(bv * BINS));
    buckets[bi].push(decel);
    if (bv >= 0.9 && decel > peak) peak = decel;
  }
  if (n < 30) return undefined;
  const medians: (number | null)[] = buckets.map((arr) => {
    if (arr.length < 4) return null;
    const s = arr.slice().sort((p, q) => p - q);
    return +s[Math.floor(s.length / 2)].toFixed(2);
  });
  const pts: { x: number; y: number }[] = [];
  medians.forEach((m, i) => { if (m != null) pts.push({ x: (i + 0.5) / BINS, y: m }); });
  let slope = 0, intercept = 0, r2 = 0;
  if (pts.length >= 3) {
    const len = pts.length;
    const sx = pts.reduce((s, p) => s + p.x, 0);
    const sy = pts.reduce((s, p) => s + p.y, 0);
    const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sxx = pts.reduce((s, p) => s + p.x * p.x, 0);
    slope = (len * sxy - sx * sy) / (len * sxx - sx * sx);
    intercept = (sy - slope * sx) / len;
    const ymean = sy / len;
    let ssr = 0, sst = 0;
    for (const p of pts) {
      const yhat = slope * p.x + intercept;
      ssr += (p.y - yhat) ** 2;
      sst += (p.y - ymean) ** 2;
    }
    r2 = sst > 0 ? Math.max(0, 1 - ssr / sst) : 0;
  }
  const linearity = r2 >= 0.9 ? "linear" : r2 >= 0.7 ? "fair" : "noisy";
  let bias: BrakeSummary["bias"];
  const biasCh = parsed.channels["dcBrakeBias"]?.data;
  if (biasCh) {
    let mn = Infinity, mx = -Infinity, sm = 0, c = 0;
    for (let t = a; t < b; t++) {
      const v = biasCh[t];
      if (!isFinite(v)) continue;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
      sm += v; c++;
    }
    if (c > 0) bias = { avgFront: +(sm / c).toFixed(3), min: +mn.toFixed(3), max: +mx.toFixed(3) };
  }
  return {
    peakG: +peak.toFixed(2),
    slopeGPer100: +slope.toFixed(2),
    r2: +r2.toFixed(2),
    linearity,
    pedalBins: medians,
    bias,
  };
}

function slipSummary(parsed: IbtParsed, a: number, b: number): SlipSummary | undefined {
  const vx = parsed.channels["VelocityX"]?.data;
  const vy = parsed.channels["VelocityY"]?.data;
  const lat = parsed.channels["LatAccel"]?.data;
  if (!vx || !vy || !lat) return undefined;
  const speedCh = parsed.channels["Speed"]?.data;
  let peak = 0;
  let leftSum = 0, leftN = 0, rightSum = 0, rightN = 0;
  let n = 0;
  for (let t = a; t < b; t++) {
    const fwd = vx[t];
    const sd = vy[t];
    const sp = speedCh ? speedCh[t] : Math.hypot(fwd, sd);
    if (sp < 8) continue;
    const beta = Math.atan2(sd, Math.max(0.1, fwd)) * (180 / Math.PI);
    if (Math.abs(beta) > peak) peak = Math.abs(beta);
    n++;
    const ay = lat[t] / G;
    if (ay > 0.6) { leftSum += beta; leftN++; }
    else if (ay < -0.6) { rightSum += beta; rightN++; }
  }
  if (n < 30) return undefined;
  const left = leftN ? leftSum / leftN : null;
  const right = rightN ? -rightSum / rightN : null;
  const overall =
    left != null && right != null ? (left + right) / 2 : (left ?? right ?? 0);
  const balance =
    Math.abs(overall) < 0.5 ? "neutral" : overall > 0 ? "loose" : "tight";
  return {
    peakBetaDeg: +peak.toFixed(2),
    meanBetaLeftHighG: left != null ? +left.toFixed(2) : null,
    meanBetaRightHighG: right != null ? +right.toFixed(2) : null,
    balance,
    overallDeg: +overall.toFixed(2),
  };
}

interface BandStats {
  durationS: number;
  releasePct: number | null;
  apexSpeed: number;
  exitSpeed: number;
  sampleCount: number;
  spanPct: number;
}

function bandStats(
  parsed: IbtParsed,
  startTick: number,
  endTick: number,
  startPct: number,
  endPct: number,
): BandStats | null {
  const sessionTime = parsed.channels["SessionTime"]?.data;
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  const speed = parsed.channels["Speed"]?.data;
  const brake = parsed.channels["Brake"]?.data;
  if (!sessionTime || !lapDistPct || !speed || !brake) return null;
  let tA = -1, tB = -1;
  for (let t = startTick + 1; t <= endTick; t++) {
    const prev = lapDistPct[t - 1];
    const cur = lapDistPct[t];
    if (cur < prev) continue;
    if (tA < 0 && prev <= startPct && cur >= startPct) tA = t;
    if (tA >= 0 && prev <= endPct && cur >= endPct) { tB = t; break; }
  }
  if (tA < 0 || tB < 0 || tB <= tA) return null;
  let minSpeed = Infinity;
  let release: number | null = null;
  let n = 0;
  for (let t = tA; t <= tB; t++) {
    const s = speed[t];
    if (s < minSpeed) minSpeed = s;
    if (release == null && brake[t] < BRAKE_OFF && t > tA + 2) release = lapDistPct[t];
    n++;
  }
  return {
    durationS: sessionTime[tB] - sessionTime[tA],
    releasePct: release,
    apexSpeed: minSpeed === Infinity ? 0 : minSpeed,
    exitSpeed: speed[tB],
    sampleCount: n,
    spanPct: lapDistPct[tB] - lapDistPct[tA],
  };
}

function counterfactualSummary(
  parsed: IbtParsed,
  refLapNum: number,
): CounterfactualSummary | undefined {
  const brake = parsed.channels["Brake"]?.data;
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  if (!brake || !lapDistPct || parsed.laps.length < 2) return undefined;
  const ref = parsed.laps.find((l) => l.lap === refLapNum);
  if (!ref) return undefined;
  // detect zones in ref
  const zones: { startPct: number; endPct: number }[] = [];
  let inZone = false;
  let s = 0;
  for (let t = ref.startTick; t <= ref.endTick; t++) {
    const b = brake[t] ?? 0;
    const p = lapDistPct[t];
    if (!isFinite(p)) continue;
    if (!inZone && b > BRAKE_ON) { inZone = true; s = p; }
    else if (inZone && b < BRAKE_OFF) {
      if (p > s && p - s > 0.005) zones.push({ startPct: s, endPct: Math.min(1, p + 0.04) });
      inZone = false;
    }
  }
  if (zones.length === 0) return { zones: [], realisableGainS: 0 };
  const out: CounterfactualSummary["zones"] = [];
  let realisable = 0;
  for (const z of zones) {
    const refSt = bandStats(parsed, ref.startTick, ref.endTick, z.startPct, z.endPct);
    if (!refSt) continue;
    let best: { lap: number; st: BandStats } | null = null;
    for (const other of parsed.laps) {
      if (other.lap === ref.lap || other.timeS < 5) continue;
      const st = bandStats(parsed, other.startTick, other.endTick, z.startPct, z.endPct);
      if (!st) continue;
      if (!best || st.durationS < best.st.durationS) best = { lap: other.lap, st };
    }
    if (!best) continue;
    const gainS = +(refSt.durationS - best.st.durationS).toFixed(3);
    const span = z.endPct - z.startPct;
    const density = Math.min(1, Math.min(refSt.sampleCount, best.st.sampleCount) / 60);
    const cov = Math.min(
      span > 0 ? Math.min(1, refSt.spanPct / span) : 0,
      span > 0 ? Math.min(1, best.st.spanPct / span) : 0,
    );
    const sig = Math.min(1, Math.abs(gainS) / 0.1);
    const confidence = +(0.4 * density + 0.4 * cov + 0.2 * sig).toFixed(2);
    if (confidence < 0.35) continue;
    out.push({
      startPct: +z.startPct.toFixed(3),
      endPct: +z.endPct.toFixed(3),
      refLap: ref.lap,
      bestLap: best.lap,
      gainS,
      confidence,
      refReleasePct: refSt.releasePct,
      bestReleasePct: best.st.releasePct,
      refApexSpeed: +refSt.apexSpeed.toFixed(1),
      bestApexSpeed: +best.st.apexSpeed.toFixed(1),
      refExitSpeed: +refSt.exitSpeed.toFixed(1),
      bestExitSpeed: +best.st.exitSpeed.toFixed(1),
    });
    if (gainS > 0 && confidence >= 0.6) realisable += gainS;
  }
  out.sort((a, b) => b.gainS * b.confidence - a.gainS * a.confidence);
  return { zones: out.slice(0, 8), realisableGainS: +realisable.toFixed(3) };
}

export function buildPhysicsSummary(parsed: IbtParsed, refLap: number | null): PhysicsSummary {
  const { a, b } = pickRange(parsed, refLap);
  // resolve actual ref lap number for counterfactual
  let refLapNum: number | null = refLap;
  if (refLapNum == null) {
    const fastest = parsed.laps
      .filter((l) => l.timeS > 5)
      .reduce<typeof parsed.laps[number] | null>(
        (best, l) => (best == null || l.timeS < best.timeS ? l : best),
        null,
      );
    refLapNum = fastest?.lap ?? null;
  }
  return {
    refLap: refLapNum,
    gg: ggSummary(parsed, a, b),
    brake: brakeSummary(parsed, a, b),
    slip: slipSummary(parsed, a, b),
    counterfactual: refLapNum != null ? counterfactualSummary(parsed, refLapNum) : undefined,
  };
}