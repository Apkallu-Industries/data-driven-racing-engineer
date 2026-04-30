import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, Upload, Cpu, LineChart, MapPin, Layers, GitCompare, Lock, Gauge, FileBinary, Workflow } from "lucide-react";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How it works — ApexTrace" },
      { name: "description", content: "How ApexTrace parses iRacing .ibt telemetry files in your browser and renders a MoTeC-style analysis workbench." },
      { property: "og:title", content: "How ApexTrace works" },
      { property: "og:description", content: "From .ibt binary to stacked traces, track map and lap compare — the parsing pipeline explained." },
    ],
  }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="hairline-b">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
              <Activity className="h-4 w-4" />
            </div>
            <span className="font-mono text-sm tracking-wider">APEXTRACE</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link to="/" className="rounded-sm px-3 py-1.5 hover:bg-accent">Home</Link>
            <Link to="/auth" className="rounded-sm bg-primary px-3 py-1.5 font-medium text-primary-foreground hover:opacity-90">
              Get started
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden hairline-b">
        <div
          className="absolute inset-0 -z-10 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(var(--grid-major) 1px, transparent 1px), linear-gradient(90deg, var(--grid-major) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="mx-auto max-w-5xl px-6 py-20">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
            How it works
          </p>
          <h1 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
            From <span className="text-primary">binary tick stream</span><br />
            to a workbench, in seconds.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
            ApexTrace reads iRacing's native <code className="font-mono text-foreground">.ibt</code> telemetry
            format directly in your browser. No plugins, no installs, no upload pipeline waiting on a
            server. The same data your sim writes to disk — parsed locally, indexed, and rendered as a
            MoTeC-style analysis workspace.
          </p>
        </div>
      </section>

      {/* Pipeline */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">The pipeline</h2>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">Five stages, one Web Worker</h3>

        <ol className="mt-12 grid gap-px overflow-hidden rounded-sm bg-border md:grid-cols-5">
          {[
            { n: "01", icon: Upload, h: "Upload", p: "Drop the .ibt into your account. The file is stored privately, scoped to your user via row-level security." },
            { n: "02", icon: FileBinary, h: "Decode header", p: "Read the IRSDK header, variable headers and embedded session YAML. Detect tick rate, duration, car and track." },
            { n: "03", icon: Cpu, h: "Stream samples", p: "A Web Worker walks every tick record, decoding 250+ channels into Float32Arrays without freezing the UI." },
            { n: "04", icon: Workflow, h: "Reconstruct", p: "Detect lap boundaries from the Lap channel and integrate VelocityX/Y + Yaw to rebuild the track outline." },
            { n: "05", icon: LineChart, h: "Render", p: "uPlot draws synchronized stacked traces with a sub-frame cursor shared across charts, map and gauges." },
          ].map((s) => (
            <div key={s.n} className="bg-panel p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs text-muted-foreground">{s.n}</span>
                <s.icon className="h-4 w-4 text-primary" />
              </div>
              <h4 className="mt-6 text-base font-medium">{s.h}</h4>
              <p className="mt-2 text-sm text-muted-foreground">{s.p}</p>
            </div>
          ))}
        </ol>
      </section>

      {/* The .ibt format */}
      <section className="hairline-t bg-rail">
        <div className="mx-auto max-w-7xl px-6 py-20 md:grid md:grid-cols-2 md:gap-16">
          <div>
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">The .ibt format</h2>
            <h3 className="mt-2 text-3xl font-semibold tracking-tight">A binary log of every tick.</h3>
            <p className="mt-6 text-muted-foreground">
              An iRacing telemetry file is a fixed-layout binary stream: a 48-byte IRSDK header, a table of
              variable definitions, the session-info YAML, then a tightly packed array of tick records — one
              per simulator frame at 60 Hz (or 360 Hz for high-rate sessions).
            </p>
            <p className="mt-4 text-muted-foreground">
              Each variable header tells us its type (<code className="font-mono">Float</code>,{" "}
              <code className="font-mono">Double</code>, <code className="font-mono">Int</code>,{" "}
              <code className="font-mono">Bitfield</code>, <code className="font-mono">Bool</code>),
              its byte offset within a tick record, and its array count. ApexTrace materializes each variable
              into a typed array so any channel can be plotted instantly without a re-parse.
            </p>
          </div>
          <pre className="mt-8 overflow-x-auto rounded-sm border border-border bg-panel p-5 font-mono text-[11px] leading-relaxed text-muted-foreground md:mt-0">
{`┌─────────────────────────────────────────────┐
│ IRSDK Header        48 B   ver, tickRate,…  │
├─────────────────────────────────────────────┤
│ VarBuf Header       16 B   bufOffset, ticks │
├─────────────────────────────────────────────┤
│ Variable Headers    144 B × N               │
│   ├ type   (Float | Int | Bitfield | …)     │
│   ├ offset (within a tick record)           │
│   ├ count  (array length, e.g. 4 tires)     │
│   ├ name   "Speed", "Throttle", …           │
│   ├ desc   human-readable description       │
│   └ unit   "m/s", "rad", "%"                │
├─────────────────────────────────────────────┤
│ Session Info YAML   variable length          │
│   driver · car · track · weather · setup    │
├─────────────────────────────────────────────┤
│ Tick Record × T                             │
│   [ Speed | Throttle | Brake | RPM | … ]    │
│   [ Speed | Throttle | Brake | RPM | … ]    │
│   …                                          │
└─────────────────────────────────────────────┘`}
          </pre>
        </div>
      </section>

      {/* Workbench */}
      <section className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">The workbench</h2>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">Four panes, one synchronized cursor.</h3>

        <div className="mt-12 grid gap-px overflow-hidden rounded-sm bg-border md:grid-cols-2">
          {[
            { icon: Layers, h: "Channel browser", p: "All 250+ variables grouped by Driver Inputs, Vehicle, Engine, Tires, Suspension, Session, Environment. Click to plot, search to filter." },
            { icon: LineChart, h: "Stacked traces", p: "Each selected channel gets its own uPlot panel with shared X-axis, header readout (min / max / avg / unit) and a sub-frame cursor." },
            { icon: MapPin, h: "Track map", p: "XY outline reconstructed from VelocityX/Y rotated by Yaw, integrated tick-by-tick. A live dot follows the cursor as you scrub." },
            { icon: GitCompare, h: "Lap compare", p: "Pick a reference lap and a compare lap from the detected lap list. Compare lap is overlaid on every trace as a dashed line." },
          ].map((f) => (
            <div key={f.h} className="bg-panel p-6">
              <f.icon className="h-5 w-5 text-primary" />
              <h4 className="mt-4 text-base font-medium">{f.h}</h4>
              <p className="mt-2 text-sm text-muted-foreground">{f.p}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Performance & privacy */}
      <section className="hairline-t bg-rail">
        <div className="mx-auto max-w-7xl grid gap-px overflow-hidden rounded-sm bg-border px-6 py-20 md:grid-cols-3">
          <div className="bg-panel p-6">
            <Cpu className="h-5 w-5 text-primary" />
            <h4 className="mt-4 text-base font-medium">Off the main thread</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Parsing runs in a dedicated Web Worker. Typed-array buffers are transferred (not copied) back
              to the UI, so a 100 MB session never blocks input or animation.
            </p>
          </div>
          <div className="bg-panel p-6">
            <Gauge className="h-5 w-5 text-primary" />
            <h4 className="mt-4 text-base font-medium">Built for 360 Hz</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              uPlot is a non-React canvas renderer that handles hundreds of thousands of points per channel
              with a smooth, single-pixel cursor — exactly what MoTeC users expect.
            </p>
          </div>
          <div className="bg-panel p-6">
            <Lock className="h-5 w-5 text-primary" />
            <h4 className="mt-4 text-base font-medium">Yours alone</h4>
            <p className="mt-2 text-sm text-muted-foreground">
              Files are stored in a private bucket scoped by row-level security. Only your authenticated
              account can list, read or delete them.
            </p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">FAQ</h2>
        <h3 className="mt-2 text-3xl font-semibold tracking-tight">Common questions</h3>
        <dl className="mt-10 space-y-8">
          {[
            {
              q: "Where do .ibt files come from?",
              a: "iRacing writes one to your Documents/iRacing/telemetry folder whenever you press Alt+L on track. ApexTrace reads that file as-is — no conversion needed.",
            },
            {
              q: "Which IRSDK version is supported?",
              a: "Version 2 (the current iRacing format). Both 60 Hz and 360 Hz logs are handled; tick rate is read from the file header.",
            },
            {
              q: "Are my files uploaded anywhere?",
              a: "Files are stored in your private account bucket so you can revisit sessions across devices. Parsing itself happens entirely in your browser.",
            },
            {
              q: "How accurate is the reconstructed track map?",
              a: "The map integrates VelocityX/Y rotated into the world frame by Yaw. It's accurate enough to see racing lines and braking points; it's not a survey-grade GPS trace.",
            },
            {
              q: "Can I compare two laps?",
              a: "Yes. Pick a reference lap and a compare lap from the lap list. Every selected trace shows the compare lap as a dashed overlay aligned to lap-relative time.",
            },
          ].map((f) => (
            <div key={f.q} className="hairline-b pb-6">
              <dt className="text-base font-medium">{f.q}</dt>
              <dd className="mt-2 text-sm text-muted-foreground">{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* CTA */}
      <section className="hairline-t">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-6 px-6 py-20 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-3xl font-semibold tracking-tight">Ready to read every channel?</h3>
            <p className="mt-2 text-muted-foreground">Create an account and drop in your first .ibt.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to="/auth"
              className="rounded-sm bg-primary px-5 py-3 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Open the workbench →
            </Link>
            <Link
              to="/"
              className="rounded-sm border border-border-strong px-5 py-3 text-sm hover:bg-accent"
            >
              Back to home
            </Link>
          </div>
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