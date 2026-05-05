import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { Activity, Gauge, Layers, MapPin } from "lucide-react";
import { useInstallPrompt } from "@/lib/installPrompt";
import { Download } from "lucide-react";

export const Route = createFileRoute("/")({
  component: LandingPage,
});

function LandingPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const { available: canInstall, promptInstall } = useInstallPrompt();
  useEffect(() => {
    if (!loading && user) navigate({ to: "/sessions" });
  }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="hairline-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-mono text-sm tracking-wider">APEXTRACE</span>
          </div>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/auth" className="rounded-sm px-3 py-1.5 hover:bg-accent">Sign in</Link>
            <Link
              to="/auth"
              className="rounded-sm bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 opacity-[0.04]"
             style={{
               backgroundImage: "linear-gradient(var(--grid-major) 1px, transparent 1px), linear-gradient(90deg, var(--grid-major) 1px, transparent 1px)",
               backgroundSize: "40px 40px",
             }} />
        <div className="mx-auto max-w-7xl px-6 py-20 md:py-28">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            iRacing .ibt analyzer · MoTeC-style workspace
          </p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.05] tracking-tight md:text-7xl">
            Every channel.<br />
            <span className="text-primary">Every tick.</span> Yours to read.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground">
            Drop an iRacing telemetry file and get a cinematic, professional analysis workbench —
            stacked traces, reconstructed track map, lap-by-lap overlay, and a searchable browser
            of all 250+ channels.
          </p>
          <div className="mt-10 flex items-center gap-3">
            <Link
              to="/auth"
              className="rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Open the workbench →
            </Link>
            <Link
              to="/how-it-works"
              className="rounded-sm border border-border-strong px-5 py-3 text-sm hover:bg-accent"
            >
              How it works
            </Link>
            {canInstall && (
              <button
                onClick={() => promptInstall()}
                className="flex items-center gap-2 rounded-sm border border-primary/60 bg-primary/10 px-5 py-3 text-sm text-primary hover:bg-primary/20"
              >
                <Download className="h-4 w-4" /> Install app
                <span className="rounded-sm bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider">
                  Recommended
                </span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-7xl px-6 pb-24">
        <div className="grid gap-px overflow-hidden rounded-sm bg-border md:grid-cols-4">
          {[
            { icon: Layers, h: "Stacked traces", p: "uPlot-rendered, sub-frame cursor across every channel." },
            { icon: MapPin, h: "Track map", p: "Reconstructed from velocity + yaw. Live position dot." },
            { icon: Gauge, h: "Lap compare", p: "Overlay reference vs. compare lap with delta time." },
            { icon: Activity, h: "Channel browser", p: "Search all 250+ vars. Min / max / avg per lap." },
          ].map((f) => (
            <div key={f.h} className="bg-panel p-6">
              <f.icon className="h-5 w-5 text-primary" />
              <h3 className="mt-4 text-base font-medium">{f.h}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.p}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="hairline-t">
        <div className="mx-auto max-w-7xl px-6 py-6 font-mono text-xs text-muted-foreground">
          APEXTRACE · iRacing IBT v2 · 60 / 360 Hz
        </div>
      </footer>
    </div>
  );
}
