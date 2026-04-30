import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench, colorForChannel, DEFAULT_CHANNELS } from "@/lib/store";

export function LiveReadout({ parsed }: { parsed: IbtParsed }) {
  const { cursorTick } = useWorkbench();
  const items = DEFAULT_CHANNELS.filter((n) => n in parsed.channels);
  const sessionTime = parsed.channels["SessionTime"]?.data[cursorTick] ?? 0;
  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Readout</span>
        <span className="tabular-nums text-foreground">t = {sessionTime.toFixed(3)} s</span>
      </div>
      <div className="grid flex-1 grid-cols-2 gap-px bg-border p-px">
        {items.map((name) => {
          const ch = parsed.channels[name];
          const v = ch.data[cursorTick];
          const pct = ch.max > ch.min ? ((v - ch.min) / (ch.max - ch.min)) * 100 : 0;
          return (
            <div key={name} className="bg-panel p-2">
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span style={{ color: colorForChannel(name) }}>{name}</span>
                <span>{ch.unit}</span>
              </div>
              <div className="mt-1 font-mono text-2xl tabular-nums">{Number.isFinite(v) ? v.toFixed(2) : "—"}</div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-rail">
                <div className="h-full" style={{ width: `${pct}%`, background: colorForChannel(name) }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}