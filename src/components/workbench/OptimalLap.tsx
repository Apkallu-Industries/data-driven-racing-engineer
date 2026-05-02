import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { Trophy, Zap } from "lucide-react";

/**
 * Theoretical optimal lap from real micro-sectors.
 * Splits the lap into N equal LapDistPct segments, finds the fastest
 * time achieved in each segment across every valid lap, and sums them.
 * Every number shown is measured — no synthetic fills.
 */
const NUM_SEGMENTS = 20;

function fmt(t: number): string {
  if (!isFinite(t) || t <= 0) return "—";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

export function OptimalLap({ parsed }: { parsed: IbtParsed }) {
  const { setRefLap, setCursorTick } = useWorkbench();

  const result = useMemo(() => {
    const sessionTime = parsed.channels["SessionTime"]?.data;
    const lapDistPct = parsed.channels["LapDistPct"]?.data;
    if (!sessionTime || !lapDistPct || parsed.laps.length === 0) return null;

    // Per-lap segment times: [lapIdx][segIdx] = seconds
    const perLap: { lap: number; times: (number | null)[]; total: number }[] = [];

    for (const l of parsed.laps) {
      if (l.endTick - l.startTick < 60 || l.timeS < 5) continue;
      // Find tick at which lapDistPct crosses each k/N boundary.
      const boundaries: number[] = [l.startTick];
      for (let s = 1; s < NUM_SEGMENTS; s++) {
        const target = s / NUM_SEGMENTS;
        let foundTick: number | null = null;
        for (let t = l.startTick + 1; t <= l.endTick; t++) {
          const prev = lapDistPct[t - 1];
          const cur = lapDistPct[t];
          if (cur >= prev && prev <= target && cur >= target) {
            foundTick = t;
            break;
          }
        }
        if (foundTick != null) boundaries.push(foundTick);
        else boundaries.push(NaN);
      }
      boundaries.push(l.endTick);

      const times: (number | null)[] = new Array(NUM_SEGMENTS).fill(null);
      for (let s = 0; s < NUM_SEGMENTS; s++) {
        const a = boundaries[s];
        const b = boundaries[s + 1];
        if (!isFinite(a) || !isFinite(b) || b <= a) continue;
        const dt = sessionTime[b] - sessionTime[a];
        if (dt > 0 && dt < l.timeS) times[s] = dt;
      }
      perLap.push({ lap: l.lap, times, total: l.timeS });
    }

    if (perLap.length === 0) return null;

    // Best per segment.
    const bestSeg: ({ time: number; lap: number; startTick: number } | null)[] = new Array(NUM_SEGMENTS).fill(null);
    for (const row of perLap) {
      const lap = parsed.laps.find((x) => x.lap === row.lap)!;
      for (let s = 0; s < NUM_SEGMENTS; s++) {
        const t = row.times[s];
        if (t == null) continue;
        if (!bestSeg[s] || t < bestSeg[s]!.time) {
          // Approximate seg start tick (re-derive cheaply below for jump).
          bestSeg[s] = { time: t, lap: row.lap, startTick: lap.startTick };
        }
      }
    }

    const totals = perLap.map((p) => p.total);
    const bestActual = Math.min(...totals);
    const bestActualLap = perLap.find((p) => p.total === bestActual)!.lap;

    const allCovered = bestSeg.every((b) => b != null);
    const optimal = allCovered
      ? bestSeg.reduce((a, b) => a + b!.time, 0)
      : null;
    const gap = optimal != null ? bestActual - optimal : null;

    return { perLap, bestSeg, bestActual, bestActualLap, optimal, gap };
  }, [parsed]);

  if (!result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Optimal lap unavailable
        </div>
        <div className="text-[11px] text-muted-foreground">
          Need <span className="font-mono">SessionTime</span> +{" "}
          <span className="font-mono">LapDistPct</span> + at least one valid lap.
        </div>
      </div>
    );
  }

  const { bestSeg, bestActual, bestActualLap, optimal, gap, perLap } = result;

  // Per-segment unique-lap contributions.
  const contributors = new Map<number, number>();
  for (const b of bestSeg) {
    if (!b) continue;
    contributors.set(b.lap, (contributors.get(b.lap) ?? 0) + 1);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Optimal lap · {NUM_SEGMENTS} micro-sectors</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Trophy className="h-3 w-3 text-primary" />
            Best L{bestActualLap}{" "}
            <span className="text-foreground">{fmt(bestActual)}</span>
          </span>
          {optimal != null && (
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3 text-fuchsia-400" />
              Optimal{" "}
              <span className="text-foreground">{fmt(optimal)}</span>
            </span>
          )}
          {gap != null && (
            <span>
              Gap{" "}
              <span className={gap > 0.001 ? "text-fuchsia-400" : "text-foreground"}>
                {gap > 0 ? `−${gap.toFixed(3)}` : "0.000"}
              </span>
            </span>
          )}
        </span>
      </div>

      {/* Segment bar: width = relative time, color = source lap */}
      <div className="px-3 py-2">
        <div className="hairline flex h-6 w-full overflow-hidden rounded-sm bg-rail">
          {bestSeg.map((b, i) => {
            if (!b) {
              return (
                <div
                  key={i}
                  className="h-full flex-1 border-r border-border/40 bg-muted/30"
                  title={`Segment ${i + 1}: no data`}
                />
              );
            }
            return (
              <button
                key={i}
                onClick={() => {
                  setRefLap(b.lap);
                  setCursorTick(b.startTick);
                }}
                className="group h-full flex-1 border-r border-border/40 bg-primary/40 transition-colors hover:bg-primary"
                title={`Segment ${i + 1} · L${b.lap} · ${b.time.toFixed(3)}s`}
              />
            );
          })}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-muted-foreground">
          <span>0%</span>
          <span>50%</span>
          <span>100%</span>
        </div>
      </div>

      <div className="hairline-t min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="hairline-b">
              <th className="px-2 py-1 text-left">Seg</th>
              <th className="px-2 py-1 text-left">Range</th>
              <th className="px-2 py-1 text-right">Best</th>
              <th className="px-2 py-1 text-center">Lap</th>
            </tr>
          </thead>
          <tbody>
            {bestSeg.map((b, i) => {
              const lo = ((i / NUM_SEGMENTS) * 100).toFixed(0);
              const hi = (((i + 1) / NUM_SEGMENTS) * 100).toFixed(0);
              return (
                <tr
                  key={i}
                  className="hairline-b cursor-pointer hover:bg-accent/40"
                  onClick={() => b && (setRefLap(b.lap), setCursorTick(b.startTick))}
                >
                  <td className="px-2 py-1 text-left text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1 text-left text-muted-foreground">{lo}–{hi}%</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {b ? b.time.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums">
                    {b ? `L${b.lap}` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="hairline-t flex items-center gap-3 px-3 py-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        <span>{contributors.size} of {perLap.length} laps contribute</span>
        <span className="text-[9px] normal-case tracking-normal">
          Click any segment to jump the cursor and set that lap as reference.
        </span>
      </div>
    </div>
  );
}