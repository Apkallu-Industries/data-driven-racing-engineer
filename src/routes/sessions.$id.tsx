import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useWorkbench } from "@/lib/store";
import { parseIbtInWorker } from "@/lib/ibt/parseInWorker";
import { AppHeader } from "@/components/AppHeader";
import { ChannelBrowser } from "@/components/workbench/ChannelBrowser";
import { StackedTraces } from "@/components/workbench/StackedTraces";
import { TrackMap } from "@/components/workbench/TrackMap";
import { LiveReadout } from "@/components/workbench/LiveReadout";
import { Timeline } from "@/components/workbench/Timeline";
import { LapList } from "@/components/workbench/LapList";
import { GGDiagram } from "@/components/workbench/GGDiagram";
import { OptimalLap } from "@/components/workbench/OptimalLap";
import { Counterfactuals } from "@/components/workbench/Counterfactuals";
import { BrakeBias } from "@/components/workbench/BrakeBias";
import { SlipAngle } from "@/components/workbench/SlipAngle";
import { AICoach } from "@/components/workbench/AICoach";
import { ReplayThree } from "@/components/workbench/ReplayThree";
import { PianoRoll } from "@/components/workbench/PianoRoll";
import { SectorSpider } from "@/components/workbench/SectorSpider";
import { SetupSheet } from "@/components/workbench/SetupSheet";
import { ShareButton } from "@/components/workbench/ShareButton";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

export const Route = createFileRoute("/sessions/$id")({
  head: () => ({
    meta: [
      { title: "Workbench — ApexTrace" },
      { name: "description", content: "Telemetry workbench for an iRacing .ibt session." },
    ],
  }),
  component: WorkbenchPage,
});

function WorkbenchPage() {
  const { id } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { parsed, setParsed, refLap, cmpLap, setRefLap, setCmpLap } = useWorkbench();
  const [sess, setSess] = useState<Tables<"telemetry_sessions"> | null>(null);
  const [progress, setProgress] = useState<{ phase: string; pct: number; msg?: string } | null>({ phase: "fetch", pct: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<
    "readout" | "laps" | "gg" | "optimal" | "whatif" | "brake" | "slip" | "replay3d" | "piano" | "spider" | "setup"
  >("readout");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  useEffect(() => {
    let cancelled = false;
    setParsed(null);
    setProgress({ phase: "fetch", pct: 0 });
    (async () => {
      try {
        const { data: row, error: e1 } = await supabase
          .from("telemetry_sessions")
          .select("*")
          .eq("id", id)
          .single();
        if (e1) throw e1;
        if (cancelled) return;
        setSess(row);
        setProgress({ phase: "download", pct: 5 });
        const { data: blob, error: e2 } = await supabase.storage
          .from("telemetry")
          .download(row.storage_path);
        if (e2) throw e2;
        const buf = await blob.arrayBuffer();
        if (cancelled) return;
        const result = await parseIbtInWorker(buf, (phase, pct, msg) => {
          if (!cancelled) setProgress({ phase, pct: 5 + Math.floor(pct * 0.95), msg });
        });
        if (cancelled) return;
        setParsed(result);
        setProgress(null);
      } catch (e) {
        if (!cancelled) {
          const m = (e as Error).message;
          setErr(m);
          toast.error(m);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, setParsed]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader>
        <span className="font-mono uppercase tracking-wider">{sess?.track ?? "…"}</span>
        <span className="text-muted-foreground">·</span>
        <span>{sess?.car ?? ""}</span>
        {parsed && (
          <>
            <span className="text-muted-foreground">·</span>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Lap</span>
              <select
                value={refLap ?? ""}
                onChange={(e) => setRefLap(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                className="rounded-sm border border-border bg-rail px-2 py-0.5 font-mono text-xs"
              >
                <option value="">All</option>
                {parsed.laps.map((l) => (
                  <option key={l.lap} value={l.lap}>
                    Lap {l.lap} · {l.timeS.toFixed(3)}s
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              <span className="text-muted-foreground">vs</span>
              <select
                value={cmpLap ?? ""}
                onChange={(e) => setCmpLap(e.target.value === "" ? null : parseInt(e.target.value, 10))}
                className="rounded-sm border border-border bg-rail px-2 py-0.5 font-mono text-xs"
              >
                <option value="">—</option>
                {parsed.laps.map((l) => (
                  <option key={l.lap} value={l.lap}>
                    Lap {l.lap} · {l.timeS.toFixed(3)}s
                  </option>
                ))}
              </select>
            </label>
            <ShareButton sessionId={id} />
          </>
        )}
      </AppHeader>

      {err && (
        <div className="bg-destructive/20 px-3 py-2 text-sm text-destructive-foreground">{err}</div>
      )}

      {!parsed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {progress?.phase ?? "loading"} · {progress?.pct ?? 0}%
          </div>
          {progress?.msg && <div className="font-mono text-[11px] text-muted-foreground">{progress.msg}</div>}
          <div className="h-1 w-72 overflow-hidden rounded-full bg-rail">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress?.pct ?? 0}%` }} />
          </div>
        </div>
      ) : (
        <>
          <div className="flex min-h-0 flex-1">
            <ChannelBrowser parsed={parsed} />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 overflow-hidden">
                <StackedTraces parsed={parsed} />
              </div>
              <Timeline parsed={parsed} />
              <div className="hairline-t flex h-72 shrink-0">
                <div className="hairline-r w-1/2 bg-panel">
                  <TrackMap parsed={parsed} />
                </div>
                <div className="flex flex-1 flex-col bg-panel">
                  <div className="hairline-b flex items-center gap-px bg-border font-mono text-[11px] uppercase tracking-wider">
                    {(["readout", "laps", "gg", "optimal", "whatif", "brake", "slip", "replay3d", "piano", "spider", "setup"] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setBottomTab(t)}
                        className={`flex-1 px-3 py-1.5 text-left ${
                          bottomTab === t
                            ? "bg-panel text-foreground"
                            : "bg-rail text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t === "readout"
                          ? "Readout"
                          : t === "laps"
                            ? `Laps · ${parsed.laps.length}`
                            : t === "gg"
                              ? "g-g"
                              : t === "optimal"
                                ? "Optimal"
                                : t === "whatif"
                                  ? "What-if"
                                  : t === "brake"
                                    ? "Brake"
                                    : t === "slip"
                                      ? "Slip"
                                      : t === "replay3d"
                                        ? "3D"
                                        : t === "piano"
                                          ? "Piano"
                                          : t === "spider"
                                            ? "Spider"
                                            : "Setup"}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 flex-1">
                    {bottomTab === "readout" && <LiveReadout parsed={parsed} />}
                    {bottomTab === "laps" && <LapList parsed={parsed} />}
                    {bottomTab === "gg" && <GGDiagram parsed={parsed} />}
                    {bottomTab === "optimal" && <OptimalLap parsed={parsed} />}
                    {bottomTab === "whatif" && <Counterfactuals parsed={parsed} />}
                    {bottomTab === "brake" && <BrakeBias parsed={parsed} />}
                    {bottomTab === "slip" && <SlipAngle parsed={parsed} />}
                    {bottomTab === "replay3d" && <ReplayThree parsed={parsed} />}
                    {bottomTab === "piano" && <PianoRoll parsed={parsed} />}
                    {bottomTab === "spider" && <SectorSpider parsed={parsed} />}
                    {bottomTab === "setup" && <SetupSheet parsed={parsed} />}
                  </div>
                </div>
              </div>
              <AICoach parsed={parsed} track={sess?.track} car={sess?.car} sessionId={id} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}