import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Activity } from "lucide-react";
import { useWorkbench } from "@/lib/store";
import { parseIbtInWorker } from "@/lib/ibt/parseInWorker";
import { getSharedLap, refreshSharedSignedUrl } from "@/server/share.functions";
import { TrackMap } from "@/components/workbench/TrackMap";
import { ReplayThree } from "@/components/workbench/ReplayThree";
import { PianoRoll } from "@/components/workbench/PianoRoll";
import { SectorSpider } from "@/components/workbench/SectorSpider";
import { Timeline } from "@/components/workbench/Timeline";

export const Route = createFileRoute("/share/$token")({
  head: ({ params }) => {
    const og = `/api/public/og/share/${params.token}`;
    return {
      meta: [
        { title: "Shared Lap — ApexTrace" },
        { name: "description", content: "Public read-only telemetry lap card." },
        { property: "og:title", content: "Shared Lap — ApexTrace" },
        { property: "og:description", content: "Public read-only telemetry lap card." },
        { property: "og:image", content: og },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:image", content: og },
      ],
    };
  },
  component: SharedLapPage,
});

interface SessionMeta {
  id: string;
  name: string;
  track: string | null;
  car: string | null;
  recordedAt: string | null;
  lapCount: number | null;
  bestLapS: number | null;
}

function SharedLapPage() {
  const { token } = Route.useParams();
  const fetchShare = useServerFn(getSharedLap);
  const { parsed, setParsed, setRefLap, setCmpLap, refLap, cmpLap } = useWorkbench();
  const [meta, setMeta] = useState<SessionMeta | null>(null);
  const [tab, setTab] = useState<"map" | "3d" | "piano" | "spider">("map");
  const [progress, setProgress] = useState<{ phase: string; pct: number } | null>({
    phase: "fetch",
    pct: 0,
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setParsed(null);
    setProgress({ phase: "fetch", pct: 0 });
    (async () => {
      try {
        const share = await fetchShare({ data: { token } });
        if (cancelled) return;
        setMeta(share.session);
        setProgress({ phase: "download", pct: 5 });
        const res = await fetch(share.signedUrl);
        if (!res.ok) throw new Error(`Download failed (${res.status})`);
        const buf = await res.arrayBuffer();
        if (cancelled) return;
        const result = await parseIbtInWorker(buf, (phase, pct) => {
          if (!cancelled) setProgress({ phase, pct: 5 + Math.floor(pct * 0.95) });
        });
        if (cancelled) return;
        setParsed(result);
        if (share.refLap != null) setRefLap(share.refLap);
        if (share.cmpLap != null) setCmpLap(share.cmpLap);
        setProgress(null);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, fetchShare, setParsed, setRefLap, setCmpLap]);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="hairline-b flex items-center justify-between gap-4 px-4 py-2.5">
        <Link to="/" className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <span className="font-mono text-sm tracking-wider">APEXTRACE</span>
          <span className="rounded-sm border border-border-strong px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Shared lap · read-only
          </span>
        </Link>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="uppercase tracking-wider">{meta?.track ?? "…"}</span>
          {meta?.car && <span className="text-muted-foreground">· {meta.car}</span>}
          {refLap != null && <span className="text-muted-foreground">· Ref L{refLap}</span>}
          {cmpLap != null && <span className="text-muted-foreground">vs L{cmpLap}</span>}
        </div>
        <Link
          to="/auth"
          className="rounded-sm bg-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary-foreground hover:opacity-90"
        >
          Open your own
        </Link>
      </header>

      {err && (
        <div className="bg-destructive/20 px-3 py-2 text-sm text-destructive-foreground">{err}</div>
      )}

      {!parsed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {progress?.phase ?? "loading"} · {progress?.pct ?? 0}%
          </div>
          <div className="h-1 w-72 overflow-hidden rounded-full bg-rail">
            <div className="h-full bg-primary transition-all" style={{ width: `${progress?.pct ?? 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="hairline-b flex items-center gap-px bg-border font-mono text-[11px] uppercase tracking-wider">
            {(["map", "3d", "piano", "spider"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 ${
                  tab === t
                    ? "bg-panel text-foreground"
                    : "bg-rail text-muted-foreground hover:text-foreground"
                }`}
              >
                {t === "map" ? "Track Map" : t === "3d" ? "3D Replay" : t === "piano" ? "Piano Roll" : "Sector Spider"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 bg-panel">
            {tab === "map" && <TrackMap parsed={parsed} />}
            {tab === "3d" && <ReplayThree parsed={parsed} />}
            {tab === "piano" && <PianoRoll parsed={parsed} />}
            {tab === "spider" && <SectorSpider parsed={parsed} />}
          </div>
          <Timeline parsed={parsed} />
        </div>
      )}
    </div>
  );
}