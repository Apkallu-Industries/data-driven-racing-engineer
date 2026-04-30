import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

export function TrackMap({ parsed }: { parsed: IbtParsed }) {
  const { cursorTick, refLap, cmpLap } = useWorkbench();
  const xy = parsed.trackXY;
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

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Track · {parsed.meta.trackDisplayName ?? parsed.meta.trackName ?? ""}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2">
        <svg
          viewBox={`0 0 ${path.w} ${path.h}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-full w-full"
        >
          <path d={path.d} fill="none" stroke="var(--border-strong)" strokeWidth={1} opacity={0.5} />
          {path.refPath && <path d={path.refPath} fill="none" stroke="var(--ch-speed)" strokeWidth={1.5} />}
          {path.cmpPath && <path d={path.cmpPath} fill="none" stroke="var(--ch-throttle)" strokeWidth={1.5} strokeDasharray="3,3" />}
          <circle cx={path.dotX} cy={path.dotY} r={5} fill="var(--primary)" stroke="white" strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  );
}