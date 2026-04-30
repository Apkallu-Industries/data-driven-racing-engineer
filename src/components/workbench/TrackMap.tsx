import { useMemo, useRef, useState, useCallback } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { Plus, Minus, Maximize2 } from "lucide-react";

export function TrackMap({ parsed }: { parsed: IbtParsed }) {
  const { cursorTick, refLap, cmpLap } = useWorkbench();
  const xy = parsed.trackXY;
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const clampZoom = (z: number) => Math.min(20, Math.max(1, z));

  const path = useMemo(() => {
    if (!xy) return null;
    const w = 400, h = 260, pad = 16;
    const sx = (w - 2 * pad) / Math.max(1, xy.maxX - xy.minX);
    const sy = (h - 2 * pad) / Math.max(1, xy.maxY - xy.minY);
    const s = Math.min(sx, sy);
    const px = (i: number) => pad + (xy.x[i] - xy.minX) * s;
    const py = (i: number) => h - pad - (xy.y[i] - xy.minY) * s;

    // Sample every Nth point for the outline
    const step = Math.max(1, Math.floor(xy.x.length / 1500));
    let d = `M ${px(0)} ${py(0)}`;
    for (let i = step; i < xy.x.length; i += step) d += ` L ${px(i)} ${py(i)}`;

    const dotIdx = Math.min(cursorTick, xy.x.length - 1);
    const refPath = (() => {
      if (refLap == null) return null;
      const lap = parsed.laps.find((l) => l.lap === refLap);
      if (!lap) return null;
      let p = `M ${px(lap.startTick)} ${py(lap.startTick)}`;
      for (let i = lap.startTick + 1; i <= lap.endTick; i += step) p += ` L ${px(i)} ${py(i)}`;
      return p;
    })();
    const cmpPath = (() => {
      if (cmpLap == null) return null;
      const lap = parsed.laps.find((l) => l.lap === cmpLap);
      if (!lap) return null;
      let p = `M ${px(lap.startTick)} ${py(lap.startTick)}`;
      for (let i = lap.startTick + 1; i <= lap.endTick; i += step) p += ` L ${px(i)} ${py(i)}`;
      return p;
    })();
    return { d, w, h, dotX: px(dotIdx), dotY: py(dotIdx), refPath, cmpPath };
  }, [xy, cursorTick, refLap, cmpLap, parsed.laps]);

  if (!xy || !path) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No position data available
      </div>
    );
  }

  // Compute the visible viewBox by zooming around the center + pan offset.
  // pan is in viewBox units.
  const vbW = path.w / zoom;
  const vbH = path.h / zoom;
  const vbX = (path.w - vbW) / 2 + pan.x;
  const vbY = (path.h - vbH) / 2 + pan.y;

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // Mouse position in viewBox coords (before zoom change)
    const mx = vbX + ((e.clientX - rect.left) / rect.width) * vbW;
    const my = vbY + ((e.clientY - rect.top) / rect.height) * vbH;
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = clampZoom(zoom * factor);
    if (newZoom === zoom) return;
    const newVbW = path.w / newZoom;
    const newVbH = path.h / newZoom;
    // Keep cursor anchored: solve for new pan so (mx, my) stays under the mouse
    const newVbX = mx - ((e.clientX - rect.left) / rect.width) * newVbW;
    const newVbY = my - ((e.clientY - rect.top) / rect.height) * newVbH;
    setZoom(newZoom);
    setPan({ x: newVbX - (path.w - newVbW) / 2, y: newVbY - (path.h - newVbH) / 2 });
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

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Track · {parsed.meta.trackDisplayName ?? parsed.meta.trackName ?? ""}
        </span>
        <div className="flex items-center gap-1">
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
          {/* Keep stroke widths visually constant when zoomed */}
          <path d={path.d} fill="none" stroke="var(--border-strong)" strokeWidth={1 / zoom} opacity={0.5} />
          {path.refPath && <path d={path.refPath} fill="none" stroke="var(--ch-speed)" strokeWidth={1.5 / zoom} />}
          {path.cmpPath && <path d={path.cmpPath} fill="none" stroke="var(--ch-throttle)" strokeWidth={1.5 / zoom} strokeDasharray={`${3 / zoom},${3 / zoom}`} />}
          <circle cx={path.dotX} cy={path.dotY} r={5 / zoom} fill="var(--primary)" stroke="white" strokeWidth={1.5 / zoom} />
        </svg>
      </div>
    </div>
  );
}