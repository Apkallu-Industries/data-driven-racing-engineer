import { useMemo, useRef, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { ExportButton } from "./ExportButton";

const NUM_BINS = 600;

interface LapStrip {
  lap: number;
  timeS: number;
  /** Throttle 0..1 per bin */
  thr: Float32Array;
  /** Brake 0..1 per bin */
  brk: Float32Array;
}

function buildStrips(parsed: IbtParsed): LapStrip[] {
  const pct = parsed.channels["LapDistPct"]?.data;
  const thrCh = parsed.channels["Throttle"]?.data;
  const brkCh = parsed.channels["Brake"]?.data;
  if (!pct || !thrCh || !brkCh) return [];
  const strips: LapStrip[] = [];
  for (const lap of parsed.laps) {
    if (lap.endTick - lap.startTick < 60) continue;
    const thr = new Float32Array(NUM_BINS);
    const brk = new Float32Array(NUM_BINS);
    const counts = new Uint16Array(NUM_BINS);
    for (let t = lap.startTick; t <= lap.endTick; t++) {
      const p = pct[t];
      if (!isFinite(p)) continue;
      const bin = Math.min(NUM_BINS - 1, Math.max(0, Math.floor(p * NUM_BINS)));
      thr[bin] += thrCh[t];
      brk[bin] += brkCh[t];
      counts[bin]++;
    }
    for (let i = 0; i < NUM_BINS; i++) {
      const c = counts[i] || 1;
      thr[i] = Math.max(0, Math.min(1, thr[i] / c));
      brk[i] = Math.max(0, Math.min(1, brk[i] / c));
    }
    strips.push({ lap: lap.lap, timeS: lap.timeS, thr, brk });
  }
  return strips;
}

export function PianoRoll({ parsed }: { parsed: IbtParsed }) {
  const { refLap } = useWorkbench();
  const [maxLaps, setMaxLaps] = useState(8);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const strips = useMemo(() => buildStrips(parsed), [parsed]);
  const visible = strips.slice(0, maxLaps);

  if (visible.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Need Throttle, Brake, and LapDistPct channels
      </div>
    );
  }

  const W = 800;
  const ROW_H = 28;
  const GAP = 4;
  const LABEL_W = 64;
  const PLOT_W = W - LABEL_W;
  const H = visible.length * (ROW_H + GAP) + 18;

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Piano Roll · pedals across distance</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px]">
            <span>Laps</span>
            <select
              value={maxLaps}
              onChange={(e) => setMaxLaps(parseInt(e.target.value, 10))}
              className="rounded-sm border border-border bg-rail px-1.5 py-0.5 font-mono"
            >
              {[4, 6, 8, 12, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <ExportButton getSvg={() => svgRef.current} filenameBase="piano-roll" />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="block w-full" preserveAspectRatio="xMidYMin meet">
          {/* sector dividers */}
          {[1 / 3, 2 / 3].map((p) => (
            <line
              key={p}
              x1={LABEL_W + PLOT_W * p}
              y1={0}
              x2={LABEL_W + PLOT_W * p}
              y2={H - 18}
              stroke="var(--border-strong)"
              strokeDasharray="2,3"
              strokeWidth={0.5}
            />
          ))}
          {visible.map((s, idx) => {
            const y = idx * (ROW_H + GAP);
            const isRef = s.lap === refLap;
            return (
              <g key={s.lap}>
                <text
                  x={4}
                  y={y + ROW_H / 2 + 3}
                  fontSize={10}
                  fontFamily="monospace"
                  fill={isRef ? "var(--primary)" : "var(--muted-foreground)"}
                >
                  L{s.lap} {s.timeS.toFixed(2)}s
                </text>
                {/* baseline rail */}
                <rect x={LABEL_W} y={y} width={PLOT_W} height={ROW_H} fill="var(--rail)" />
                {/* throttle bars (top half, green up) */}
                {Array.from(s.thr).map((v, i) => {
                  if (v < 0.02) return null;
                  const bw = PLOT_W / NUM_BINS;
                  const h = (v * ROW_H) / 2;
                  return (
                    <rect
                      key={`t${i}`}
                      x={LABEL_W + i * bw}
                      y={y + ROW_H / 2 - h}
                      width={bw + 0.4}
                      height={h}
                      fill="var(--ch-throttle)"
                      opacity={0.85}
                    />
                  );
                })}
                {/* brake bars (bottom half, red down) */}
                {Array.from(s.brk).map((v, i) => {
                  if (v < 0.02) return null;
                  const bw = PLOT_W / NUM_BINS;
                  const h = (v * ROW_H) / 2;
                  return (
                    <rect
                      key={`b${i}`}
                      x={LABEL_W + i * bw}
                      y={y + ROW_H / 2}
                      width={bw + 0.4}
                      height={h}
                      fill="var(--ch-brake)"
                      opacity={0.85}
                    />
                  );
                })}
                <line
                  x1={LABEL_W}
                  y1={y + ROW_H / 2}
                  x2={LABEL_W + PLOT_W}
                  y2={y + ROW_H / 2}
                  stroke="var(--border)"
                  strokeWidth={0.5}
                />
              </g>
            );
          })}
          {/* axis labels */}
          <text x={LABEL_W} y={H - 4} fontSize={9} fontFamily="monospace" fill="var(--muted-foreground)">
            Start
          </text>
          <text x={LABEL_W + PLOT_W / 3 - 8} y={H - 4} fontSize={9} fontFamily="monospace" fill="var(--muted-foreground)">
            S2
          </text>
          <text x={LABEL_W + (2 * PLOT_W) / 3 - 8} y={H - 4} fontSize={9} fontFamily="monospace" fill="var(--muted-foreground)">
            S3
          </text>
          <text x={LABEL_W + PLOT_W - 24} y={H - 4} fontSize={9} fontFamily="monospace" fill="var(--muted-foreground)">
            Finish
          </text>
        </svg>
      </div>
    </div>
  );
}