/**
 * iRacing lapfile (.olap / .blap / .olapta / .blapta) parser.
 *
 * Reverse-engineered from version 3 files. These small binary files live in
 * `Documents/iRacing/lapfiles/<track>/<custid>_<car>.{olap,blap,olapta,blapta}`
 * and act as the reference-lap data iRacing uses for the live delta bar /
 * ghost car. They are NOT full per-tick telemetry like .ibt — they are
 * distance-binned reference traces plus best/optimal lap & sector times and
 * a chunk of driver/livery metadata.
 *
 * Layout (v3 — confirmed bytes are commented; speculative fields prefixed
 * with `maybe`):
 *
 *   0x000  magic         "OLAP" | "BLAP" | "OLTA" | "BLTA"   (4 bytes)
 *   0x004  version       uint32  (== 3)
 *   0x008  flags         uint32  (always 0 in samples)
 *   0x00C  custId        uint32  (iRacing customer ID)
 *   0x010  driverName    char[64] null-padded
 *   0x050  shortName     char[48] null-padded ("Last, F" form)
 *   0x080  initials      char[8]  ("DM")
 *   0x088  season        uint32   (e.g. 22)
 *   0x08C  weekOrSeries  uint32   (e.g. 25)
 *   0x090  carShortName  char[64] null-padded
 *   0x0D0  numLiveryStr  uint32   (count of length-prefixed CSV lines that follow, == 4)
 *   0x0D4  liveryBlock   variable  (4 short null-padded CSV strings, 32 bytes each)
 *   0x278  block2 anchor (8 bytes flags) followed by a duplicate driver record
 *   0x288  uint32 (== 4 again — livery count?)
 *   0x28C  driverName2 / ghostName  char[64]
 *   0x2CC  car2          char[64]
 *   ...    livery2 block (mirror of 0x0D4)
 *   0x4FE  carShortName  char[64]  (third copy — used as the "track index" car)
 *   0x53E  trackName     char[64]
 *   0x57E  buildDate1    char[16]  ("YYYY.MM.DD.HH")
 *   0x58E  buildDate2    char[16]
 *   0x59E  buildDate3    char[16]
 *   0x5B0  channelTable  begins — see decodeChannelTable below
 *
 * After the channel table comes a sequence of channel payloads. Each channel
 * is `numBins` float32 values (little-endian). Channels we have so far been
 * able to confirm by value-range and shape:
 *   - speed       (m/s, 0..100ish)
 *   - throttle    (0..1)
 *   - brake       (0..1)
 *   - gear        (-1..8)
 *   - steering    (radians)
 *   - rpm         (0..15000)
 * Order is NOT yet fully pinned down — the debug page exposes every detected
 * window so we can finalize the mapping by eye.
 */

export type LapfileMagic = "OLAP" | "BLAP" | "OLTA" | "BLTA";

export interface LapfileHeader {
  magic: LapfileMagic;
  version: number;
  flags: number;
  custId: number;
  driverName: string;
  shortName: string;
  initials: string;
  season: number;
  weekOrSeries: number;
  carShortName: string;
  trackName: string;
  /** Comma-separated livery / suit / helmet color records as found in the file. */
  liveryRecords: string[];
  /** Optional ghost driver embedded in the file (set if a different name is found in block 2). */
  ghostDriverName?: string;
  buildDates: string[];
}

export interface LapfileSummary {
  /** Best lap time in seconds (0 if not yet set). */
  bestLapS: number;
  /** Track length in meters (rough, derived from a recurring float in the channel table). */
  trackLengthM: number;
  /** Sector best times in seconds (length usually 3, 0 if unknown). */
  sectorTimesS: number[];
  /** Number of distance bins per channel. */
  numBins: number;
  /** Number of channel descriptor entries detected. */
  numChannels: number;
}

export interface LapfileChannel {
  /** Best-effort label assigned by the parser. May be "ch{n}" if unknown. */
  label: string;
  /** Inferred unit (e.g. "m/s", "0..1", "rad"). */
  unit: string;
  /** Distance-binned values (length === numBins). */
  values: Float32Array;
  /** Min / max / mean for quick UI display. */
  min: number;
  max: number;
  mean: number;
  /** Raw byte offset where this channel started — useful for the debug viewer. */
  byteOffset: number;
}

export interface ParsedLapfile {
  header: LapfileHeader;
  summary: LapfileSummary;
  channels: LapfileChannel[];
  /** Length-prefixed body section as raw bytes for the lap reference grid. */
  bodyByteLength: number;
  /** Raw bytes of the whole file — kept so the debug viewer can show a hex dump. */
  raw: Uint8Array;
}

function readCString(view: DataView, offset: number, maxLen: number): string {
  const bytes: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    bytes.push(b);
  }
  // Latin-1 is safe — iRacing names use ASCII / Western European chars.
  return String.fromCharCode(...bytes);
}

function isPrintableCsvByte(b: number): boolean {
  return (b >= 0x20 && b < 0x7f);
}

function readLiveryRecords(view: DataView, start: number, count: number, stride = 32): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(readCString(view, start + i * stride, stride));
  }
  return out.filter(s => s.length > 0);
}

const MAGICS: ReadonlyArray<LapfileMagic> = ["OLAP", "BLAP", "OLTA", "BLTA"];

function decodeMagic(view: DataView): LapfileMagic {
  const m = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (!MAGICS.includes(m as LapfileMagic)) {
    throw new Error(`Not a lapfile: bad magic "${m}"`);
  }
  return m as LapfileMagic;
}

function statsOf(values: Float32Array): { min: number; max: number; mean: number } {
  let mn = Infinity, mx = -Infinity, sum = 0, n = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    n++;
  }
  if (n === 0) return { min: 0, max: 0, mean: 0 };
  return { min: mn, max: mx, mean: sum / n };
}

/**
 * Heuristic channel labeller. Examines value range / shape and assigns a
 * best-guess label. Returns {label, unit}.
 */
function guessChannel(values: Float32Array): { label: string; unit: string } {
  const { min, max, mean } = statsOf(values);
  const span = max - min;

  // Throttle / brake: clamped to [0, 1]
  if (min >= -0.05 && max <= 1.05 && span > 0.1) {
    return { label: "pedal", unit: "0..1" };
  }
  // Gear: small integer range, often spans -1..8
  if (min >= -1.5 && max <= 9.5 && span > 1 && Number.isInteger(Math.round(mean))) {
    return { label: "gear", unit: "n" };
  }
  // RPM
  if (max > 1500 && max < 25000 && min >= 0) {
    return { label: "rpm", unit: "rpm" };
  }
  // Speed (m/s)
  if (min >= 0 && max < 200 && span > 5) {
    return { label: "speed", unit: "m/s" };
  }
  // Steering (rad)
  if (min >= -10 && max <= 10 && span > 0.1) {
    return { label: "steering", unit: "rad" };
  }
  return { label: "unknown", unit: "?" };
}

/**
 * Decode the channel descriptor table that begins at 0x5B0.
 *
 * Each entry is a 28-byte record. From sample inspection:
 *   +0   uint16  count_or_flag (typically 0x0018 = 24, == bytes-of-payload-prefix?)
 *   +2   uint16  pad
 *   +4   float32 best lap time (seconds) — first record only
 *   +8   uint32  sector_count (3) — first record only
 *   +12  uint32  channel_count or version (3)
 *   +16  uint32  reserved (0)
 *   +20  float32 track length (meters) — appears in EVERY record (1055.30 for adelaide)
 *   +24  uint32  num_bins (0x0210 = 528 for adelaide) OR sub-channel count
 *
 * After the table header, channel float arrays follow. We locate them by
 * scanning forward from the end of the metadata strings for a contiguous
 * span of length-divisible-by-numBins float32 data with finite values.
 */
function decodeChannelTable(view: DataView, raw: Uint8Array): {
  bestLapS: number;
  trackLengthM: number;
  sectorTimesS: number[];
  numBins: number;
  numChannels: number;
  bodyOffset: number;
} {
  const tableStart = 0x5b0;
  const bestLapS = view.getFloat32(tableStart + 4, true);
  const sectorCount = view.getUint32(tableStart + 8, true);
  const trackLengthM = view.getFloat32(tableStart + 20, true);
  const numBins = view.getUint32(tableStart + 24, true);

  // Sector best times: the second descriptor record holds them.
  // Each subsequent record (28 bytes) repeats trackLengthM at +20.
  // The float at +4 of records 1..N is the per-sector best time.
  const sectorTimesS: number[] = [];
  for (let i = 1; i <= Math.min(sectorCount, 6); i++) {
    const off = tableStart + i * 28;
    if (off + 28 > raw.byteLength) break;
    sectorTimesS.push(view.getFloat32(off + 4, true));
  }

  // Number of channels: scan forward from the table while record signature
  // matches (trackLengthM repeats at +20). Cap at 32 to prevent runaway.
  let numChannels = 0;
  for (let i = 0; i < 32; i++) {
    const off = tableStart + i * 28;
    if (off + 28 > raw.byteLength) break;
    const tl = view.getFloat32(off + 20, true);
    // Accept records whose track length is within 1% of the first one.
    if (Math.abs(tl - trackLengthM) / Math.max(1, trackLengthM) > 0.02) break;
    numChannels++;
  }

  const bodyOffset = tableStart + numChannels * 28;
  return { bestLapS, trackLengthM, sectorTimesS, numBins, numChannels, bodyOffset };
}

function readChannels(view: DataView, bodyOffset: number, numBins: number, numChannels: number, raw: Uint8Array): LapfileChannel[] {
  const channels: LapfileChannel[] = [];
  if (numBins <= 0 || numChannels <= 0) return channels;
  const channelByteLen = numBins * 4;
  // CONFIRMED across 18 Talladega files (1068 bins, 14 channels, 52-B trailer):
  //   ch00              = distance ramp (m), spans 2× track length (bin stride 4 m)
  //   ch01..ch06        = best-lap cumulative time at 6 progressive split points (s)
  //   ch07              = optimal-lap cumulative time at split-6 (mirrors ch06 to ±0.1%)
  //   ch08..ch13        = optimal-lap cumulative time at splits 1..6 (s)
  //   ch06 ≈ ch07 ≈ best_lap / 2  (2-lap binned span)
  //   −π ≈ -3.14159 in early bins is a "no-data" sentinel, not a steering angle.
  // Trailer = 52 bytes after channels (sector-times block, 3 sectors).
  const totalChannels = Math.floor((raw.byteLength - bodyOffset) / channelByteLen);
  const PAIRED_LABELS = [
    "distance",        // 0
    "best.t.seg1",     // 1
    "best.t.seg2",     // 2
    "best.t.seg3",     // 3
    "best.t.seg4",     // 4
    "best.t.seg5",     // 5
    "best.t.seg6",     // 6
    "opt.t.seg6.dup",  // 7  (mirror of best/opt seg6 — confirmed)
    "opt.t.seg1",      // 8
    "opt.t.seg2",      // 9
    "opt.t.seg3",      // 10
    "opt.t.seg4",      // 11
    "opt.t.seg5",      // 12
    "opt.t.seg6",      // 13
  ];
  const PAIRED_UNITS = ["m","s","s","s","s","s","s","s","s","s","s","s","s","s"];
  for (let c = 0; c < totalChannels; c++) {
    const off = bodyOffset + c * channelByteLen;
    if (off + channelByteLen > raw.byteLength) break;
    // Copy into a fresh Float32Array (raw buffer may not be 4-byte aligned for direct view).
    const values = new Float32Array(numBins);
    let finiteCount = 0;
    for (let i = 0; i < numBins; i++) {
      values[i] = view.getFloat32(off + i * 4, true);
      if (Number.isFinite(values[i]) && Math.abs(values[i]) < 1e30) finiteCount++;
    }
    // Skip windows that are mostly noise (extreme values or all-zero).
    if (finiteCount < numBins * 0.5) continue;
    // Replace pathological values with NaN so charts don't blow up.
    for (let i = 0; i < numBins; i++) {
      if (!Number.isFinite(values[i]) || Math.abs(values[i]) > 1e30) values[i] = NaN;
    }
    const s = statsOf(values);
    if (s.min === 0 && s.max === 0) continue;
    const label = c < PAIRED_LABELS.length ? PAIRED_LABELS[c] : guessChannel(values).label + `#${c + 1}`;
    const unit = c < PAIRED_UNITS.length ? PAIRED_UNITS[c] : guessChannel(values).unit;
    channels.push({
      label,
      unit,
      values,
      min: s.min,
      max: s.max,
      mean: s.mean,
      byteOffset: off,
    });
  }
  return channels;
}

export function parseLapfile(buffer: ArrayBuffer): ParsedLapfile {
  const raw = new Uint8Array(buffer);
  if (raw.byteLength < 0x600) {
    throw new Error(`File too small (${raw.byteLength} bytes) — not a v3 lapfile`);
  }
  const view = new DataView(buffer);
  const magic = decodeMagic(view);
  const version = view.getUint32(0x004, true);
  if (version !== 3) {
    throw new Error(`Unsupported lapfile version ${version} (parser expects v3)`);
  }
  const flags = view.getUint32(0x008, true);
  const custId = view.getUint32(0x00c, true);
  const driverName = readCString(view, 0x010, 64);
  const shortName = readCString(view, 0x050, 48);
  const initials = readCString(view, 0x080, 8);
  const season = view.getUint32(0x088, true);
  const weekOrSeries = view.getUint32(0x08c, true);
  const carShortName = readCString(view, 0x090, 64);
  const trackName = readCString(view, 0x53e, 64);

  const liveryCount = view.getUint32(0x0d0, true);
  const liveryRecords = liveryCount > 0 && liveryCount < 16
    ? readLiveryRecords(view, 0x0d4, liveryCount)
    : [];

  const ghostName = readCString(view, 0x28c, 64);
  const ghostDriverName = ghostName && ghostName !== driverName ? ghostName : undefined;

  const buildDates = [
    readCString(view, 0x57e, 16),
    readCString(view, 0x58e, 16),
    readCString(view, 0x59e, 16),
  ].filter(s => /^\d{4}\.\d{2}\.\d{2}/.test(s));

  const tableInfo = decodeChannelTable(view, raw);
  const channels = readChannels(view, tableInfo.bodyOffset, tableInfo.numBins, tableInfo.numChannels, raw);

  const header: LapfileHeader = {
    magic,
    version,
    flags,
    custId,
    driverName,
    shortName,
    initials,
    season,
    weekOrSeries,
    carShortName,
    trackName,
    liveryRecords,
    ghostDriverName,
    buildDates,
  };
  const summary: LapfileSummary = {
    bestLapS: tableInfo.bestLapS,
    trackLengthM: tableInfo.trackLengthM,
    sectorTimesS: tableInfo.sectorTimesS,
    numBins: tableInfo.numBins,
    numChannels: tableInfo.numChannels,
  };
  return { header, summary, channels, bodyByteLength: raw.byteLength - tableInfo.bodyOffset, raw };
}

/**
 * Convert a parsed lapfile to a plain JSON structure (for export / display).
 * Float32Arrays become regular arrays of finite numbers (NaN -> null).
 */
export function lapfileToJSON(parsed: ParsedLapfile) {
  return {
    header: parsed.header,
    summary: parsed.summary,
    channels: parsed.channels.map(c => ({
      label: c.label,
      unit: c.unit,
      min: c.min,
      max: c.max,
      mean: c.mean,
      byteOffset: c.byteOffset,
      values: Array.from(c.values).map(v => Number.isFinite(v) ? Number(v.toFixed(4)) : null),
    })),
  };
}

/** Format seconds as M:SS.mmm for display. */
export function formatLapTime(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  return `${m}:${rem.toFixed(3).padStart(6, "0")}`;
}

/** First livery record is conventionally `<licenseColor>` (single hex). */
export function liveryColors(parsed: ParsedLapfile): { license: string; helmet: string[]; suit: string[] } {
  const recs = parsed.header.liveryRecords;
  const license = recs[0] ?? "";
  const helmet = (recs[1] ?? "").split(",").slice(1).filter(Boolean);
  const suit = (recs[2] ?? "").split(",").slice(1).filter(Boolean);
  return { license, helmet, suit };
}