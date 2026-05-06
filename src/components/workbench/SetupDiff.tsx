import { useEffect, useMemo, useState } from "react";
import { GitCompare, Loader2, Flame } from "lucide-react";
import type { IbtParsed } from "@/lib/ibt/types";
import { parseCarSetup, diffSetups, type SetupDiff as SetupDiffRow } from "@/lib/ibt/setup";
import { fetchPbSetup } from "@/server/setup.functions";

function fmtDelta(d: SetupDiffRow): string | null {
  if (!d.numericDelta) return null;
  const { value, unit } = d.numericDelta;
  if (!Number.isFinite(value) || value === 0) return null;
  const sign = value > 0 ? "+" : "";
  const abs = Math.abs(value);
  const precision = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  return `${sign}${value.toFixed(precision)}${unit ? ` ${unit}` : ""}`;
}

const TOP_N = 10;

/** Magnitude of a numeric delta normalized by the PB ("a") value so units don't dominate. */
function deltaMagnitude(d: SetupDiffRow): number {
  if (!d.numericDelta) return 0;
  const v = Math.abs(d.numericDelta.value);
  if (!Number.isFinite(v) || v === 0) return 0;
  // Normalize against PB value when parseable, else fall back to raw magnitude.
  const aMatch = d.a?.match(/-?\d+(?:\.\d+)?/);
  const base = aMatch ? Math.abs(parseFloat(aMatch[0])) : 0;
  return base > 1e-6 ? v / base : v;
}

function groupOf(path: string): string {
  const i = path.indexOf(".");
  return i < 0 ? "Other" : path.slice(0, i);
}

const GROUP_ORDER = [
  "Chassis",
  "TiresAero",
  "Tires",
  "Aero",
  "Drivetrain",
  "Brakes",
  "Dampers",
  "InCarDials",
];
function groupRank(g: string): number {
  const i = GROUP_ORDER.indexOf(g);
  return i < 0 ? 99 : i;
}

export function SetupDiff({
  parsed,
  track,
  car,
  sessionId,
}: {
  parsed: IbtParsed;
  track?: string | null;
  car?: string | null;
  sessionId: string;
}) {
  const [pb, setPb] = useState<
    | { sessionId: string; name: string; recordedAt: string | null; bestLapS: number | null; setupYaml: string }
    | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const current = useMemo(
    () => (parsed.meta.sessionInfoYaml ? parseCarSetup(parsed.meta.sessionInfoYaml) : null),
    [parsed.meta.sessionInfoYaml],
  );

  useEffect(() => {
    if (!track || !car) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    fetchPbSetup({ data: { track, car, excludeSessionId: sessionId } })
      .then((res) => {
        if (cancelled) return;
        if ("error" in res && res.error) setErr(res.error);
        else setPb(("pb" in res ? res.pb : null) ?? null);
      })
      .catch((e) => !cancelled && setErr((e as Error).message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [track, car, sessionId]);

  const pbParsed = useMemo(() => (pb ? parseCarSetup(pb.setupYaml) : null), [pb]);
  const diffs = useMemo(
    () => (current && pbParsed ? diffSetups(pbParsed, current) : []),
    [current, pbParsed],
  );

  /** Set of paths that are in the top-N biggest numeric deltas. */
  const topPaths = useMemo(() => {
    const ranked = diffs
      .filter((d) => d.numericDelta && d.numericDelta.value !== 0)
      .map((d) => ({ path: d.path, mag: deltaMagnitude(d) }))
      .sort((a, b) => b.mag - a.mag)
      .slice(0, TOP_N);
    return new Set(ranked.map((r) => r.path));
  }, [diffs]);

  /** Group diffs by top-level section, ordered by canonical setup-sheet order. */
  const grouped = useMemo(() => {
    const m = new Map<string, SetupDiffRow[]>();
    for (const d of diffs) {
      const g = groupOf(d.path);
      const arr = m.get(g);
      if (arr) arr.push(d);
      else m.set(g, [d]);
    }
    return [...m.entries()].sort(([a], [b]) => groupRank(a) - groupRank(b));
  }, [diffs]);

  if (!current) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] text-muted-foreground">
        No setup data in this .ibt — record from the garage to capture CarSetup.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading PB setup…
      </div>
    );
  }
  if (err) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] text-destructive">
        {err}
      </div>
    );
  }
  if (!pb || !pbParsed) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center font-mono text-[11px] text-muted-foreground">
        No prior PB session with setup found for this car/track.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="hairline-b flex items-center gap-2 px-3 py-1.5">
        <GitCompare className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] uppercase tracking-wider">Setup Diff</span>
        <span className="font-mono text-[10px] text-muted-foreground">
          vs PB · {pb.name}
          {pb.bestLapS != null ? ` · ${pb.bestLapS.toFixed(3)}s` : ""} · {diffs.length} changes
        </span>
      </div>
      {diffs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center font-mono text-[11px] text-muted-foreground">
          Setup identical to PB.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-rail text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-1 text-left font-normal">Parameter</th>
                <th className="px-2 py-1 text-right font-normal">PB</th>
                <th className="px-2 py-1 text-right font-normal">Current</th>
                <th className="px-3 py-1 text-right font-normal">Δ</th>
              </tr>
            </thead>
            {grouped.map(([group, rows]) => (
              <tbody key={group}>
                <tr className="bg-rail/60">
                  <td
                    colSpan={4}
                    className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    {group}
                    <span className="ml-2 text-muted-foreground/60">{rows.length}</span>
                  </td>
                </tr>
                {rows.map((d) => {
                  const delta = fmtDelta(d);
                  const isTop = topPaths.has(d.path);
                  // Strip group prefix for compact display.
                  const shortPath = d.path.startsWith(group + ".")
                    ? d.path.slice(group.length + 1)
                    : d.path;
                  return (
                    <tr
                      key={d.path}
                      className={`hairline-b hover:bg-accent/40 ${
                        isTop ? "bg-primary/5" : ""
                      }`}
                    >
                      <td
                        className="truncate px-3 py-0.5 text-muted-foreground"
                        title={d.path}
                      >
                        <span className="inline-flex items-center gap-1">
                          {isTop && (
                            <Flame className="h-3 w-3 text-primary" aria-label="Top delta" />
                          )}
                          <span className={isTop ? "text-foreground" : ""}>{shortPath}</span>
                        </span>
                      </td>
                      <td className="px-2 py-0.5 text-right tabular-nums text-foreground/70">
                        {d.a ?? "—"}
                      </td>
                      <td className="px-2 py-0.5 text-right tabular-nums text-foreground">
                        {d.b ?? "—"}
                      </td>
                      <td
                        className={`px-3 py-0.5 text-right tabular-nums ${
                          isTop ? "font-semibold" : ""
                        } ${
                          delta
                            ? delta.startsWith("+")
                              ? "text-[var(--ch-throttle)]"
                              : "text-[var(--ch-brake)]"
                            : "text-muted-foreground"
                        }`}
                      >
                        {delta ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}
    </div>
  );
}