import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

const NUM_SECTORS = 3;

interface SectorMetrics {
  entrySpeed: number; // m/s at sector start
  minSpeed: number;
  exitSpeed: number; // m/s at sector end
  brakeG: number; // peak |LongAccel| while braking, m/s²
  throttleOnPct: number; // 0..1 fraction of sector with throttle > 0.5
  steerSmoothness: number; // 1 - normalized RMS jitter, 0..1 (higher = smoother)
}

function lapSectorMetrics(parsed: IbtParsed, lapNum: number): SectorMetrics[] | null {
  const lap = parsed.laps.find((l) => l.lap === lapNum);
  if (!lap) return null;
  const pct = parsed.channels["LapDistPct"]?.data;
  const speed = parsed.channels["Speed"]?.data;
  const thr = parsed.channels["Throttle"]?.data;
  const brk = parsed.channels["Brake"]?.data;
  const longG = parsed.channels["LongAccel"]?.data;
  const steer = parsed.channels["SteeringWheelAngle"]?.data;
  if (!pct || !speed) return null;

  const out: SectorMetrics[] = [];
  for (let s = 0; s < NUM_SECTORS; s++) {
    const lo = s / NUM_SECTORS;
    const hi = (s + 1) / NUM_SECTORS;
    let entry = NaN, exit = NaN, vmin = Infinity;
    let peakBrakeG = 0;
    let thrOn = 0, thrTotal = 0;
    const steerVals: number[] = [];
    for (let t = lap.startTick; t <= lap.endTick; t++) {
      const p = pct[t];
      if (!isFinite(p) || p < lo || p >= hi) continue;
      const v = speed[t];
      if (isFinite(v)) {
        if (isNaN(entry)) entry = v;
        exit = v;
        if (v < vmin) vmin = v;
      }
      if (longG && brk && brk[t] > 0.05) {
        const g = Math.abs(longG[t]);
        if (g > peakBrakeG) peakBrakeG = g;
      }
      if (thr) {
        thrTotal++;
        if (thr[t] > 0.5) thrOn++;
      }
      if (steer) steerVals.push(steer[t]);
    }
    // Steering smoothness: 1 - normalized RMS of first difference.
    let smooth = 1;
    if (steerVals.length > 4) {
      let sumSq = 0;
      for (let i = 1; i < steerVals.length; i++) {
        const d = steerVals[i] - steerVals[i - 1];
        sumSq += d * d;
      }
      const rms = Math.sqrt(sumSq / (steerVals.length - 1));
      // Normalize: 0.05 rad/sample is "rough"
      smooth = Math.max(0, Math.min(1, 1 - rms / 0.05));
    }
    out.push({
      entrySpeed: isFinite(entry) ? entry : 0,
      minSpeed: isFinite(vmin) ? vmin : 0,
      exitSpeed: isFinite(exit) ? exit : 0,
      brakeG: peakBrakeG,
      throttleOnPct: thrTotal > 0 ? thrOn / thrTotal : 0,
      steerSmoothness: smooth,
    });
  }
  return out;
}

const AXES = [
  { key: "entrySpeed", label: "Entry V" },
  { key: "minSpeed", label: "Min V" },
  { key: "exitSpeed", label: "Exit V" },
  { key: "brakeG", label: "Brake G" },
  { key: "throttleOnPct", label: "Thr On" },
  { key: "steerSmoothness", label: "Smooth" },
] as const;

/** Normalize each axis using max across reference + compare metrics. */
function normalize(value: number, axis: typeof AXES[number]["key"], scale: Record<string, number>) {
  return scale[axis] > 0 ? Math.max(0, Math.min(1, value / scale[axis])) : 0;
}

export function SectorSpider({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap } = useWorkbench();
  const ref = useMemo(
    () => (refLap != null ? lapSectorMetrics(parsed, refLap) : null),
    [parsed, refLap],
  );
  const cmp = useMemo(
    () => (cmpLap != null ? lapSectorMetrics(parsed, cmpLap) : null),
    [parsed, cmpLap],
  );

  if (!ref) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Pick a reference lap
      </div>
    );
  }

  // Build per-axis scales using max across ref + cmp.
  const scale: Record<string, number> = {};
  for (const a of AXES) {
    let m = 0;
    for (const set of [ref, cmp].filter(Boolean) as SectorMetrics[][]) {
      for (const sec of set) {
        const v = sec[a.key];
        if (v > m) m = v;
      }
    }
    scale[a.key] = m || 1;
  }

  const W = 280;
  const cx = W / 2;
  const cy = W / 2;
  const R = W / 2 - 28;

  const polygonForSector = (m: SectorMetrics) => {
    return AXES.map((a, i) => {
      const v = normalize(m[a.key], a.key, scale);
      const ang = (-Math.PI / 2) + (i * 2 * Math.PI) / AXES.length;
      return [cx + Math.cos(ang) * R * v, cy + Math.sin(ang) * R * v];
    });
  };

  const sectorColors = ["var(--ch-speed)", "var(--ch-throttle)", "var(--ch-brake)"];

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Sector Spider</span>
        <span className="text-[10px]">
          ref L{refLap}
          {cmpLap != null && ` · cmp L${cmpLap} (dashed)`}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className="grid grid-cols-3 gap-2">
          {ref.map((sec, sIdx) => {
            const refPts = polygonForSector(sec);
            const cmpPts = cmp?.[sIdx] ? polygonForSector(cmp[sIdx]) : null;
            return (
              <div key={sIdx} className="hairline rounded-sm bg-rail/40 p-1">
                <div className="text-center font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Sector {sIdx + 1}
                </div>
                <svg viewBox={`0 0 ${W} ${W}`} className="block h-auto w-full">
                  {/* grid rings */}
                  {[0.25, 0.5, 0.75, 1].map((r) => (
                    <polygon
                      key={r}
                      points={AXES.map((_, i) => {
                        const ang = (-Math.PI / 2) + (i * 2 * Math.PI) / AXES.length;
                        return `${cx + Math.cos(ang) * R * r},${cy + Math.sin(ang) * R * r}`;
                      }).join(" ")}
                      fill="none"
                      stroke="var(--border)"
                      strokeWidth={0.5}
                      opacity={0.6}
                    />
                  ))}
                  {/* axes + labels */}
                  {AXES.map((a, i) => {
                    const ang = (-Math.PI / 2) + (i * 2 * Math.PI) / AXES.length;
                    const lx = cx + Math.cos(ang) * (R + 14);
                    const ly = cy + Math.sin(ang) * (R + 14);
                    return (
                      <g key={a.key}>
                        <line
                          x1={cx}
                          y1={cy}
                          x2={cx + Math.cos(ang) * R}
                          y2={cy + Math.sin(ang) * R}
                          stroke="var(--border-strong)"
                          strokeWidth={0.5}
                          opacity={0.5}
                        />
                        <text
                          x={lx}
                          y={ly}
                          fontSize={9}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontFamily="monospace"
                          fill="var(--muted-foreground)"
                        >
                          {a.label}
                        </text>
                      </g>
                    );
                  })}
                  {/* ref polygon */}
                  <polygon
                    points={refPts.map((p) => p.join(",")).join(" ")}
                    fill={sectorColors[sIdx]}
                    fillOpacity={0.18}
                    stroke={sectorColors[sIdx]}
                    strokeWidth={1.5}
                  />
                  {/* cmp polygon */}
                  {cmpPts && (
                    <polygon
                      points={cmpPts.map((p) => p.join(",")).join(" ")}
                      fill="var(--ch-throttle)"
                      fillOpacity={0.08}
                      stroke="var(--ch-throttle)"
                      strokeWidth={1.2}
                      strokeDasharray="3,3"
                    />
                  )}
                </svg>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}