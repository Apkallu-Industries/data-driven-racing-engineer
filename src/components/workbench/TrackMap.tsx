import { useMemo, useRef, useState, useCallback } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench, type MapMode, type MapColorChannel } from "@/lib/store";
import { Plus, Minus, Maximize2 } from "lucide-react";

const W = 400;
const H = 260;
const PAD = 16;
const NUM_SAMPLES = 600; // resampling resolution per lap (in % of lap distance)

interface BuiltLap {
  /** XY in world units, one point per resample bin */
  x: Float32Array;
  y: Float32Array;
  /** Channel value per bin (used for color). Empty if no channel. */
  c: Float32Array;
  lap: number;
}

/** Build per-lap resampled XY using LapDistPct as the abscissa. */
function buildLapsByDist(
  parsed: IbtParsed,
  channelName: MapColorChannel,
): { laps: BuiltLap[]; cMin: number; cMax: number } | null {
  const xy = parsed.trackXY;
  const lapDistPct = parsed.channels["LapDistPct"]?.data;
  if (!xy || !lapDistPct) return null;

  const channelData =
    channelName !== "none" ? parsed.channels[channelName]?.data : undefined;

  const laps: BuiltLap[] = [];
  let cMin = Infinity;
  let cMax = -Infinity;

  for (const lap of parsed.laps) {
    if (lap.endTick - lap.startTick < 60) continue;
    const x = new Float32Array(NUM_SAMPLES);
    const y = new Float32Array(NUM_SAMPLES);
    const c = new Float32Array(channelData ? NUM_SAMPLES : 0);

    // Build a monotonic-ish list of (pct, tick) for this lap.
    // Filter out the wrap from ~1 -> 0 at the line.
    const samples: { pct: number; t: number }[] = [];
    for (let t = lap.startTick; t <= lap.endTick; t++) {
      const p = lapDistPct[t];
      if (!isFinite(p)) continue;
      if (samples.length === 0 || p >= samples[samples.length - 1].pct - 0.05) {
        samples.push({ pct: Math.min(1, Math.max(0, p)), t });
      }
    }
    if (samples.length < 30) continue;

    // For each target percent, linearly interpolate position from neighbors.
    let j = 0;
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const target = i / (NUM_SAMPLES - 1);
      while (j < samples.length - 2 && samples[j + 1].pct < target) j++;
      const a = samples[j];
      const b = samples[j + 1] ?? a;
      const span = b.pct - a.pct;
      const f = span > 0 ? (target - a.pct) / span : 0;
      const ti = a.t + (b.t - a.t) * f;
      const t0 = Math.floor(ti);
      const t1 = Math.min(xy.x.length - 1, t0 + 1);
      const ff = ti - t0;
      x[i] = xy.x[t0] * (1 - ff) + xy.x[t1] * ff;
      y[i] = xy.y[t0] * (1 - ff) + xy.y[t1] * ff;
      if (channelData) {
        const v = channelData[t0] * (1 - ff) + channelData[t1] * ff;
        c[i] = v;
        if (v < cMin) cMin = v;
        if (v > cMax) cMax = v;
      }
    }

    // Re-anchor each lap so it starts at (0,0). Cheap drift cleanup that
    // makes laps overlay instead of marching across the page.
    const x0 = x[0], y0 = y[0];
    for (let i = 0; i < NUM_SAMPLES; i++) {
      x[i] -= x0;
      y[i] -= y0;
    }

    laps.push({ x, y, c, lap: lap.lap });
  }

  if (!isFinite(cMin)) cMin = 0;
  if (!isFinite(cMax)) cMax = 1;
  if (cMin === cMax) cMax = cMin + 1;

  return { laps, cMin, cMax };
}

/** Linearly close a lap by distributing the closing-error across all points. */
function closeLoop(x: Float32Array, y: Float32Array): { x: Float32Array; y: Float32Array } {
  const n = x.length;
  const dx = x[n - 1] - x[0];
  const dy = y[n - 1] - y[0];
  const ox = new Float32Array(n);
  const oy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    ox[i] = x[i] - dx * f;
    oy[i] = y[i] - dy * f;
  }
  return { x: ox, y: oy };
}

/** Average the per-bin XY across all laps (after each lap is closed). */
function averageLaps(laps: BuiltLap[]): { x: Float32Array; y: Float32Array; c: Float32Array } | null {
  if (laps.length === 0) return null;
  const n = laps[0].x.length;
  const ax = new Float32Array(n);
  const ay = new Float32Array(n);
  const ac = new Float32Array(n);
  const hasC = laps[0].c.length === n;
  let count = 0;
  for (const lap of laps) {
    const closed = closeLoop(lap.x, lap.y);
    for (let i = 0; i < n; i++) {
      ax[i] += closed.x[i];
      ay[i] += closed.y[i];
      if (hasC) ac[i] += lap.c[i];
    }
    count++;
  }
  for (let i = 0; i < n; i++) {
    ax[i] /= count;
    ay[i] /= count;
    if (hasC) ac[i] /= count;
  }
  return { x: ax, y: ay, c: ac };
}

/** Map a value in [min,max] to a color along a channel-specific ramp. */
function rampColor(channel: MapColorChannel, t: number): string {
  const clamp = Math.min(1, Math.max(0, t));
  switch (channel) {
    case "Throttle":
      // Black -> green
      return `oklch(${0.25 + clamp * 0.55} ${0.05 + clamp * 0.18} 145)`;
    case "Brake":
      // Grey -> red
      return `oklch(${0.4 + clamp * 0.4} ${0.02 + clamp * 0.22} 25)`;
    case "Speed":
      // Blue -> cyan -> yellow -> red
      return `oklch(${0.45 + clamp * 0.4} ${0.18} ${250 - clamp * 200})`;
    case "RPM":
      return `oklch(${0.4 + clamp * 0.45} 0.18 ${60 - clamp * 30})`;
    case "Gear":
      return `oklch(${0.55 + clamp * 0.25} 0.16 ${200 + clamp * 100})`;
    default:
      return "var(--ch-default)";
  }
}

export function TrackMap({ parsed }: { parsed: IbtParsed }) {
  const {
    cursorTick,
    refLap,
    cmpLap,
    mapMode,
    mapColorBy,
    setMapMode,
    setMapColorBy,
  } = useWorkbench();

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const clampZoom = (z: number) => Math.min(20, Math.max(1, z));

  const xy = parsed.trackXY;

  // Build the data behind whichever mode is active.
  const built = useMemo(() => {
    if (!xy) return null;

    if (mapMode === "drift") {
      return {
        kind: "drift" as const,
        bounds: { minX: xy.minX, maxX: xy.maxX, minY: xy.minY, maxY: xy.maxY },
      };
    }

    const lapsBuilt = buildLapsByDist(parsed, mapColorBy);
    if (!lapsBuilt || lapsBuilt.laps.length === 0) return null;

    if (mapMode === "averaged") {
      const avg = averageLaps(lapsBuilt.laps);
      if (!avg) return null;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let i = 0; i < avg.x.length; i++) {
        if (avg.x[i] < minX) minX = avg.x[i];
        if (avg.x[i] > maxX) maxX = avg.x[i];
        if (avg.y[i] < minY) minY = avg.y[i];
        if (avg.y[i] > maxY) maxY = avg.y[i];
      }
      return {
        kind: "averaged" as const,
        avg,
        bounds: { minX, maxX, minY, maxY },
        cMin: lapsBuilt.cMin,
        cMax: lapsBuilt.cMax,
      };
    }

    // aligned: every lap re-anchored at start
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const closed = lapsBuilt.laps.map((l) => {
      const c = closeLoop(l.x, l.y);
      for (let i = 0; i < c.x.length; i++) {
        if (c.x[i] < minX) minX = c.x[i];
        if (c.x[i] > maxX) maxX = c.x[i];
        if (c.y[i] < minY) minY = c.y[i];
        if (c.y[i] > maxY) maxY = c.y[i];
      }
      return { x: c.x, y: c.y, c: l.c, lap: l.lap };
    });
    return {
      kind: "aligned" as const,
      laps: closed,
      bounds: { minX, maxX, minY, maxY },
      cMin: lapsBuilt.cMin,
      cMax: lapsBuilt.cMax,
    };
  }, [parsed, xy, mapMode, mapColorBy]);

  const projection = useMemo(() => {
    if (!built) return null;
    const { minX, maxX, minY, maxY } = built.bounds;
    const sx = (W - 2 * PAD) / Math.max(1, maxX - minX);
    const sy = (H - 2 * PAD) / Math.max(1, maxY - minY);
    const s = Math.min(sx, sy);
    return {
      px: (vx: number) => PAD + (vx - minX) * s,
      py: (vy: number) => H - PAD - (vy - minY) * s,
    };
  }, [built]);

  // The faint outline behind everything — always the dead-reckoning trace.
  const outlinePath = useMemo(() => {
    if (!xy || !projection) return "";
    const sx = (W - 2 * PAD) / Math.max(1, xy.maxX - xy.minX);
    const sy = (H - 2 * PAD) / Math.max(1, xy.maxY - xy.minY);
    const s = Math.min(sx, sy);
    const px = (i: number) => PAD + (xy.x[i] - xy.minX) * s;
    const py = (i: number) => H - PAD - (xy.y[i] - xy.minY) * s;
    const step = Math.max(1, Math.floor(xy.x.length / 1500));
    let d = `M ${px(0)} ${py(0)}`;
    for (let i = step; i < xy.x.length; i += step) d += ` L ${px(i)} ${py(i)}`;
    return d;
  }, [xy, projection]);

  // Build colored line as N short segments. Returns array of {d, color}.
  const buildColoredSegments = useCallback(
    (x: Float32Array, y: Float32Array, c: Float32Array, cMin: number, cMax: number) => {
      if (!projection) return [];
      const segs: { d: string; color: string }[] = [];
      const step = Math.max(1, Math.floor(x.length / 250)); // ~250 segments
      for (let i = 0; i < x.length - step; i += step) {
        const x0 = projection.px(x[i]);
        const y0 = projection.py(y[i]);
        const x1 = projection.px(x[i + step]);
        const y1 = projection.py(y[i + step]);
        const v = c.length ? (c[i] + c[i + step]) / 2 : 0;
        const t = (v - cMin) / Math.max(1e-6, cMax - cMin);
        segs.push({ d: `M ${x0} ${y0} L ${x1} ${y1}`, color: rampColor(mapColorBy, t) });
      }
      return segs;
    },
    [projection, mapColorBy],
  );

  if (!xy || !built || !projection) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No position data available
      </div>
    );
  }

  // Cursor dot — always positioned from the dead-reckoning trace
  const dotIdx = Math.min(cursorTick, xy.x.length - 1);
  const sxOut = (W - 2 * PAD) / Math.max(1, xy.maxX - xy.minX);
  const syOut = (H - 2 * PAD) / Math.max(1, xy.maxY - xy.minY);
  const sOut = Math.min(sxOut, syOut);
  const dotX = PAD + (xy.x[dotIdx] - xy.minX) * sOut;
  const dotY = H - PAD - (xy.y[dotIdx] - xy.minY) * sOut;

  // Build per-mode foreground rendering
  let foreground: React.ReactNode = null;
  if (built.kind === "drift") {
    // refLap / cmpLap dashed overlays in the original drift coords
    const lapPath = (lapNum: number | null) => {
      if (lapNum == null) return null;
      const lap = parsed.laps.find((l) => l.lap === lapNum);
      if (!lap) return null;
      const step = Math.max(1, Math.floor(xy.x.length / 1500));
      let d = `M ${PAD + (xy.x[lap.startTick] - xy.minX) * sOut} ${H - PAD - (xy.y[lap.startTick] - xy.minY) * sOut}`;
      for (let i = lap.startTick + 1; i <= lap.endTick; i += step) {
        d += ` L ${PAD + (xy.x[i] - xy.minX) * sOut} ${H - PAD - (xy.y[i] - xy.minY) * sOut}`;
      }
      return d;
    };
    const refD = lapPath(refLap);
    const cmpD = lapPath(cmpLap);
    foreground = (
      <>
        {refD && <path d={refD} fill="none" stroke="var(--ch-speed)" strokeWidth={1.5 / zoom} />}
        {cmpD && (
          <path
            d={cmpD}
            fill="none"
            stroke="var(--ch-throttle)"
            strokeWidth={1.5 / zoom}
            strokeDasharray={`${3 / zoom},${3 / zoom}`}
          />
        )}
      </>
    );
  } else if (built.kind === "aligned") {
    const refLapBuilt = built.laps.find((l) => l.lap === refLap) ?? built.laps[0];
    foreground = (
      <>
        {/* Faint pile of all laps for context */}
        {built.laps.map((l) => {
          if (l.lap === refLapBuilt.lap) return null;
          let d = `M ${projection.px(l.x[0])} ${projection.py(l.y[0])}`;
          for (let i = 1; i < l.x.length; i++) d += ` L ${projection.px(l.x[i])} ${projection.py(l.y[i])}`;
          return (
            <path
              key={l.lap}
              d={d}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={0.6 / zoom}
              opacity={0.35}
            />
          );
        })}
        {/* Reference lap, colored by channel */}
        {mapColorBy === "none" ? (
          <path
            d={(() => {
              let d = `M ${projection.px(refLapBuilt.x[0])} ${projection.py(refLapBuilt.y[0])}`;
              for (let i = 1; i < refLapBuilt.x.length; i++)
                d += ` L ${projection.px(refLapBuilt.x[i])} ${projection.py(refLapBuilt.y[i])}`;
              return d;
            })()}
            fill="none"
            stroke="var(--ch-speed)"
            strokeWidth={2 / zoom}
          />
        ) : (
          buildColoredSegments(
            refLapBuilt.x,
            refLapBuilt.y,
            refLapBuilt.c,
            built.cMin,
            built.cMax,
          ).map((s, i) => (
            <path
              key={i}
              d={s.d}
              fill="none"
              stroke={s.color}
              strokeWidth={2.4 / zoom}
              strokeLinecap="round"
            />
          ))
        )}
      </>
    );
  } else {
    // averaged
    const { avg } = built;
    foreground =
      mapColorBy === "none" ? (
        <path
          d={(() => {
            let d = `M ${projection.px(avg.x[0])} ${projection.py(avg.y[0])}`;
            for (let i = 1; i < avg.x.length; i++)
              d += ` L ${projection.px(avg.x[i])} ${projection.py(avg.y[i])}`;
            return d;
          })()}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.4 / zoom}
        />
      ) : (
        buildColoredSegments(avg.x, avg.y, avg.c, built.cMin, built.cMax).map((s, i) => (
          <path
            key={i}
            d={s.d}
            fill="none"
            stroke={s.color}
            strokeWidth={2.8 / zoom}
            strokeLinecap="round"
          />
        ))
      );
  }

  // Zoom / pan viewBox
  const vbW = W / zoom;
  const vbH = H / zoom;
  const vbX = (W - vbW) / 2 + pan.x;
  const vbY = (H - vbH) / 2 + pan.y;

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
    const my = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = clampZoom(zoom * factor);
    if (newZoom === zoom) return;
    const newVbW = W / newZoom;
    const newVbH = H / newZoom;
    const newVbX = mx - ((e.clientX - rect.left) / rect.width) * newVbW;
    const newVbY = my - ((e.clientY - rect.top) / rect.height) * newVbH;
    setZoom(newZoom);
    setPan({ x: newVbX - (W - newVbW) / 2, y: newVbY - (H - newVbH) / 2 });
  };
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (zoom <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y };
  };
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((e.clientX - d.startX) / rect.width) * vbW;
    const dy = ((e.clientY - d.startY) / rect.height) * vbH;
    setPan({ x: d.panX - dx, y: d.panY - dy });
  };
  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  };
  const zoomBy = (factor: number) => setZoom((z) => clampZoom(z * factor));

  const colorChannel = mapColorBy !== "none" ? parsed.channels[mapColorBy] : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Track · {parsed.meta.trackDisplayName ?? parsed.meta.trackName ?? ""}
        </span>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-px overflow-hidden rounded-sm border border-border">
            {(["drift", "aligned", "averaged"] as MapMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setMapMode(m)}
                className={`px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                  mapMode === m ? "bg-primary text-primary-foreground" : "bg-rail text-muted-foreground hover:text-foreground"
                }`}
                title={
                  m === "drift"
                    ? "Raw integrated path"
                    : m === "aligned"
                      ? "Per-lap aligned overlay"
                      : "Averaged stable racing line"
                }
              >
                {m}
              </button>
            ))}
          </div>
          <select
            value={mapColorBy}
            onChange={(e) => setMapColorBy(e.target.value as MapColorChannel)}
            className="rounded-sm border border-border bg-rail px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
            title="Color racing line by channel"
          >
            <option value="none">No color</option>
            <option value="Throttle">Throttle</option>
            <option value="Brake">Brake</option>
            <option value="Speed">Speed</option>
            <option value="RPM">RPM</option>
            <option value="Gear">Gear</option>
          </select>
          <span className="mr-1 font-mono text-[10px] tabular-nums text-muted-foreground">
            {zoom.toFixed(1)}×
          </span>
          <button
            onClick={() => zoomBy(1 / 1.5)}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-border hover:bg-accent disabled:opacity-40"
            disabled={zoom <= 1}
            title="Zoom out"
          >
            <Minus className="h-3 w-3" />
          </button>
          <button
            onClick={() => zoomBy(1.5)}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-border hover:bg-accent disabled:opacity-40"
            disabled={zoom >= 20}
            title="Zoom in"
          >
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={reset}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-border hover:bg-accent"
            title="Reset view"
          >
            <Maximize2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <svg
          ref={svgRef}
          viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full touch-none select-none"
          style={{ cursor: zoom > 1 ? (dragRef.current ? "grabbing" : "grab") : "default" }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={reset}
        >
          {/* Faint full-session reference outline */}
          {mapMode !== "averaged" && (
            <path
              d={outlinePath}
              fill="none"
              stroke="var(--border-strong)"
              strokeWidth={1 / zoom}
              opacity={mapMode === "drift" ? 0.5 : 0.18}
            />
          )}
          {foreground}
          <circle cx={dotX} cy={dotY} r={5 / zoom} fill="var(--primary)" stroke="white" strokeWidth={1.5 / zoom} />
        </svg>
      </div>
      {/* Color-channel legend */}
      {mapColorBy !== "none" && built.kind !== "drift" && colorChannel && (
        <div className="hairline-t flex items-center gap-2 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{mapColorBy}</span>
          <span className="tabular-nums">{built.cMin.toFixed(1)}</span>
          <span
            className="h-1.5 flex-1 rounded-full"
            style={{
              background: `linear-gradient(to right, ${rampColor(mapColorBy, 0)}, ${rampColor(mapColorBy, 0.5)}, ${rampColor(mapColorBy, 1)})`,
            }}
          />
          <span className="tabular-nums">{built.cMax.toFixed(1)}</span>
          {colorChannel.unit && <span>{colorChannel.unit}</span>}
        </div>
      )}
    </div>
  );
}
