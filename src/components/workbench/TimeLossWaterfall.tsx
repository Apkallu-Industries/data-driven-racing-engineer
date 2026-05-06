import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

/**
 * Time-loss waterfall vs reference lap (ATLAS-style).
 * Splits the lap into N equal LapDistPct segments and shows, per segment,
 * how many seconds the compare lap gained (green, negative) or lost (red,
 * positive) versus the reference lap. The cumulative line is the running
 * total, ending at the full lap-time delta. All numbers are measured.
 */
const NUM_SEGMENTS = 30;

function segmentTimes(parsed: IbtParsed, lapNum: number): number[] | null {
  const lap = parsed.laps.find((l) => l.lap === lapNum);
  if (!lap) return null;
  const sessionTime = parsed.channels["SessionTime"]?.data;
  const pct = parsed.channels["LapDistPct"]?.data;
  if (!sessionTime || !pct) return null;

  const boundaries: number[] = [lap.startTick];
  for (let s = 1; s < NUM_SEGMENTS; s++) {
    const target = s / NUM_SEGMENTS;
    let found: number | null = null;
    for (let t = lap.startTick + 1; t <= lap.endTick; t++) {
      const prev = pct[t - 1];
      const cur = pct[t];
      if (cur >= prev && prev <= target && cur >= target) {
        found = t;
        break;
      }
    }
    boundaries.push(found ?? NaN);
  }
  boundaries.push(lap.endTick);

  const times: number[] = [];
  for (let s = 0; s < NUM_SEGMENTS; s++) {
    const a = boundaries[s];
    const b = boundaries[s + 1];
    if (!isFinite(a) || !isFinite(b) || b <= a) {
      times.push(NaN);
    } else {
      times.push(sessionTime[b] - sessionTime[a]);
    }
  }
  return times;
}

export function TimeLossWaterfall({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap } = useWorkbench();

  const data = useMemo(() => {
    if (refLap == null || cmpLap == null) return null;
    const ref = segmentTimes(parsed, refLap);
    const cmp = segmentTimes(parsed, cmpLap);
    if (!ref || !cmp) return null;
    const deltas: number[] = [];
    let cum = 0;
    const cumulative: number[] = [];
    for (let i = 0; i < NUM_SEGMENTS; i++) {
      const d = cmp[i] - ref[i];
      deltas.push(d);
      if (isFinite(d)) cum += d;
      cumulative.push(cum);
    }
    return { deltas, cumulative };
  }, [parsed, refLap, cmpLap]);

  if (refLap == null || cmpLap == null) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        Pick a reference lap and a compare lap to see the time-loss waterfall.
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Need SessionTime + LapDistPct.
      </div>
    );
  }

  const { deltas, cumulative } = data;
  const peak = Math.max(0.001, ...deltas.map((d) => Math.abs(d)).filter((v) => isFinite(v)));
  const cumPeak = Math.max(0.001, ...cumulative.map((v) => Math.abs(v)));
  const total = cumulative[cumulative.length - 1];

  // SVG dims
  const W = 800;
  const H = 220;
  const PAD_L = 36;
  const PAD_R = 12;
  const PAD_T = 12;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const colW = innerW / NUM_SEGMENTS;
  const yMid = PAD_T + innerH / 2;

  const cumLine = cumulative
    .map((v, i) => {
      const x = PAD_L + (i + 0.5) * colW;
      const y = yMid - (v / cumPeak) * (innerH / 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Time loss · cmp L{cmpLap} vs ref L{refLap}</span>
        <span>
          Total{" "}
          <span
            className={
              total > 0.01
                ? "text-fuchsia-400"
                : total < -0.01
                  ? "text-emerald-400"
                  : "text-foreground"
            }
          >
            {total > 0 ? "+" : ""}
            {total.toFixed(3)}s
          </span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full">
          {/* Zero line */}
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yMid}
            y2={yMid}
            stroke="var(--border-strong)"
            strokeWidth={0.5}
          />
          {/* Y labels */}
          <text x={PAD_L - 4} y={PAD_T + 4} fontSize={9} textAnchor="end" fill="var(--muted-foreground)" fontFamily="monospace">
            +{peak.toFixed(2)}s
          </text>
          <text x={PAD_L - 4} y={H - PAD_B + 0} fontSize={9} textAnchor="end" fill="var(--muted-foreground)" fontFamily="monospace">
            −{peak.toFixed(2)}s
          </text>
          <text x={PAD_L - 4} y={yMid + 3} fontSize={9} textAnchor="end" fill="var(--muted-foreground)" fontFamily="monospace">
            0
          </text>
          {/* Per-segment bars (per-segment delta scaled to peak) */}
          {deltas.map((d, i) => {
            if (!isFinite(d)) return null;
            const x = PAD_L + i * colW + 1;
            const w = Math.max(1, colW - 2);
            const h = (Math.abs(d) / peak) * (innerH / 2);
            const y = d >= 0 ? yMid : yMid - h;
            const fill = d > 0 ? "var(--ch-brake)" : "var(--ch-throttle)";
            return (
              <g key={i}>
                <rect x={x} y={y} width={w} height={Math.max(0.5, h)} fill={fill} fillOpacity={0.55}>
                  <title>
                    {`Seg ${i + 1} (${((i / NUM_SEGMENTS) * 100).toFixed(0)}–${(((i + 1) / NUM_SEGMENTS) * 100).toFixed(0)}%): ${d > 0 ? "+" : ""}${d.toFixed(3)}s`}
                  </title>
                </rect>
              </g>
            );
          })}
          {/* Cumulative line (separate Y scale) */}
          <path d={cumLine} fill="none" stroke="var(--primary)" strokeWidth={1.5} />
          {/* X axis labels */}
          {[0, 25, 50, 75, 100].map((p) => (
            <text
              key={p}
              x={PAD_L + (p / 100) * innerW}
              y={H - 6}
              fontSize={9}
              textAnchor="middle"
              fontFamily="monospace"
              fill="var(--muted-foreground)"
            >
              {p}%
            </text>
          ))}
        </svg>
        <div className="mt-2 flex items-center gap-4 px-1 font-mono text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3" style={{ background: "var(--ch-brake)", opacity: 0.7 }} />
            Lost vs ref
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2 w-3" style={{ background: "var(--ch-throttle)", opacity: 0.7 }} />
            Gained vs ref
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-3" style={{ background: "var(--primary)" }} />
            Cumulative Δ
          </span>
        </div>
      </div>
    </div>
  );
}