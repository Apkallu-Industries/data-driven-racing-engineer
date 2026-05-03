import { useMemo } from "react";
import type { IbtParsed, IbtLap } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { TrendingDown, TrendingUp, MapPin } from "lucide-react";

/**
 * Counterfactual coach. Strictly measured — no physics fabrication.
 * For each brake zone in the reference lap, find which OTHER recorded lap
 * was actually faster through that same LapDistPct band, then surface the
 * real measured differences: brake-release distance (m), apex min speed,
 * throttle re-application, and the measured time delta over that band.
 */

const BRAKE_ON = 0.18;
const BRAKE_OFF = 0.08;
const MIN_ZONE_TICKS = 8;

interface BrakeZone {
  startPct: number;
  endPct: number;
  // Extend window slightly past brake release so we capture exit speed/throttle
  windowEndPct: number;
}

interface BandStats {
  lap: number;
  durationS: number;
  brakeReleasePct: number | null;
  brakePeak: number;
  apexMinSpeed: number;
  throttleOnPct: number | null; // pct where throttle first crosses 50%
  exitSpeed: number;
}

function findBrakeZones(
  brake: Float32Array,
  lapDistPct: Float32Array,
  lap: IbtLap,
): BrakeZone[] {
  const out: BrakeZone[] = [];
  let inZone = false;
  let startPct = 0;
  for (let t = lap.startTick; t <= lap.endTick; t++) {
    const b = brake[t] ?? 0;
    const p = lapDistPct[t];
    if (!isFinite(p)) continue;
    if (!inZone && b > BRAKE_ON) {
      inZone = true;
      startPct = p;
    } else if (inZone && b < BRAKE_OFF) {
      const endPct = p;
      // require minimum span
      if (endPct > startPct && endPct - startPct > 0.005) {
        out.push({
          startPct,
          endPct,
          windowEndPct: Math.min(1, endPct + 0.04),
        });
      }
      inZone = false;
    }
  }
  // Filter trivial zones
  return out.filter((z) => {
    // estimate ticks in zone
    let count = 0;
    for (let t = lap.startTick; t <= lap.endTick; t++) {
      const p = lapDistPct[t];
      if (p >= z.startPct && p <= z.endPct) count++;
      if (count > MIN_ZONE_TICKS) return true;
    }
    return false;
  });
}

function statsForBand(
  parsed: IbtParsed,
  lap: IbtLap,
  startPct: number,
  endPct: number,
): BandStats | null {
  const sessionTime = parsed.channels["SessionTime"]?.data;
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  const speed = parsed.channels["Speed"]?.data;
  const brake = parsed.channels["Brake"]?.data;
  const throttle = parsed.channels["Throttle"]?.data;
  if (!sessionTime || !lapDistPct || !speed || !brake || !throttle) return null;

  let tStart = -1;
  let tEnd = -1;
  for (let t = lap.startTick + 1; t <= lap.endTick; t++) {
    const prev = lapDistPct[t - 1];
    const cur = lapDistPct[t];
    if (cur < prev) continue; // wrap
    if (tStart < 0 && prev <= startPct && cur >= startPct) tStart = t;
    if (tStart >= 0 && prev <= endPct && cur >= endPct) {
      tEnd = t;
      break;
    }
  }
  if (tStart < 0 || tEnd < 0 || tEnd <= tStart) return null;

  let minSpeed = Infinity;
  let peakBrake = 0;
  let releasePct: number | null = null;
  let throttleOnPct: number | null = null;
  let exitSpeed = speed[tEnd];
  for (let t = tStart; t <= tEnd; t++) {
    const s = speed[t];
    if (s < minSpeed) minSpeed = s;
    const b = brake[t];
    if (b > peakBrake) peakBrake = b;
    if (releasePct == null && b < BRAKE_OFF && t > tStart + 2) {
      releasePct = lapDistPct[t];
    }
    if (throttleOnPct == null && throttle[t] > 0.5) {
      throttleOnPct = lapDistPct[t];
    }
  }
  return {
    lap: lap.lap,
    durationS: sessionTime[tEnd] - sessionTime[tStart],
    brakeReleasePct: releasePct,
    brakePeak: peakBrake,
    apexMinSpeed: minSpeed === Infinity ? 0 : minSpeed,
    throttleOnPct,
    exitSpeed,
  };
}

function fmtMeters(deltaPct: number, trackLengthKm?: number): string {
  if (!trackLengthKm) return `${(deltaPct * 100).toFixed(2)}%`;
  const m = deltaPct * trackLengthKm * 1000;
  return `${m >= 0 ? "+" : ""}${m.toFixed(1)} m`;
}

export function Counterfactuals({ parsed }: { parsed: IbtParsed }) {
  const { refLap, setRefLap, setCmpLap, setCursorTick } = useWorkbench();
  const speedUnit = parsed.channels["Speed"]?.unit ?? "m/s";
  const trackLengthKm = parsed.meta.trackLengthKm;

  const analysis = useMemo(() => {
    const brake = parsed.channels["Brake"]?.data;
    const lapDistPct = parsed.channels["LapDistPct"]?.data;
    if (!brake || !lapDistPct || parsed.laps.length < 2) return null;

    // Pick reference lap: explicit refLap, else fastest.
    const ref =
      (refLap != null ? parsed.laps.find((l) => l.lap === refLap) : null) ??
      parsed.laps.reduce((a, b) => (b.timeS > 0 && b.timeS < a.timeS ? b : a), parsed.laps[0]);
    if (!ref) return null;

    const zones = findBrakeZones(brake, lapDistPct, ref);
    if (zones.length === 0) return { ref, items: [] };

    const items = zones
      .map((z, idx) => {
        const refStats = statsForBand(parsed, ref, z.startPct, z.windowEndPct);
        if (!refStats) return null;
        // Compare against every other lap with valid data; pick the one that traversed this band fastest.
        let best: BandStats | null = null;
        for (const other of parsed.laps) {
          if (other.lap === ref.lap) continue;
          if (other.timeS < 5) continue;
          const s = statsForBand(parsed, other, z.startPct, z.windowEndPct);
          if (!s) continue;
          if (!best || s.durationS < best.durationS) best = s;
        }
        if (!best) return null;
        const gainS = refStats.durationS - best.durationS;
        // Find tick at zone start in ref to enable cursor jump.
        let jumpTick = ref.startTick;
        for (let t = ref.startTick + 1; t <= ref.endTick; t++) {
          if (lapDistPct[t - 1] <= z.startPct && lapDistPct[t] >= z.startPct) {
            jumpTick = t;
            break;
          }
        }
        return { idx, zone: z, refStats, best, gainS, jumpTick };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Sort by largest measured gain.
    items.sort((a, b) => b.gainS - a.gainS);
    return { ref, items };
  }, [parsed, refLap]);

  if (!analysis) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Counterfactuals unavailable
        </div>
        <div className="text-[11px] text-muted-foreground">
          Need <span className="font-mono">Brake</span>, <span className="font-mono">Speed</span>,{" "}
          <span className="font-mono">LapDistPct</span> and at least 2 valid laps.
        </div>
      </div>
    );
  }

  const { ref, items } = analysis;
  const totalGain = items.filter((i) => i.gainS > 0).reduce((a, b) => a + b.gainS, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>What-if · Ref L{ref.lap} · {items.length} brake zones</span>
        <span>
          Realisable gain{" "}
          <span className="text-fuchsia-400">−{totalGain.toFixed(3)}s</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-[11px] text-muted-foreground">
            No brake zones detected on the reference lap.
          </div>
        ) : (
          items.map((it) => {
            const refRel = it.refStats.brakeReleasePct;
            const bestRel = it.best.brakeReleasePct;
            const releaseDeltaPct =
              refRel != null && bestRel != null ? bestRel - refRel : null;
            const refTOn = it.refStats.throttleOnPct;
            const bestTOn = it.best.throttleOnPct;
            const throttleDeltaPct =
              refTOn != null && bestTOn != null ? bestTOn - refTOn : null;
            const speedDelta = it.best.apexMinSpeed - it.refStats.apexMinSpeed;
            const exitDelta = it.best.exitSpeed - it.refStats.exitSpeed;
            const slower = it.gainS > 0.005;
            return (
              <button
                key={it.idx}
                onClick={() => {
                  setCmpLap(it.best.lap);
                  setCursorTick(it.jumpTick);
                }}
                className="hairline-b group flex w-full flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-accent/40"
              >
                <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                  <span className="flex items-center gap-1.5 text-foreground">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    Zone {it.idx + 1} ·{" "}
                    <span className="text-muted-foreground">
                      {(it.zone.startPct * 100).toFixed(1)}–
                      {(it.zone.endPct * 100).toFixed(1)}%
                    </span>
                  </span>
                  <span
                    className={`flex items-center gap-1 ${
                      slower ? "text-fuchsia-400" : "text-muted-foreground"
                    }`}
                  >
                    {slower ? (
                      <TrendingDown className="h-3 w-3" />
                    ) : (
                      <TrendingUp className="h-3 w-3" />
                    )}
                    {slower ? `−${it.gainS.toFixed(3)}s vs L${it.best.lap}` : "Already optimal here"}
                  </span>
                </div>
                {slower && (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-4 font-mono text-[10px] text-muted-foreground">
                    {releaseDeltaPct != null && (
                      <div>
                        Brake release{" "}
                        <span className={releaseDeltaPct > 0 ? "text-foreground" : "text-amber-400"}>
                          {fmtMeters(releaseDeltaPct, trackLengthKm)}
                        </span>{" "}
                        {releaseDeltaPct > 0 ? "later" : "earlier"}
                      </div>
                    )}
                    {throttleDeltaPct != null && (
                      <div>
                        Throttle on{" "}
                        <span className={throttleDeltaPct < 0 ? "text-foreground" : "text-amber-400"}>
                          {fmtMeters(-throttleDeltaPct, trackLengthKm)}
                        </span>{" "}
                        {throttleDeltaPct < 0 ? "earlier" : "later"}
                      </div>
                    )}
                    <div>
                      Apex min{" "}
                      <span className={speedDelta > 0 ? "text-foreground" : "text-amber-400"}>
                        {speedDelta >= 0 ? "+" : ""}
                        {speedDelta.toFixed(1)} {speedUnit}
                      </span>
                    </div>
                    <div>
                      Exit speed{" "}
                      <span className={exitDelta > 0 ? "text-foreground" : "text-amber-400"}>
                        {exitDelta >= 0 ? "+" : ""}
                        {exitDelta.toFixed(1)} {speedUnit}
                      </span>
                    </div>
                    <div>
                      Peak brake{" "}
                      <span className="text-foreground">
                        {(it.refStats.brakePeak * 100).toFixed(0)}% → {(it.best.brakePeak * 100).toFixed(0)}%
                      </span>
                    </div>
                    <div>
                      Band time{" "}
                      <span className="text-foreground">
                        {it.refStats.durationS.toFixed(3)}s → {it.best.durationS.toFixed(3)}s
                      </span>
                    </div>
                  </div>
                )}
              </button>
            );
          })
        )}
      </div>
      <div className="hairline-t px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        Click a zone to load the faster lap as comparison and jump the cursor. All deltas measured.
      </div>
    </div>
  );
}