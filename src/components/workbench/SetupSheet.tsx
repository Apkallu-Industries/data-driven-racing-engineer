import { useMemo, useState } from "react";
import { ChevronRight, ChevronDown, Wrench, Search } from "lucide-react";
import type { IbtParsed } from "@/lib/ibt/types";
import { parseCarSetup, type SetupNode } from "@/lib/ibt/setup";

const NUM_RE = /^(-?\d+(?:\.\d+)?)(?:\s*([a-zA-Z%°"'/]+))?$/;

function isNumeric(v: string): boolean {
  return NUM_RE.test(v) || /^-?\d+\/\d+/.test(v);
}

function groupOrder(name: string): number {
  const order = ["Chassis", "TiresAero", "Tires", "Aero", "Drivetrain", "Brakes", "Dampers", "InCarDials"];
  const i = order.indexOf(name);
  return i < 0 ? 99 : i;
}

function Row({ k, v }: { k: string; v: string }) {
  const numeric = isNumeric(v);
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5 font-mono text-[11px]">
      <span className="truncate text-muted-foreground">{k}</span>
      <span className={numeric ? "tabular-nums text-foreground" : "text-foreground"}>{v}</span>
    </div>
  );
}

function Group({
  name,
  node,
  depth,
  filter,
  defaultOpen,
}: {
  name: string;
  node: SetupNode;
  depth: number;
  filter: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const entries = Object.entries(node);
  const matches = (k: string, v: string | SetupNode): boolean => {
    if (!filter) return true;
    if (k.toLowerCase().includes(filter)) return true;
    if (typeof v === "string") return v.toLowerCase().includes(filter);
    return Object.entries(v).some(([kk, vv]) => matches(kk, vv));
  };
  const visible = entries.filter(([k, v]) => matches(k, v));
  if (visible.length === 0) return null;
  const isOpen = open || (filter.length > 0);
  return (
    <div className={depth === 0 ? "hairline-b" : ""}>
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-1 px-3 py-1 text-left font-mono text-[11px] uppercase tracking-wider hover:bg-accent ${
          depth === 0 ? "bg-rail text-foreground" : "text-muted-foreground"
        }`}
        style={{ paddingLeft: 12 + depth * 12 }}
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {name}
        <span className="ml-auto text-muted-foreground/70">{visible.length}</span>
      </button>
      {isOpen && (
        <div className="px-3 pb-1" style={{ paddingLeft: 24 + depth * 12 }}>
          {visible.map(([k, v]) =>
            typeof v === "string" ? (
              <Row key={k} k={k} v={v} />
            ) : (
              <Group key={k} name={k} node={v} depth={depth + 1} filter={filter} defaultOpen={depth < 1} />
            ),
          )}
        </div>
      )}
    </div>
  );
}

export function SetupSheet({ parsed }: { parsed: IbtParsed }) {
  const [filter, setFilter] = useState("");
  const setup = useMemo(
    () => (parsed.meta.sessionInfoYaml ? parseCarSetup(parsed.meta.sessionInfoYaml) : null),
    [parsed.meta.sessionInfoYaml],
  );

  if (!setup) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
        <Wrench className="h-5 w-5 text-muted-foreground" />
        <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          No setup data in this .ibt
        </div>
        <p className="max-w-sm font-mono text-[11px] text-muted-foreground/80">
          iRacing only embeds car setup when telemetry is recorded from the garage/in-car.
          Re-record after exiting the garage and the CarSetup block will appear here.
        </p>
      </div>
    );
  }

  const groups = Object.entries(setup.tree).sort(
    ([a], [b]) => groupOrder(a) - groupOrder(b),
  );
  const f = filter.trim().toLowerCase();
  const totalParams = Object.keys(setup.flat).length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="hairline-b flex items-center gap-2 px-3 py-1.5">
        <Wrench className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-wider">Car Setup</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {totalParams} params
          {setup.updateCount != null ? ` · update #${setup.updateCount}` : ""}
        </span>
        <div className="ml-auto flex items-center gap-1.5 rounded-sm border border-border bg-rail px-2">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            className="h-6 w-40 bg-transparent font-mono text-[11px] outline-none placeholder:text-muted-foreground/60"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.map(([name, node]) =>
          typeof node === "string" ? (
            <div key={name} className="px-3 py-1">
              <Row k={name} v={node} />
            </div>
          ) : (
            <Group key={name} name={name} node={node} depth={0} filter={f} defaultOpen={true} />
          ),
        )}
      </div>
    </div>
  );
}