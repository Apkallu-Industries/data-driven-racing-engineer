import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/auth";
import { useWorkbench } from "@/lib/store";
import { useLiveBridge, buildLiveParsed } from "@/lib/liveBridge";
import { ChannelBrowser } from "@/components/workbench/ChannelBrowser";
import { StackedTraces } from "@/components/workbench/StackedTraces";
import { TrackMap } from "@/components/workbench/TrackMap";
import { LiveReadout } from "@/components/workbench/LiveReadout";
import { Timeline } from "@/components/workbench/Timeline";
import { LapList } from "@/components/workbench/LapList";
import { GGDiagram } from "@/components/workbench/GGDiagram";
import { BrakeBias } from "@/components/workbench/BrakeBias";
import { SlipAngle } from "@/components/workbench/SlipAngle";
import { PianoRoll } from "@/components/workbench/PianoRoll";
import { CinemaPlayback } from "@/components/workbench/CinemaPlayback";

/**
 * Live workbench. Polls the live bridge ring buffer every 250ms, synthesizes
 * a pseudo-IbtParsed, and feeds it to the shared `useWorkbench` store so all
 * the same widgets (Cinema, TrackMap, g-g, Brake, Slip, Piano, Laps, Readout,
 * StackedTraces) render the live stream unchanged.
 */
export const Route = createFileRoute("/live/workbench")({
  head: () => ({
    meta: [
      { title: "Live Workbench — ApexTrace" },
      { name: "description", content: "Live iRacing telemetry workbench fed by the local bridge." },
    ],
  }),
  component: LiveWorkbenchPage,
});

function LiveWorkbenchPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { parsed, setParsed, setCursorTick } = useWorkbench();
  const { status, hz, lap, sessionTime, connect, url, tickCount } = useLiveBridge();
  const [bottomTab, setBottomTab] = useState<
    "cinema" | "readout" | "laps" | "gg" | "brake" | "slip" | "piano"
  >("cinema");

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  // Auto-connect on mount.
  useEffect(() => {
    if (status === "disconnected") connect(url);
    return () => {
      // Don't tear down — user may navigate to /live and back.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll ring buffer → IbtParsed. 4 Hz is enough for charts; pedals/HUD
  // already update at WebSocket cadence inside CinemaPlayback via cursorTick
  // = latest tick.
  useEffect(() => {
    let alive = true;
    let lastTickSeen = -1;
    const tick = () => {
      if (!alive) return;
      const current = useLiveBridge.getState().tickCount;
      if (current !== lastTickSeen) {
        const p = buildLiveParsed();
        if (p) {
          setParsed(p);
          // Always pin cursor to the latest sample for true "live" feel.
          setCursorTick(p.meta.numTicks - 1);
        }
        lastTickSeen = current;
      }
    };
    const id = setInterval(tick, 250);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [setParsed, setCursorTick]);

  // Keep cursor pinned to latest as new samples arrive between polls.
  useEffect(() => {
    if (parsed) setCursorTick(parsed.meta.numTicks - 1);
  }, [parsed, setCursorTick, tickCount]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader>
        <span className="font-mono uppercase tracking-wider">Live Workbench</span>
        <span className="text-muted-foreground">·</span>
        <span
          className={
            status === "connected"
              ? "font-mono text-emerald-400"
              : status === "connecting"
                ? "font-mono text-amber-400"
                : "font-mono text-destructive"
          }
        >
          ● {status}
        </span>
        {status === "connected" && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums">{hz} Hz</span>
            {sessionTime != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono tabular-nums">t = {sessionTime.toFixed(2)}s</span>
              </>
            )}
            {lap != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono">lap {lap}</span>
              </>
            )}
          </>
        )}
        <span className="text-muted-foreground">·</span>
        <Link to="/live" className="font-mono text-xs underline-offset-2 hover:underline">
          ← raw inspector
        </Link>
      </AppHeader>

      {!parsed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            Waiting for live frames…
          </div>
          <div className="max-w-md font-mono text-[11px] text-muted-foreground/80">
            The workbench builds itself from the local bridge stream. Make sure
            <code className="mx-1 rounded-sm bg-rail px-1">npm start</code>
            is running in the iracing-bridge folder and iRacing is on track.
          </div>
        </div>
      ) : (
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
                  {(["cinema", "readout", "laps", "gg", "brake", "slip", "piano"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setBottomTab(t)}
                      className={`flex-1 px-3 py-1.5 text-left ${
                        bottomTab === t
                          ? "bg-panel text-foreground"
                          : "bg-rail text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t === "cinema"
                        ? "Cinema"
                        : t === "readout"
                          ? "Readout"
                          : t === "laps"
                            ? `Laps · ${parsed.laps.length}`
                            : t === "gg"
                              ? "g-g"
                              : t === "brake"
                                ? "Brake"
                                : t === "slip"
                                  ? "Slip"
                                  : "Piano"}
                    </button>
                  ))}
                </div>
                <div className="min-h-0 flex-1">
                  {bottomTab === "cinema" && <CinemaPlayback parsed={parsed} />}
                  {bottomTab === "readout" && <LiveReadout parsed={parsed} />}
                  {bottomTab === "laps" && <LapList parsed={parsed} />}
                  {bottomTab === "gg" && <GGDiagram parsed={parsed} />}
                  {bottomTab === "brake" && <BrakeBias parsed={parsed} />}
                  {bottomTab === "slip" && <SlipAngle parsed={parsed} />}
                  {bottomTab === "piano" && <PianoRoll parsed={parsed} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}