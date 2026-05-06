import { useMemo, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench, colorForChannel } from "@/lib/store";
import { Search, ChevronRight, ChevronDown } from "lucide-react";
import { catalogEntry, ESSENTIAL_CHANNELS } from "@/lib/ibt/channelCatalog";

export function ChannelBrowser({ parsed }: { parsed: IbtParsed }) {
  const { selectedChannels, toggleChannel, cursorTick } = useWorkbench();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ "Driver Inputs": true, Vehicle: true });

  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    // Essentials pinned section: catalog-ordered, only channels actually present.
    const essentials = ESSENTIAL_CHANNELS.filter((n) => parsed.channels[n] && (!q || n.toLowerCase().includes(q.toLowerCase())));
    if (essentials.length) groups["Essentials"] = essentials;
    for (const name of parsed.channelNames) {
      if (q && !name.toLowerCase().includes(q.toLowerCase())) continue;
      const cat = catalogEntry(name);
      const g = cat?.group ?? parsed.channels[name].group;
      (groups[g] ??= []).push(name);
    }
    // Stable order: Essentials first, then alphabetic.
    const ordered: Record<string, string[]> = {};
    if (groups["Essentials"]) ordered["Essentials"] = groups["Essentials"];
    Object.keys(groups)
      .filter((g) => g !== "Essentials")
      .sort()
      .forEach((g) => (ordered[g] = groups[g]));
    return ordered;
  }, [parsed, q]);

  return (
    <aside className="hairline-r flex h-full w-72 flex-col bg-rail">
      <div className="hairline-b p-2">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${parsed.channelNames.length} channels…`}
            className="w-full rounded-sm border border-border bg-panel py-1.5 pl-7 pr-2 text-xs outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto font-mono text-[11px]">
        {Object.entries(grouped).map(([g, items]) => {
          const isOpen = open[g] ?? !!q;
          return (
            <div key={g} className="hairline-b">
              <button
                onClick={() => setOpen({ ...open, [g]: !isOpen })}
                className="flex w-full items-center gap-1 px-2 py-1.5 text-left uppercase tracking-wider text-muted-foreground hover:bg-accent"
              >
                {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                {g}
                <span className="ml-auto">{items.length}</span>
              </button>
              {isOpen && (
                <ul>
                  {items.map((name) => {
                    const ch = parsed.channels[name];
                    const sel = selectedChannels.includes(name);
                    const v = ch.data[cursorTick] ?? 0;
                    const cat = catalogEntry(name);
                    return (
                      <li key={name}>
                        <button
                          onClick={() => toggleChannel(name)}
                          title={cat?.desc ?? ch.desc ?? name}
                          className={`flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-accent ${sel ? "bg-accent/60" : ""}`}
                        >
                          <span
                            className="inline-block h-2 w-2 rounded-full"
                            style={{ background: sel ? colorForChannel(name) : "transparent", outline: "1px solid var(--border-strong)" }}
                          />
                          <span className="truncate">{name}</span>
                          <span className="ml-auto tabular-nums text-muted-foreground">
                            {Number.isFinite(v) ? v.toFixed(2) : "—"}
                            {ch.unit ? ` ${ch.unit}` : ""}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}