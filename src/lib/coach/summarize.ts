import type { IbtParsed, IbtLap } from "@/lib/ibt/types";
import type { PhysicsSummary } from "@/lib/coach/physics";

const NUM_BINS = 60; // distance bins along the lap (LapDistPct)
const NUM_SECTORS = 3;

export interface LapSummary {
  lap: number;
  timeS: number;
  sectors: (number | null)[]; // seconds per sector
  // Per-bin samples along the lap (length NUM_BINS)
  speed: number[]; // m/s or whatever the unit is in source
  throttle: number[]; // 0..1
  brake: number[]; // 0..1
  rpm?: number[];
  gear?: number[];
  steer?: number[]; // rad
  // Derived events
  brakeZones: { startPct: number; endPct: number; peakBrake: number; minSpeed: number; entrySpeed: number }[];
  fullThrottlePct: number; // % of lap at >95% throttle
  coastingPct: number; // % of lap at <5% throttle and <5% brake
  overlapPct: number; // % of lap with both throttle > 10% and brake > 10%
  maxSpeed: number;
  minSpeed: number;
}

export interface SessionSummary {
  track?: string;
  car?: string;
  speedUnit: string;
  bestLapS: number | null;
  bestSectors: (number | null)[];
  lapCount: number;
  laps: LapSummary[];
}

function resampleByDist(
  data: Float32Array | undefined,
  lapDistPct: Float32Array,
  lap: IbtLap,
  bins: number,
): number[] | undefined {
  if (!data) return undefined;
  // Build monotonic samples (skip wrap)
  const samples: { p: number; v: number }[] = [];
  for (let t = lap.startTick; t <= lap.endTick; t++) {
    const p = lapDistPct[t];
    if (!isFinite(p)) continue;
    if (samples.length === 0 || p >= samples[samples.length - 1].p - 0.05) {
      samples.push({ p: Math.min(1, Math.max(0, p)), v: data[t] });
    }
  }
  if (samples.length < 10) return undefined;
  const out = new Array(bins);
  let j = 0;
  for (let i = 0; i < bins; i++) {
    const target = i / (bins - 1);
    while (j < samples.length - 2 && samples[j + 1].p < target) j++;
    const a = samples[j];
    const b = samples[j + 1] ?? a;
    const span = b.p - a.p;
    const f = span > 0 ? (target - a.p) / span : 0;
    out[i] = +(a.v + (b.v - a.v) * f).toFixed(3);
  }
  return out;
}

function detectBrakeZones(brake: number[], speed: number[]): LapSummary["brakeZones"] {
  const zones: LapSummary["brakeZones"] = [];
  const thr = 0.15;
  let inZone = false;
  let start = 0;
  let entrySpeed = 0;
  let peak = 0;
  for (let i = 0; i < brake.length; i++) {
    const b = brake[i];
    if (!inZone && b > thr) {
      inZone = true;
      start = i;
      entrySpeed = speed[i] ?? 0;
      peak = b;
    } else if (inZone) {
      if (b > peak) peak = b;
      if (b < thr * 0.5) {
        const slice = speed.slice(start, i + 1);
        const minSpeed = slice.length ? Math.min(...slice) : 0;
        zones.push({
          startPct: +(start / (brake.length - 1)).toFixed(3),
          endPct: +(i / (brake.length - 1)).toFixed(3),
          peakBrake: +peak.toFixed(2),
          minSpeed: +minSpeed.toFixed(1),
          entrySpeed: +entrySpeed.toFixed(1),
        });
        inZone = false;
      }
    }
  }
  return zones;
}

function lapSectorTimes(parsed: IbtParsed, lap: IbtLap): (number | null)[] {
  const sessionTime = parsed.channels["SessionTime"]?.data;
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  const out: (number | null)[] = [null, null, null];
  if (!sessionTime || !lapDistPct) return out;
  const boundaries: number[] = [];
  for (let s = 1; s < NUM_SECTORS; s++) {
    const target = s / NUM_SECTORS;
    for (let t = lap.startTick + 1; t <= lap.endTick; t++) {
      const prev = lapDistPct[t - 1];
      const cur = lapDistPct[t];
      if (cur >= prev && prev <= target && cur >= target) {
        boundaries.push(t);
        break;
      }
    }
  }
  if (boundaries.length !== NUM_SECTORS - 1) return out;
  const t0 = sessionTime[lap.startTick];
  const t1 = sessionTime[boundaries[0]];
  const t2 = sessionTime[boundaries[1]];
  const t3 = sessionTime[lap.endTick];
  out[0] = +(t1 - t0).toFixed(3);
  out[1] = +(t2 - t1).toFixed(3);
  out[2] = +(t3 - t2).toFixed(3);
  return out;
}

function summarizeLap(parsed: IbtParsed, lap: IbtLap): LapSummary | null {
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  if (!lapDistPct) return null;
  if (lap.endTick - lap.startTick < 60) return null;

  const speedRaw = resampleByDist(parsed.channels["Speed"]?.data, lapDistPct, lap, NUM_BINS);
  const throttle = resampleByDist(parsed.channels["Throttle"]?.data, lapDistPct, lap, NUM_BINS);
  const brake = resampleByDist(parsed.channels["Brake"]?.data, lapDistPct, lap, NUM_BINS);
  if (!speedRaw || !throttle || !brake) return null;
  const rpm = resampleByDist(parsed.channels["RPM"]?.data, lapDistPct, lap, NUM_BINS);
  const gear = resampleByDist(parsed.channels["Gear"]?.data, lapDistPct, lap, NUM_BINS);
  const steer = resampleByDist(parsed.channels["SteeringWheelAngle"]?.data, lapDistPct, lap, NUM_BINS);

  const fullThrottle = throttle.filter((v) => v > 0.95).length / throttle.length;
  const coasting = throttle.filter((v, i) => v < 0.05 && brake[i] < 0.05).length / throttle.length;
  const overlap = throttle.filter((v, i) => v > 0.1 && brake[i] > 0.1).length / throttle.length;

  return {
    lap: lap.lap,
    timeS: +lap.timeS.toFixed(3),
    sectors: lapSectorTimes(parsed, lap),
    speed: speedRaw,
    throttle: throttle.map((v) => +v.toFixed(3)),
    brake: brake.map((v) => +v.toFixed(3)),
    rpm,
    gear: gear?.map((v) => Math.round(v)),
    steer: steer?.map((v) => +v.toFixed(2)),
    brakeZones: detectBrakeZones(brake, speedRaw),
    fullThrottlePct: +(fullThrottle * 100).toFixed(1),
    coastingPct: +(coasting * 100).toFixed(1),
    overlapPct: +(overlap * 100).toFixed(1),
    maxSpeed: +Math.max(...speedRaw).toFixed(1),
    minSpeed: +Math.min(...speedRaw).toFixed(1),
  };
}

export function buildSessionSummary(
  parsed: IbtParsed,
  trackName?: string,
  carName?: string,
): SessionSummary {
  const speedUnit = parsed.channels["Speed"]?.unit ?? "m/s";
  const summaries: LapSummary[] = [];
  for (const lap of parsed.laps) {
    const s = summarizeLap(parsed, lap);
    if (s && s.timeS > 5) summaries.push(s);
  }
  // best per sector
  const bestSectors: (number | null)[] = [null, null, null];
  for (const s of summaries) {
    s.sectors.forEach((t, i) => {
      if (t == null) return;
      if (bestSectors[i] == null || t < (bestSectors[i] as number)) bestSectors[i] = t;
    });
  }
  const bestLapS = summaries.reduce<number | null>(
    (best, s) => (best == null || s.timeS < best ? s.timeS : best),
    null,
  );
  return {
    track: trackName,
    car: carName,
    speedUnit,
    bestLapS,
    bestSectors,
    lapCount: summaries.length,
    laps: summaries,
  };
}

export type CoachMode = "single" | "compare" | "session";

export interface HistoricalContextLap {
  sessionName?: string;
  recordedAt?: string | null;
  lapTimeS: number;
  bestLapS?: number | null;
  sectors?: (number | null)[];
}
export interface HistoricalContext {
  track?: string | null;
  car?: string | null;
  totalSessions: number;
  bestEverS: number | null;
  recentBestS: number | null; // best among last few sessions
  laps: HistoricalContextLap[]; // top N fastest laps across history
  trend?: "improving" | "regressing" | "flat" | null;
}

/** Build the payload sent to the AI server function. Trims to keep tokens low. */
export function buildCoachPayload(
  summary: SessionSummary,
  mode: CoachMode,
  refLap: number | null,
  cmpLap: number | null,
  detailed: boolean,
  physics?: PhysicsSummary,
  history?: HistoricalContext | null,
) {
  if (mode === "single") {
    const lap =
      summary.laps.find((l) => l.lap === refLap) ??
      summary.laps.reduce((best, l) => (l.timeS < best.timeS ? l : best), summary.laps[0]);
    return {
      mode,
      detailed,
      track: summary.track,
      car: summary.car,
      speedUnit: summary.speedUnit,
      bestSectors: summary.bestSectors,
      lap,
      physics,
      history,
    };
  }
  if (mode === "compare") {
    const a = summary.laps.find((l) => l.lap === refLap) ?? summary.laps[0];
    const b =
      summary.laps.find((l) => l.lap === cmpLap) ??
      summary.laps.find((l) => l.lap !== a?.lap) ??
      a;
    return {
      mode,
      detailed,
      track: summary.track,
      car: summary.car,
      speedUnit: summary.speedUnit,
      bestSectors: summary.bestSectors,
      lapA: a,
      lapB: b,
      physics,
      history,
    };
  }
  // session: send slim per-lap stats only (no per-bin arrays) plus best lap full data
  const best = summary.laps.reduce(
    (b, l) => (l.timeS < b.timeS ? l : b),
    summary.laps[0],
  );
  const slim = summary.laps.map((l) => ({
    lap: l.lap,
    timeS: l.timeS,
    sectors: l.sectors,
    fullThrottlePct: l.fullThrottlePct,
    coastingPct: l.coastingPct,
    overlapPct: l.overlapPct,
    maxSpeed: l.maxSpeed,
    minSpeed: l.minSpeed,
  }));
  return {
    mode,
    detailed,
    track: summary.track,
    car: summary.car,
    speedUnit: summary.speedUnit,
    bestSectors: summary.bestSectors,
    bestLap: best,
    laps: slim,
    physics,
    history,
  };
}