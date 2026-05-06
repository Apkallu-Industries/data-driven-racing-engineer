import { parseLapfile, type ParsedLapfile } from "@/lib/lapfile/parser";

/** Aggregate metrics for one (track, car) pair across all lapfiles found. */
export interface TrackCarFingerprint {
  track: string;
  car: string;
  fileCount: number;
  /** Best lap time ever recorded (s) — min of all .blap/.olap bestLapS in this folder. */
  bestEverS: number;
  /** Theoretical optimal = sum of fastest sector times across all files (s). */
  optimalEverS: number | null;
  /** Median best lap (s) — typical pace. */
  medianBestS: number;
  /** Stdev of best laps (s) — pace consistency. */
  bestStdevS: number;
  /** Sector times of the single fastest lap (s). */
  bestLapSectors: number[];
  /** Best ever per sector across all files (s). */
  bestPerSector: number[];
  /** Sector balance: each sector's % of bestEverS. */
  sectorBalancePct: number[];
  /** Track length in meters. */
  trackLengthM: number;
  /** Most recent build date string we saw, if any. */
  latestBuildDate: string | null;
  /** Earliest build date string we saw, if any. */
  earliestBuildDate: string | null;
  /** Trend: improving / regressing / flat / null. */
  trend: "improving" | "regressing" | "flat" | null;
  /** Custom IDs encountered (usually 1 — the user). */
  custIds: number[];
}

export interface DriverFingerprint {
  generatedAt: string;
  totalFiles: number;
  totalTracks: number;
  totalCars: number;
  /** Per (track, car) aggregate. */
  pairs: TrackCarFingerprint[];
  /** Global indices. */
  indices: {
    /** Median (best/optimal) ratio across pairs — 1.0 = perfect lap-stitching. */
    paceIndex: number | null;
    /** Median gap to optimal (s) across pairs. */
    consistencyIndexS: number | null;
    /** Number of distinct tracks. */
    versatility: number;
    /** Median sector balance bias (which sector tends to lose time). */
    sectorBias: { sector: number; relPct: number } | null;
    /** Net trajectory: % of pairs improving − % regressing. */
    trajectoryScore: number | null;
  };
  /** Track names with no car-matched data, useful for diagnostics. */
  emptyTracks: string[];
}

/** A single file the picker found, keyed by webkitRelativePath. */
export interface RawLapfile {
  /** Path within the picked folder, e.g. "lapfiles/talladega/12345_dallaraf3.olap". */
  path: string;
  /** Bottom-most directory name (the iRacing track folder). */
  trackFolder: string;
  /** Filename without extension. */
  baseName: string;
  ext: string;
  buffer: ArrayBuffer;
}

/** Sentinel thresholds — iRacing reference files often contain 0 or sub-second
 * placeholder times when a sector / lap was never set. Anything below these
 * floors is treated as missing rather than a real time. */
const MIN_LAP_S = 5;
const MIN_SECTOR_S = 1;
const MAX_LAP_S = 60 * 30; // 30 min lap upper bound

function isValidLap(s: number): boolean {
  return Number.isFinite(s) && s >= MIN_LAP_S && s <= MAX_LAP_S;
}
function isValidSector(s: number): boolean {
  return Number.isFinite(s) && s >= MIN_SECTOR_S && s <= MAX_LAP_S;
}

/** Median helper. */
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/** Filter file picker FileList to .olap/.blap/.olapta/.blapta and group by track folder. */
export function selectLapfiles(files: FileList): {
  selected: { file: File; trackFolder: string; baseName: string; ext: string }[];
  totalScanned: number;
} {
  const out: { file: File; trackFolder: string; baseName: string; ext: string }[] = [];
  let scanned = 0;
  for (const f of Array.from(files)) {
    scanned++;
    const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const lower = f.name.toLowerCase();
    const m = lower.match(/\.(olap|blap|olapta|blapta)$/);
    if (!m) continue;
    const ext = m[1];
    const baseName = f.name.slice(0, -1 - ext.length);
    const segs = path.split("/").filter(Boolean);
    const trackFolder = segs.length >= 2 ? segs[segs.length - 2] : "(root)";
    out.push({ file: f, trackFolder, baseName, ext });
  }
  return { selected: out, totalScanned: scanned };
}

/** Parse one record (already-loaded ArrayBuffer). Errors are surfaced to caller. */
export function parseRaw(raw: RawLapfile): ParsedLapfile {
  return parseLapfile(raw.buffer);
}

/** Compute aggregates from already-parsed lapfiles. */
export function buildFingerprint(parsed: { trackFolder: string; parsed: ParsedLapfile }[]): DriverFingerprint {
  // Group by (track, car). Use header.trackName when available, fallback to folder name.
  const groups = new Map<string, { track: string; car: string; files: ParsedLapfile[] }>();
  for (const r of parsed) {
    const track = r.parsed.header.trackName || r.trackFolder;
    const car = r.parsed.header.carShortName || "(unknown car)";
    const key = `${track}|${car}`;
    const g = groups.get(key) ?? { track, car, files: [] };
    g.files.push(r.parsed);
    groups.set(key, g);
  }

  const pairs: TrackCarFingerprint[] = [];
  for (const g of groups.values()) {
    const bestLaps = g.files.map((f) => f.summary.bestLapS).filter(isValidLap);
    if (bestLaps.length === 0) continue;
    const bestEver = Math.min(...bestLaps);
    const bestEverFile = g.files.find((f) => f.summary.bestLapS === bestEver)!;

    // Per-sector best across all files. Only count sectors from files whose
    // bestLap itself is valid AND whose sectors all pass the floor — this
    // prevents a single junk file from poisoning the optimal.
    const validSectorFiles = g.files.filter(
      (f) =>
        isValidLap(f.summary.bestLapS) &&
        f.summary.sectorTimesS.length > 0 &&
        f.summary.sectorTimesS.every(isValidSector),
    );
    const numSec = Math.max(0, ...validSectorFiles.map((f) => f.summary.sectorTimesS.length));
    const bestPerSector: number[] = [];
    let sectorsComplete = numSec > 0;
    for (let s = 0; s < numSec; s++) {
      const vals = validSectorFiles
        .map((f) => f.summary.sectorTimesS[s])
        .filter(isValidSector);
      if (vals.length) bestPerSector.push(Math.min(...vals));
      else sectorsComplete = false;
    }
    // Sanity: optimal must be ≤ bestEver and within 50% of it.
    const optimalSum = bestPerSector.reduce((a, b) => a + b, 0);
    const optimalEver = sectorsComplete &&
      optimalSum > 0 &&
      optimalSum <= bestEver + 0.001 &&
      optimalSum >= bestEver * 0.5
      ? bestPerSector.reduce((a, b) => a + b, 0)
      : null;

    // Sector balance only meaningful if best lap's sectors are all valid AND
    // sum to ~bestEver (within 5%). Otherwise the balance is misleading.
    const bestSectors = bestEverFile.summary.sectorTimesS;
    const allSectorsValid = bestSectors.length > 0 && bestSectors.every(isValidSector);
    const sectorSum = bestSectors.reduce((a, b) => a + b, 0);
    const sectorsCloseToLap = allSectorsValid && Math.abs(sectorSum - bestEver) / bestEver < 0.05;
    const sectorBalancePct = sectorsCloseToLap
      ? bestSectors.map((s) => (s / bestEver) * 100)
      : [];

    // Build dates → trend.
    const dated = g.files
      .map((f) => ({
        d: f.header.buildDates[0] ?? null,
        b: f.summary.bestLapS,
      }))
      .filter((x) => x.d && isValidLap(x.b))
      .sort((a, b) => (a.d! < b.d! ? -1 : 1));
    let trend: TrackCarFingerprint["trend"] = null;
    if (dated.length >= 4) {
      const half = Math.floor(dated.length / 2);
      const early = Math.min(...dated.slice(0, half).map((x) => x.b));
      const late = Math.min(...dated.slice(half).map((x) => x.b));
      const delta = early - late;
      if (Math.abs(delta) < 0.05) trend = "flat";
      else trend = delta > 0 ? "improving" : "regressing";
    }

    pairs.push({
      track: g.track,
      car: g.car,
      fileCount: bestLaps.length,
      bestEverS: +bestEver.toFixed(3),
      optimalEverS: optimalEver != null ? +optimalEver.toFixed(3) : null,
      medianBestS: +median(bestLaps).toFixed(3),
      bestStdevS: +stdev(bestLaps).toFixed(3),
      bestLapSectors: allSectorsValid ? bestSectors.map((s) => +s.toFixed(3)) : [],
      bestPerSector: bestPerSector.map((s) => +s.toFixed(3)),
      sectorBalancePct: sectorBalancePct.map((s) => +s.toFixed(2)),
      trackLengthM: +bestEverFile.summary.trackLengthM.toFixed(1),
      latestBuildDate: dated.length ? dated[dated.length - 1].d : null,
      earliestBuildDate: dated.length ? dated[0].d : null,
      trend,
      custIds: Array.from(new Set(g.files.map((f) => f.header.custId))),
    });
  }

  pairs.sort((a, b) => a.track.localeCompare(b.track) || a.car.localeCompare(b.car));

  // Global indices.
  const ratios = pairs
    .filter((p) => p.optimalEverS != null && isValidLap(p.bestEverS))
    .map((p) => p.optimalEverS! / p.bestEverS);
  const gaps = pairs
    .filter((p) => p.optimalEverS != null && isValidLap(p.bestEverS))
    .map((p) => +(p.bestEverS - p.optimalEverS!).toFixed(3));
  const tracks = new Set(pairs.map((p) => p.track));
  // Sector bias: average each sector's relative balance across pairs (only those with same number of sectors as the modal count).
  let sectorBias: { sector: number; relPct: number } | null = null;
  const sectorCounts = pairs.map((p) => p.sectorBalancePct.length);
  if (sectorCounts.length) {
    const mode = sectorCounts.sort((a, b) => sectorCounts.filter((v) => v === a).length - sectorCounts.filter((v) => v === b).length).pop()!;
    if (mode > 0) {
      const cols = Array.from({ length: mode }, () => [] as number[]);
      for (const p of pairs) {
        if (p.sectorBalancePct.length === mode) p.sectorBalancePct.forEach((v, i) => cols[i].push(v));
      }
      const means = cols.map((c) => (c.length ? c.reduce((a, b) => a + b, 0) / c.length : 0));
      // Expected uniform balance is 100/mode per sector.
      const expected = 100 / mode;
      let worst = 0;
      let worstRel = 0;
      means.forEach((m, i) => {
        const rel = m - expected;
        if (Math.abs(rel) > Math.abs(worstRel)) {
          worst = i;
          worstRel = rel;
        }
      });
      sectorBias = { sector: worst + 1, relPct: +worstRel.toFixed(2) };
    }
  }

  const trends = pairs.map((p) => p.trend).filter(Boolean) as string[];
  const trajectoryScore = trends.length
    ? +(((trends.filter((t) => t === "improving").length - trends.filter((t) => t === "regressing").length) / trends.length) * 100).toFixed(1)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    totalFiles: parsed.length,
    totalTracks: tracks.size,
    totalCars: new Set(pairs.map((p) => p.car)).size,
    pairs,
    indices: {
      paceIndex: ratios.length ? +median(ratios).toFixed(4) : null,
      consistencyIndexS: gaps.length ? +median(gaps).toFixed(3) : null,
      versatility: tracks.size,
      sectorBias,
      trajectoryScore,
    },
    emptyTracks: [],
  };
}

const STORAGE_KEY = "apextrace.fingerprint.v1";

export function saveFingerprint(fp: DriverFingerprint) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fp));
  } catch {
    /* quota — ignore */
  }
}
export function loadFingerprint(): DriverFingerprint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as DriverFingerprint) : null;
  } catch {
    return null;
  }
}
export function clearFingerprint() {
  localStorage.removeItem(STORAGE_KEY);
}

/** Lookup helper for matching against an .ibt session. */
export function findPair(fp: DriverFingerprint, track: string, car: string): TrackCarFingerprint | null {
  const t = track.toLowerCase().trim();
  const c = car.toLowerCase().trim();
  return (
    fp.pairs.find((p) => p.track.toLowerCase().trim() === t && p.car.toLowerCase().trim() === c) ??
    fp.pairs.find((p) => p.track.toLowerCase().includes(t) && p.car.toLowerCase().includes(c)) ??
    null
  );
}