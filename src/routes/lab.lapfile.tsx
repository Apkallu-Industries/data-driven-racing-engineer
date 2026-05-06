import { useCallback, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Upload, Download, FileText } from "lucide-react";
import {
  parseLapfile,
  lapfileToJSON,
  formatLapTime,
  liveryColors,
  type ParsedLapfile,
} from "@/lib/lapfile/parser";
import { toast } from "sonner";

export const Route = createFileRoute("/lab/lapfile")({
  head: () => ({
    meta: [
      { title: "Lapfile Lab — ApexTrace" },
      { name: "description", content: "Inspect iRacing .olap / .blap reference lap files." },
    ],
  }),
  component: LapfileLab,
});

interface LoadedFile {
  name: string;
  parsed: ParsedLapfile;
  error?: string;
}

function ColorSwatch({ hex }: { hex: string }) {
  const valid = /^[0-9a-fA-F]{6}$/.test(hex);
  return (
    <div className="flex items-center gap-1.5 font-mono text-[10px]">
      <span
        className="hairline inline-block h-3.5 w-3.5 rounded-sm"
        style={{ background: valid ? `#${hex}` : "transparent" }}
      />
      <span className="text-muted-foreground">#{hex || "------"}</span>
    </div>
  );
}

function ChannelSpark({ values, color }: { values: Float32Array; color: string }) {
  const W = 360, H = 36;
  const path = useMemo(() => {
    if (values.length === 0) return "";
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (Number.isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (!Number.isFinite(mn)) return "";
    const span = mx - mn || 1;
    const step = W / Math.max(1, values.length - 1);
    let d = "";
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      const x = i * step;
      const y = H - ((v - mn) / span) * H;
      d += i === 0 ? `M${x.toFixed(1)} ${y.toFixed(1)}` : ` L${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  }, [values]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" preserveAspectRatio="none">
      <rect width={W} height={H} fill="var(--rail)" />
      <path d={path} fill="none" stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const CHANNEL_COLORS = [
  "var(--ch-speed)",
  "var(--ch-throttle)",
  "var(--ch-brake)",
  "var(--ch-rpm)",
  "var(--ch-gear)",
  "var(--ch-steer)",
  "var(--primary)",
  "var(--ch-throttle)",
];

function LapfileCard({ file }: { file: LoadedFile }) {
  const { parsed } = file;
  const colors = liveryColors(parsed);
  const exportJson = () => {
    const json = JSON.stringify(lapfileToJSON(parsed), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${file.name.replace(/\.[a-z]+$/i, "")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="hairline rounded-md bg-panel">
      <div className="hairline-b flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="truncate font-mono text-xs">{file.name}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {parsed.header.magic} v{parsed.header.version} · {parsed.header.trackName} · {parsed.header.carShortName}
          </div>
        </div>
        <button
          onClick={exportJson}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-border bg-rail px-2 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3 w-3" />
          JSON
        </button>
      </div>
      <div className="grid gap-3 p-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Driver</div>
          <div className="font-mono text-sm">{parsed.header.driverName}</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            custId {parsed.header.custId} · {parsed.header.shortName} · {parsed.header.initials}
          </div>
          {parsed.header.ghostDriverName && (
            <div className="font-mono text-[10px] text-muted-foreground">
              ghost: {parsed.header.ghostDriverName}
            </div>
          )}
          <div className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Season / week</div>
          <div className="font-mono text-xs">S{parsed.header.season} W{parsed.header.weekOrSeries}</div>
          <div className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Build dates</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {parsed.header.buildDates.join(" · ") || "—"}
          </div>
        </div>
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Best lap</div>
          <div className="font-mono text-2xl tabular-nums">{formatLapTime(parsed.summary.bestLapS)}</div>
          {parsed.summary.sectorTimesS.length > 0 && (
            <div className="flex gap-2 font-mono text-[10px] text-muted-foreground">
              {parsed.summary.sectorTimesS.map((t, i) => (
                <span key={i}>
                  S{i + 1} <span className="text-foreground">{formatLapTime(t)}</span>
                </span>
              ))}
            </div>
          )}
          <div className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Track</div>
          <div className="font-mono text-xs">
            {parsed.header.trackName}
            <span className="ml-2 text-muted-foreground">
              {parsed.summary.trackLengthM.toFixed(1)} m
            </span>
          </div>
          <div className="pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">Channels</div>
          <div className="font-mono text-xs">
            {parsed.summary.numChannels} × {parsed.summary.numBins} bins
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Livery colors</div>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ColorSwatch hex={colors.license} />
            {colors.helmet.map((h, i) => <ColorSwatch key={`h${i}`} hex={h} />)}
            {colors.suit.map((h, i) => <ColorSwatch key={`s${i}`} hex={h} />)}
          </div>
        </div>
        <div className="sm:col-span-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Channel traces</div>
          <div className="mt-1 grid gap-2">
            {parsed.channels.map((c, i) => (
              <div key={i} className="hairline rounded-sm bg-bg p-1.5">
                <div className="flex items-center justify-between font-mono text-[10px]">
                  <span style={{ color: CHANNEL_COLORS[i % CHANNEL_COLORS.length] }}>
                    {c.label}
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    min {c.min.toFixed(2)} · max {c.max.toFixed(2)} · μ {c.mean.toFixed(2)} {c.unit}
                  </span>
                </div>
                <ChannelSpark values={c.values} color={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
              </div>
            ))}
            {parsed.channels.length === 0 && (
              <div className="px-2 py-3 text-center font-mono text-[10px] text-muted-foreground">
                No channels decoded.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LapfileLab() {
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    const next: LoadedFile[] = [];
    for (const f of Array.from(fileList)) {
      try {
        const buf = await f.arrayBuffer();
        const parsed = parseLapfile(buf);
        next.push({ name: f.name, parsed });
      } catch (e) {
        toast.error(`${f.name}: ${(e as Error).message}`);
      }
    }
    if (next.length) {
      setFiles(prev => [...next, ...prev]);
      toast.success(`Loaded ${next.length} file${next.length === 1 ? "" : "s"}`);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppHeader>
        <FileText className="h-3.5 w-3.5" />
        <span className="font-mono uppercase tracking-wider">Lapfile Lab</span>
        <Link to="/sessions" className="ml-auto hover:text-foreground">← Sessions</Link>
      </AppHeader>
      <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 p-4">
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="hairline cursor-pointer rounded-md border-dashed bg-panel p-8 text-center transition-colors hover:bg-accent"
        >
          <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
          <div className="mt-2 font-mono text-xs uppercase tracking-wider">
            Drop .olap / .blap / .olapta / .blapta files
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Parsed entirely in your browser — nothing uploaded.
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".olap,.blap,.olapta,.blapta"
            className="hidden"
            onChange={e => void handleFiles(e.target.files)}
          />
        </div>
        {files.length > 0 && (
          <div className="space-y-3">
            {files.map((f, i) => (
              <LapfileCard key={`${f.name}-${i}`} file={f} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}