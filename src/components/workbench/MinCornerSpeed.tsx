import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

/**
 * Min-corner-speed report (ATLAS-style "Apex Speed" view).
 * Detects corners as local minima of Speed along the lap, then lists
 * each turn's apex speed and (when a compare lap is selected) the delta.
 * All numbers are measured — corners are derived from the reference lap's
 * speed trace; compare values are sampled at the same LapDistPct.
 */

interface Corner {
  idx: number;
  pct: number; // 0..1
  startTick: number; // index into ref lap channels
  apexTick: number;
  apexSpeed: number; // m/s
  entrySpeed: number; // m/s before braking
}

function findCorners(parsed: IbtParsed, lapNum: number): Corner[] | null {
  const lap = parsed.laps.find((l) => l.lap === lapNum);
  if (!lap) return null;
  const speed = parsed.channels["Speed"]?.data;
  const pct = parsed.channels["LapDistPct"]?.data;
  if (!speed || !pct) return null;

  const N = lap.endTick - lap.startTick + 1;
  if (N < 60) return null;

  // Smooth speed with a small moving average to suppress noise.
  const win = Math.max(5, Math.floor(N / 400));
  const sm = new Float32Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    acc += speed[lap.startTick + i];
    if (i >= win) acc -= speed[lap.startTick + i - win];
    sm[i] = acc / Math.min(i + 1, win);
  }

  // Find local minima with a minimum prominence vs neighbouring maxima.
  const corners: Corner[] = [];
  let lastMaxV = sm[0];
  let lastMaxI = 0;
  let i = 1;
  while (i < N - 1) {
    // Walk to next local min.
    while (i < N - 1 && sm[i + 1] <= sm[i]) i++;
    const minI = i;
    const minV = sm[i];
    // Walk to next local max.
    let j = i;
    while (j < N - 1 && sm[j + 1] >= sm[j]) j++;
    const nextMaxV = sm[j];
    // Prominence: min must be at least 8 m/s slower than surrounding peaks.
    const prominence = Math.min(lastMaxV, nextMaxV) - minV;
    if (prominence > 8 && minV < 60) {
      corners.push({
        idx: corners.length + 1,
        pct: pct[lap.startTick + minI],
        startTick: lap.startTick + lastMaxI,
        apexTick: lap.startTick + minI,
        apexSpeed: minV,
        entrySpeed: lastMaxV,
      });
    }
    lastMaxI = j;
    lastMaxV = nextMaxV;
    i = j + 1;
  }
  return corners;
}

function sampleSpeedAtPct(parsed: IbtParsed, lapNum: number, target: number): number | null {
  const lap = parsed.laps.find((l) => l.lap === lapNum);
  if (!lap) return null;
  const speed = parsed.channels["Speed"]?.data;
  const pct = parsed.channels["LapDistPct"]?.data;
  if (!speed || !pct) return null;
  // Scan window ±3% around target, take min speed (apex of local corner).
  const lo = target - 0.015;
  const hi = target + 0.015;
  let vmin = Infinity;
  for (let t = lap.startTick; t <= lap.endTick; t++) {
    const p = pct[t];
    if (p >= lo && p <= hi && speed[t] < vmin) vmin = speed[t];
  }
  return isFinite(vmin) ? vmin : null;
}

const MS_TO_KMH = 3.6;

export function MinCornerSpeed({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap, setCursorTick } = useWorkbench();

  const corners = useMemo(
    () => (refLap != null ? findCorners(parsed, refLap) : null),
    [parsed, refLap],
  );
  const cmpVals = useMemo(() => {
    if (!corners || cmpLap == null) return null;
    return corners.map((c) => sampleSpeedAtPct(parsed, cmpLap, c.pct));
  }, [parsed, corners, cmpLap]);

  if (refLap == null) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Pick a reference lap to detect corners.
      </div>
    );
  }
  if (!corners || corners.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No corners detected (need Speed + LapDistPct).
      </div>
    );
  }

  const maxApex = Math.max(...corners.map((c) => c.apexSpeed));

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Min-corner-speed · {corners.length} turns · ref L{refLap}</span>
        {cmpLap != null && <span>cmp L{cmpLap}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="hairline-b">
              <th className="px-2 py-1 text-left">Turn</th>
              <th className="px-2 py-1 text-right">Pos</th>
              <th className="px-2 py-1 text-right">Entry</th>
              <th className="px-2 py-1 text-right">Apex</th>
              <th className="px-2 py-1">Apex bar</th>
              {cmpLap != null && <th className="px-2 py-1 text-right">Δ km/h</th>}
            </tr>
          </thead>
          <tbody>
            {corners.map((c, i) => {
              const cmpV = cmpVals?.[i] ?? null;
              const delta = cmpV != null ? (cmpV - c.apexSpeed) * MS_TO_KMH : null;
              const w = (c.apexSpeed / maxApex) * 100;
              return (
                <tr
                  key={c.idx}
                  className="hairline-b cursor-pointer hover:bg-accent/40"
                  onClick={() => setCursorTick(c.apexTick)}
                >
                  <td className="px-2 py-1 text-left">T{c.idx}</td>
                  <td className="px-2 py-1 text-right text-muted-foreground tabular-nums">
                    {(c.pct * 100).toFixed(1)}%
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                    {(c.entrySpeed * MS_TO_KMH).toFixed(0)}
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {(c.apexSpeed * MS_TO_KMH).toFixed(0)}
                  </td>
                  <td className="px-2 py-1">
                    <div className="h-2 w-full rounded-sm bg-rail">
                      <div
                        className="h-full rounded-sm bg-primary/70"
                        style={{ width: `${w}%` }}
                      />
                    </div>
                  </td>
                  {cmpLap != null && (
                    <td
                      className={`px-2 py-1 text-right tabular-nums ${
                        delta == null
                          ? "text-muted-foreground"
                          : delta > 0.5
                            ? "text-emerald-400"
                            : delta < -0.5
                              ? "text-fuchsia-400"
                              : "text-foreground"
                      }`}
                    >
                      {delta == null ? "—" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hairline-t px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        Click a row to jump the cursor to that apex.
      </div>
    </div>
  );
}