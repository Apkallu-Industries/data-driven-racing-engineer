import { useCallback, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppHeader } from "@/components/AppHeader";
import { Fingerprint, FolderUp, Trash2, Download, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { toast } from "sonner";
import {
  selectLapfiles,
  parseRaw,
  buildFingerprint,
  saveFingerprint,
  loadFingerprint,
  clearFingerprint,
  type DriverFingerprint,
  type TrackCarFingerprint,
} from "@/lib/fingerprint/compute";
import { formatLapTime } from "@/lib/lapfile/parser";
import { classifyCar, type CarClass } from "@/lib/fingerprint/carClass";
import { loadTargets, saveTargets, pairKey, parseLapInput, type TargetMap } from "@/lib/fingerprint/targets";

export const Route = createFileRoute("/fingerprint")({
  head: () => ({
    meta: [
      { title: "Driver Fingerprint — ApexTrace" },
      {
        name: "description",
        content:
          "Upload your iRacing lapfiles folder to build a baseline driver fingerprint from every track and car you've ever set a reference lap on.",
      },
    ],
  }),
  component: FingerprintPage,
});

function trendIcon(t: TrackCarFingerprint["trend"]) {
  if (t === "improving") return <TrendingUp className="h-3 w-3 text-emerald-400" />;
  if (t === "regressing") return <TrendingDown className="h-3 w-3 text-rose-400" />;
  if (t === "flat") return <Minus className="h-3 w-3 text-muted-foreground" />;
  return <span className="text-muted-foreground">—</span>;
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="hairline rounded-md bg-panel p-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="font-mono text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 65) return "text-lime-400";
  if (score >= 50) return "text-amber-400";
  if (score >= 35) return "text-orange-400";
  return "text-rose-400";
}

function ClassScoreCard({
  c,
}: {
  c: {
    cls: string;
    pairs: number;
    tracks: number;
    cars: number;
    totalFiles: number;
    improvement: number | null;
    sigma: number | null;
    score: number;
    bestPair: TrackCarFingerprint;
  };
}) {
  return (
    <div className="hairline rounded-md bg-rail/30 p-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[12px] uppercase tracking-wider text-foreground">{c.cls}</div>
        <div className={`font-mono text-2xl tabular-nums ${scoreColor(c.score)}`}>{c.score.toFixed(0)}</div>
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-rail">
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
        />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-muted-foreground">
        <div>
          <div className="text-muted-foreground/70">Tracks</div>
          <div className="text-foreground tabular-nums">{c.tracks}</div>
        </div>
        <div>
          <div className="text-muted-foreground/70">Cars</div>
          <div className="text-foreground tabular-nums">{c.cars}</div>
        </div>
        <div>
          <div className="text-muted-foreground/70">Files</div>
          <div className="text-foreground tabular-nums">{c.totalFiles}</div>
        </div>
        <div>
          <div className="text-muted-foreground/70">Peak</div>
          <div className="text-foreground tabular-nums">
            {c.improvement != null ? `${(c.improvement * 100).toFixed(1)}%` : "—"}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground/70">σ</div>
          <div className="text-foreground tabular-nums">
            {c.sigma != null ? `${c.sigma.toFixed(2)}s` : "—"}
          </div>
        </div>
        <div className="col-span-1">
          <div className="text-muted-foreground/70">Best</div>
          <div className="text-foreground tabular-nums">{formatLapTime(c.bestPair.bestEverS)}</div>
        </div>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
        {c.bestPair.track} · {c.bestPair.car}
      </div>
    </div>
  );
}

function FingerprintPage() {
  const [fp, setFp] = useState<DriverFingerprint | null>(() => loadFingerprint());
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [targets, setTargets] = useState<TargetMap>(() => loadTargets());

  const setTarget = useCallback((track: string, car: string, raw: string) => {
    setTargets((prev) => {
      const next = { ...prev };
      const k = pairKey(track, car);
      const parsed = parseLapInput(raw);
      if (parsed == null) delete next[k];
      else next[k] = parsed;
      saveTargets(next);
      return next;
    });
  }, []);

  const ingest = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      const { selected, totalScanned } = selectLapfiles(files);
      if (selected.length === 0) {
        toast.error(`Scanned ${totalScanned} files but found no .olap/.blap files. Did you pick your iRacing 'lapfiles' folder?`);
        return;
      }
      setProgress({ done: 0, total: selected.length, failed: 0 });
      const parsedAll: { trackFolder: string; parsed: ReturnType<typeof parseRaw> }[] = [];
      let failed = 0;
      for (let i = 0; i < selected.length; i++) {
        const s = selected[i];
        try {
          const buf = await s.file.arrayBuffer();
          const parsed = parseRaw({
            path: s.file.name,
            trackFolder: s.trackFolder,
            baseName: s.baseName,
            ext: s.ext,
            buffer: buf,
          });
          parsedAll.push({ trackFolder: s.trackFolder, parsed });
        } catch {
          failed++;
        }
        // Yield to keep UI alive every 16 files.
        if (i % 16 === 15) await new Promise((r) => setTimeout(r, 0));
        setProgress({ done: i + 1, total: selected.length, failed });
      }
      if (parsedAll.length === 0) {
        toast.error("Found lapfiles but none could be parsed.");
        return;
      }
      const next = buildFingerprint(parsedAll);
      setFp(next);
      saveFingerprint(next);
      toast.success(
        `Fingerprint built from ${parsedAll.length} files across ${next.totalTracks} tracks${failed ? ` (${failed} skipped)` : ""}.`,
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, []);

  const onClear = useCallback(() => {
    clearFingerprint();
    setFp(null);
    toast.success("Fingerprint cleared.");
  }, []);

  const exportJson = useCallback(() => {
    if (!fp) return;
    const blob = new Blob([JSON.stringify(fp, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `driver-fingerprint-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [fp]);

  const sortedPairs = useMemo(
    () => (fp ? [...fp.pairs].sort((a, b) => a.bestEverS - b.bestEverS) : []),
    [fp],
  );

  const classSummaries = useMemo(() => {
    if (!fp) return [];
    const buckets = new Map<CarClass, TrackCarFingerprint[]>();
    for (const p of fp.pairs) {
      const c = classifyCar(p.car);
      if (!buckets.has(c)) buckets.set(c, []);
      buckets.get(c)!.push(p);
    }
    const median = (xs: number[]) => {
      if (!xs.length) return 0;
      const s = [...xs].sort((a, b) => a - b);
      const m = Math.floor(s.length / 2);
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    };
    const out = Array.from(buckets.entries()).map(([cls, ps]) => {
      const multi = ps.filter((p) => p.fileCount >= 2 && p.medianBestS > 0);
      const improvement = multi.length
        ? median(multi.map((p) => p.bestEverS / p.medianBestS))
        : null; // 0..1, closer to 1 = closer to peak
      const sigma = multi.length ? median(multi.map((p) => p.bestStdevS)) : null;
      const tracks = new Set(ps.map((p) => p.track)).size;
      const cars = new Set(ps.map((p) => p.car)).size;
      const totalFiles = ps.reduce((a, b) => a + b.fileCount, 0);
      // Composite 0..100 score
      const impScore = improvement != null ? improvement * 100 : 50; // unknown → neutral
      const conScore = sigma != null ? Math.max(0, 100 - sigma * 100) : 50;
      const varScore = Math.min(100, tracks * 10 + cars * 5);
      // WR-gap: of pairs in this class with a target set, median (target / yourBest) * 100.
      // 100 = matching the target, lower = slower than target.
      const withTarget = ps
        .map((p) => ({ p, t: targets[pairKey(p.track, p.car)] }))
        .filter((x): x is { p: TrackCarFingerprint; t: number } => !!x.t && x.p.bestEverS > 0);
      const wrPct = withTarget.length
        ? median(withTarget.map((x) => Math.min(1, x.t / x.p.bestEverS) * 100))
        : null;
      const wrScore = wrPct != null ? wrPct : 50; // unknown → neutral
      // 40% WR-gap, 25% peak, 20% consistency, 15% variety
      const score = +(0.4 * wrScore + 0.25 * impScore + 0.2 * conScore + 0.15 * varScore).toFixed(1);
      const bestPair = [...ps].sort((a, b) => a.bestEverS - b.bestEverS)[0];
      return {
        cls,
        pairs: ps.length,
        tracks,
        cars,
        totalFiles,
        improvement,
        sigma,
        wrPct,
        targetsSet: withTarget.length,
        score,
        bestPair,
      };
    });
    return out.sort((a, b) => b.score - a.score);
  }, [fp, targets]);

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      <AppHeader>
        <Fingerprint className="h-3.5 w-3.5" />
        <span className="font-mono uppercase tracking-wider">Driver Fingerprint</span>
        <Link to="/sessions" className="ml-auto hover:text-foreground">← Sessions</Link>
      </AppHeader>

      <main className="mx-auto w-full max-w-6xl flex-1 space-y-4 p-4">
        <div className="hairline rounded-md bg-panel p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="font-mono text-base">Build your baseline</h1>
              <p className="mt-1 text-[12px] text-muted-foreground">
                Pick your{" "}
                <code className="rounded-sm bg-rail px-1 font-mono text-[11px]">
                  Documents/iRacing/lapfiles
                </code>{" "}
                folder. We recursively scan every track sub-folder, parse all{" "}
                <code className="font-mono text-[11px]">.olap</code> /{" "}
                <code className="font-mono text-[11px]">.blap</code> files in your browser, and build
                a per-track baseline. Nothing is uploaded.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="flex h-9 items-center gap-2 rounded-sm border border-border bg-primary/15 px-3 font-mono text-[11px] uppercase tracking-wider text-foreground hover:bg-primary/25 disabled:opacity-50"
              >
                <FolderUp className="h-3.5 w-3.5" />
                {fp ? "Rebuild from folder" : "Pick lapfiles folder"}
              </button>
              {fp && (
                <>
                  <button
                    onClick={exportJson}
                    className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-rail px-2.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-foreground"
                  >
                    <Download className="h-3 w-3" /> JSON
                  </button>
                  <button
                    onClick={onClear}
                    className="flex h-9 items-center gap-1.5 rounded-sm border border-border bg-rail px-2.5 font-mono text-[10px] uppercase text-muted-foreground hover:text-rose-400"
                  >
                    <Trash2 className="h-3 w-3" /> Clear
                  </button>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                multiple
                // @ts-expect-error – non-standard attrs for folder picking
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={(e) => void ingest(e.target.files)}
              />
            </div>
          </div>
          {progress && (
            <div className="mt-3 font-mono text-[11px] text-muted-foreground">
              Parsing {progress.done}/{progress.total}
              {progress.failed > 0 && ` · ${progress.failed} skipped`}
              <div className="mt-1 h-1 w-full overflow-hidden rounded-sm bg-rail">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {!fp && !busy && (
          <div className="hairline rounded-md bg-panel p-8 text-center">
            <Fingerprint className="mx-auto h-10 w-10 text-muted-foreground" />
            <div className="mt-3 font-mono text-sm">No fingerprint yet</div>
            <p className="mx-auto mt-2 max-w-md text-[12px] text-muted-foreground">
              Once you pick your lapfiles folder, every reference lap iRacing has saved (one per
              track / car combo) becomes part of your baseline. Later, when you upload an{" "}
              <code className="font-mono text-[11px]">.ibt</code> for the same track + car, the
              workbench will compare it against this fingerprint to show progress.
            </p>
          </div>
        )}

        {fp && (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Tracks"
                value={String(fp.totalTracks)}
                sub={`${fp.totalFiles} reference files`}
              />
              <StatTile
                label="Cars"
                value={String(fp.totalCars)}
                sub={`${fp.pairs.length} track·car pairs`}
              />
              <StatTile
                label="Self-improvement"
                value={fp.indices.selfImprovementIndex != null ? fp.indices.selfImprovementIndex.toFixed(4) : "—"}
                sub="best ÷ typical (1 = always at peak)"
              />
              <StatTile
                label="Consistency"
                value={
                  fp.indices.consistencyIndexS != null
                    ? `${fp.indices.consistencyIndexS.toFixed(3)} s`
                    : "—"
                }
                sub="median best-lap σ across pairs"
              />
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="hairline rounded-md bg-panel p-3">
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  Trajectory
                </div>
                {fp.indices.trajectoryScore != null ? (
                  <div className="mt-1 font-mono text-sm">
                    {fp.indices.trajectoryScore > 10
                      ? "Improving"
                      : fp.indices.trajectoryScore < -10
                        ? "Regressing"
                        : "Flat"}{" "}
                    <span className="text-muted-foreground">
                      ({fp.indices.trajectoryScore > 0 ? "+" : ""}
                      {fp.indices.trajectoryScore}% net)
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-[12px] text-muted-foreground">
                    Need at least 4 dated files per track for trend.
                  </div>
                )}
              </div>
            </div>

            {classSummaries.length > 0 && (
              <div className="hairline rounded-md bg-panel">
                <div className="hairline-b flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Baseline score by car class</span>
                  <span>{classSummaries.length} classes</span>
                </div>
                <div className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {classSummaries.map((c) => (
                    <ClassScoreCard key={c.cls} c={c} />
                  ))}
                </div>
                <div className="hairline-t px-3 py-2 font-mono text-[10px] text-muted-foreground">
                  Score = 40 % WR-gap (target ÷ your best) · 25 % closeness-to-peak · 20 % consistency · 15 % variety.
                  Set targets in the table below — paste from iRacing forums, friends' best laps, or league records.
                </div>
              </div>
            )}

            <div className="hairline rounded-md bg-panel">
              <div className="hairline-b flex items-center justify-between px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Per track · car</span>
                <span>{sortedPairs.length} pairs</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[11px]">
                  <thead className="bg-rail/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <tr className="hairline-b">
                      <th className="px-2 py-1.5 text-left">Track</th>
                      <th className="px-2 py-1.5 text-left">Car</th>
                      <th className="px-2 py-1.5 text-right">Files</th>
                      <th className="px-2 py-1.5 text-right">Length</th>
                      <th className="px-2 py-1.5 text-right">Best</th>
                      <th className="px-2 py-1.5 text-right">Median</th>
                      <th className="px-2 py-1.5 text-right">σ</th>
                      <th className="px-2 py-1.5 text-right">Target</th>
                      <th className="px-2 py-1.5 text-right">Δ WR</th>
                      <th className="px-2 py-1.5 text-center">Trend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPairs.map((p, i) => {
                      const t = targets[pairKey(p.track, p.car)];
                      const gap = t ? p.bestEverS - t : null;
                      const pct = t ? (t / p.bestEverS) * 100 : null;
                      return (
                        <tr key={i} className="hairline-b hover:bg-accent/30">
                          <td className="px-2 py-1 text-left">{p.track}</td>
                          <td className="px-2 py-1 text-left text-muted-foreground">{p.car}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{p.fileCount}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {p.trackLengthM > 0 ? `${(p.trackLengthM / 1000).toFixed(2)} km` : "—"}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatLapTime(p.bestEverS)}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {formatLapTime(p.medianBestS)}
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                            {p.bestStdevS.toFixed(3)}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <input
                              type="text"
                              defaultValue={t ? formatLapTime(t) : ""}
                              placeholder="1:23.456"
                              onBlur={(e) => setTarget(p.track, p.car, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                              }}
                              className="w-20 rounded-sm border border-border bg-rail/50 px-1.5 py-0.5 text-right font-mono text-[11px] tabular-nums focus:border-primary focus:outline-none"
                            />
                          </td>
                          <td className="px-2 py-1 text-right tabular-nums">
                            {gap != null && pct != null ? (
                              <span
                                className={
                                  gap <= 0.05
                                    ? "text-emerald-400"
                                    : gap <= 0.5
                                      ? "text-lime-400"
                                      : gap <= 1.5
                                        ? "text-amber-400"
                                        : "text-rose-400"
                                }
                              >
                                {gap > 0 ? "+" : ""}
                                {gap.toFixed(3)}s
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                  ({pct.toFixed(1)}%)
                                </span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1 text-center">{trendIcon(p.trend)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground">
              Generated {new Date(fp.generatedAt).toLocaleString()} · stored locally in your browser.
            </div>
          </>
        )}
      </main>
    </div>
  );
}