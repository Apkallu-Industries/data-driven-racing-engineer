import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { Trophy, Flag } from "lucide-react";

const NUM_SECTORS = 3;

interface LapRow {
  lap: number;
  startTick: number;
  endTick: number;
  timeS: number;
  sectors: (number | null)[]; // seconds per sector, null if not derivable
  valid: boolean;
}

function formatLap(t: number): string {
  if (!isFinite(t) || t <= 0) return "—";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m > 0 ? `${m}:${s.toFixed(3).padStart(6, "0")}` : s.toFixed(3);
}

function formatSec(t: number | null): string {
  if (t == null || !isFinite(t) || t <= 0) return "—";
  return t.toFixed(3);
}

export function LapList({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap, setRefLap, setCmpLap, setCursorTick } = useWorkbench();

  const rows = useMemo<LapRow[]>(() => {
    const sessionTime = parsed.channels["SessionTime"]?.data;
    const lapDistPct = parsed.channels["LapDistPct"]?.data;
    if (!sessionTime) return [];

    return parsed.laps.map((l) => {
      const sectors: (number | null)[] = new Array(NUM_SECTORS).fill(null);
      const valid = l.endTick - l.startTick > 30 && l.timeS > 5;

      if (lapDistPct && valid) {
        // Find tick at which lapDistPct crosses 1/3 and 2/3.
        // Be defensive: iRacing's LapDistPct can wrap from ~1 → 0 at the
        // line, and the very first sample of the lap might be near 1.
        const boundaries: number[] = [];
        for (let s = 1; s < NUM_SECTORS; s++) {
          const target = s / NUM_SECTORS;
          let foundTick: number | null = null;
          for (let t = l.startTick + 1; t <= l.endTick; t++) {
            const prev = lapDistPct[t - 1];
            const cur = lapDistPct[t];
            // Only consider monotonic forward progress (skip the wrap).
            if (cur >= prev && prev <= target && cur >= target) {
              foundTick = t;
              break;
            }
          }
          if (foundTick != null) boundaries.push(foundTick);
        }
        if (boundaries.length === NUM_SECTORS - 1) {
          const ticks = [l.startTick, ...boundaries, l.endTick];
          for (let s = 0; s < NUM_SECTORS; s++) {
            sectors[s] = sessionTime[ticks[s + 1]] - sessionTime[ticks[s]];
          }
        }
      }

      return {
        lap: l.lap,
        startTick: l.startTick,
        endTick: l.endTick,
        timeS: l.timeS,
        sectors,
        valid,
      };
    });
  }, [parsed]);

  // Best lap and best sector times (across valid laps only)
  const { bestLapNumber, bestSectors, theoreticalBest } = useMemo(() => {
    let bestLapNumber: number | null = null;
    let bestLapT = Infinity;
    const bestSectors: (number | null)[] = new Array(NUM_SECTORS).fill(null);
    for (const r of rows) {
      if (!r.valid) continue;
      if (r.timeS < bestLapT) {
        bestLapT = r.timeS;
        bestLapNumber = r.lap;
      }
      for (let s = 0; s < NUM_SECTORS; s++) {
        const v = r.sectors[s];
        if (v != null && (bestSectors[s] == null || v < (bestSectors[s] as number))) {
          bestSectors[s] = v;
        }
      }
    }
    const theoreticalBest = bestSectors.every((s) => s != null)
      ? (bestSectors as number[]).reduce((a, b) => a + b, 0)
      : null;
    return { bestLapNumber, bestSectors, theoreticalBest };
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No laps detected
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Laps · {rows.length}</span>
        <span className="flex items-center gap-3">
          {bestLapNumber != null && (
            <span className="flex items-center gap-1 text-primary">
              <Trophy className="h-3 w-3" />
              Best L{bestLapNumber}
            </span>
          )}
          {theoreticalBest != null && (
            <span title="Theoretical best from fastest sectors">
              Theo {formatLap(theoreticalBest)}
            </span>
          )}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse font-mono text-[11px]">
          <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr className="hairline-b">
              <th className="px-2 py-1 text-left">Lap</th>
              {Array.from({ length: NUM_SECTORS }, (_, i) => (
                <th key={i} className="px-2 py-1 text-right">
                  S{i + 1}
                </th>
              ))}
              <th className="px-2 py-1 text-right">Time</th>
              <th className="px-2 py-1 text-center">Δ Best</th>
              <th className="px-2 py-1 text-center">Set</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isBest = r.lap === bestLapNumber;
              const isRef = refLap === r.lap;
              const isCmp = cmpLap === r.lap;
              const delta =
                bestLapNumber != null && r.valid
                  ? r.timeS - (rows.find((x) => x.lap === bestLapNumber)?.timeS ?? r.timeS)
                  : null;
              return (
                <tr
                  key={r.lap}
                  onClick={() => setCursorTick(r.startTick)}
                  className={`hairline-b cursor-pointer transition-colors hover:bg-accent/40 ${
                    isBest ? "bg-primary/10" : ""
                  } ${isRef ? "ring-1 ring-inset ring-primary" : ""}`}
                >
                  <td className="px-2 py-1 text-left">
                    <span className="inline-flex items-center gap-1">
                      {isBest && <Trophy className="h-3 w-3 text-primary" />}
                      {!r.valid && <Flag className="h-3 w-3 text-muted-foreground" />}
                      {r.lap}
                    </span>
                  </td>
                  {r.sectors.map((sec, i) => {
                    const isPersonalBestSec = sec != null && bestSectors[i] === sec;
                    return (
                      <td
                        key={i}
                        className={`px-2 py-1 text-right tabular-nums ${
                          isPersonalBestSec ? "font-semibold text-fuchsia-400" : ""
                        }`}
                      >
                        {formatSec(sec)}
                      </td>
                    );
                  })}
                  <td
                    className={`px-2 py-1 text-right tabular-nums ${
                      isBest ? "font-semibold text-primary" : ""
                    }`}
                  >
                    {r.valid ? formatLap(r.timeS) : "—"}
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">
                    {delta != null && delta > 0 ? `+${delta.toFixed(3)}` : delta === 0 ? "—" : ""}
                  </td>
                  <td className="px-2 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => setRefLap(isRef ? null : r.lap)}
                        className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                          isRef
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border hover:bg-accent"
                        }`}
                        title="Set as reference lap"
                      >
                        Ref
                      </button>
                      <button
                        onClick={() => setCmpLap(isCmp ? null : r.lap)}
                        className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                          isCmp
                            ? "border-foreground bg-foreground text-background"
                            : "border-border hover:bg-accent"
                        }`}
                        title="Set as compare lap"
                      >
                        Cmp
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hairline-t flex items-center gap-3 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-primary/40" /> Best lap</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-fuchsia-400" /> Best sector</span>
        <span className="flex items-center gap-1"><Flag className="h-3 w-3" /> In/out lap</span>
      </div>
    </div>
  );
}