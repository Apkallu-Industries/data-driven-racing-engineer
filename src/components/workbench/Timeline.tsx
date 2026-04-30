import { useEffect, useRef } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { Play, Pause } from "lucide-react";

export function Timeline({ parsed }: { parsed: IbtParsed }) {
  const { cursorTick, setCursorTick, playing, setPlaying, speed, setSpeed } = useWorkbench();
  const total = parsed.meta.numTicks;
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      lastRef.current = null;
      return;
    }
    const step = (t: number) => {
      const last = lastRef.current ?? t;
      const dtMs = t - last;
      lastRef.current = t;
      const ticksAdv = (dtMs / 1000) * parsed.meta.tickRate * speed;
      const next = Math.min(total - 1, cursorTick + Math.max(1, Math.round(ticksAdv)));
      setCursorTick(next);
      if (next >= total - 1) setPlaying(false);
      else rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  return (
    <div className="hairline-t flex items-center gap-3 bg-panel px-3 py-2">
      <button
        onClick={() => setPlaying(!playing)}
        className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground hover:opacity-90"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </button>
      <select
        value={speed}
        onChange={(e) => setSpeed(parseFloat(e.target.value))}
        className="rounded-sm border border-border bg-rail px-2 py-1 font-mono text-xs"
      >
        {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
          <option key={s} value={s}>{s}×</option>
        ))}
      </select>
      <div className="relative flex-1">
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={cursorTick}
          onChange={(e) => setCursorTick(parseInt(e.target.value, 10))}
          className="w-full accent-[color:var(--primary)]"
        />
        {/* Lap markers */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-2 -translate-y-1/2">
          {parsed.laps.map((l) => (
            <div
              key={l.lap}
              className="absolute h-full w-px bg-muted-foreground opacity-50"
              style={{ left: `${(l.startTick / Math.max(1, total - 1)) * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="font-mono text-xs tabular-nums text-muted-foreground">
        {cursorTick} / {total - 1}
      </div>
    </div>
  );
}