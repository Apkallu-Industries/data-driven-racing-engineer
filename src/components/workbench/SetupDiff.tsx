import { useEffect, useMemo, useState } from "react";
import { GitCompare, Loader2 } from "lucide-react";
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
            <tbody>
              {diffs.map((d) => {
                const delta = fmtDelta(d);
                return (
                  <tr key={d.path} className="hairline-b hover:bg-accent/40">
                    <td className="truncate px-3 py-0.5 text-muted-foreground" title={d.path}>
                      {d.path}
                    </td>
                    <td className="px-2 py-0.5 text-right tabular-nums text-foreground/70">
                      {d.a ?? "—"}
                    </td>
                    <td className="px-2 py-0.5 text-right tabular-nums text-foreground">
                      {d.b ?? "—"}
                    </td>
                    <td
                      className={`px-3 py-0.5 text-right tabular-nums ${
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
          </table>
        </div>
      )}
    </div>
  );
}