import { create } from "zustand";
import type { IbtChannel, IbtParsed } from "./ibt/types";
import { catalogEntry } from "./ibt/channelCatalog";

/**
 * Live bridge client.
 *
 * Connects to the local iRacing bridge (https://github.com/.../iracing-bridge)
 * which runs at ws://localhost:3001 by default and broadcasts iRacing SDK
 * telemetry frames using the same channel names found in `.ibt` files.
 *
 * Accepts any of these inbound JSON shapes (the bridge format may evolve):
 *   { type: "telemetry", values: {Speed: 120, Throttle: 0.5, ...}, sessionTime?, lap? }
 *   { channels: {Speed: 120, ...}, sessionTime?, lap? }
 *   { Speed: 120, Throttle: 0.5, ... }            // raw payload
 *   { name: "Speed", value: 120 }                 // per-channel events
 * and ignores ping/pong/info envelopes.
 */

export type LiveValues = Record<string, number>;

/** Per-channel rolling ring buffer. */
interface ChannelRing {
  data: Float32Array;       // length = HISTORY_CAPACITY
  unit: string;
  group: string;
}

/** Snapshot of a completed lap from the live stream. */
export interface LiveLapSnapshot {
  lap: number;
  startTick: number;
  endTick: number;
  timeS: number;
}

interface LiveBridgeState {
  url: string;
  setUrl: (u: string) => void;

  status: "disconnected" | "connecting" | "connected" | "error";
  error: string | null;

  values: LiveValues;
  channelNames: string[];
  sessionTime: number | null;
  lap: number | null;
  hz: number;            // measured update rate
  lastFrameAt: number;   // performance.now()

  /** Last N raw inbound messages (string), newest first. For debugging. */
  rawLog: string[];
  clearRawLog: () => void;

  /** Total ticks recorded since connect (monotonic; not capped by buffer). */
  tickCount: number;
  /** Lap snapshots derived from Lap/LapCompleted transitions. */
  lapSnapshots: LiveLapSnapshot[];
  /** Bump counter used by consumers to trigger periodic refresh. */
  rev: number;

  connect: (url?: string) => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let frameCounter = 0;
let hzTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manuallyClosed = false;
const RAW_LOG_MAX = 25;

/** Ring buffer capacity (~120s at 60Hz). */
export const HISTORY_CAPACITY = 7200;

/** Per-channel ring buffers — kept outside Zustand state to avoid re-renders on every frame. */
const HISTORY: Map<string, ChannelRing> = new Map();
/** Tracks the lap number that the last tick belonged to (for lap-change detection). */
let currentLapNum: number | null = null;
let currentLapStartTick = 0;
let currentLapStartTime = 0;
let lastSessionTime = 0;
/** Reset all history. */
function resetHistory() {
  HISTORY.clear();
  currentLapNum = null;
  currentLapStartTick = 0;
  currentLapStartTime = 0;
  lastSessionTime = 0;
}

function writeSample(name: string, value: number, tick: number) {
  let ring = HISTORY.get(name);
  if (!ring) {
    const data = new Float32Array(HISTORY_CAPACITY);
    data.fill(NaN);
    const cat = catalogEntry(name);
    ring = { data, unit: cat?.unit ?? "", group: cat?.group ?? "Live" };
    HISTORY.set(name, ring);
  }
  ring.data[tick % HISTORY_CAPACITY] = value;
}

/** Unroll the ring into a chronological Float32Array of length min(tickCount, HISTORY_CAPACITY). */
function unrollRing(ring: ChannelRing, tickCount: number): Float32Array {
  const len = Math.min(tickCount, HISTORY_CAPACITY);
  const out = new Float32Array(len);
  if (tickCount <= HISTORY_CAPACITY) {
    out.set(ring.data.subarray(0, len));
  } else {
    const head = tickCount % HISTORY_CAPACITY;
    out.set(ring.data.subarray(head));
    out.set(ring.data.subarray(0, head), HISTORY_CAPACITY - head);
  }
  return out;
}

/**
 * Snapshot the live ring buffers as a pseudo-IbtParsed so that every existing
 * widget (which expects an IbtParsed) can render the live stream unchanged.
 * Call this from a polling effect — it's not free (it allocates per call).
 */
export function buildLiveParsed(opts?: { tickRate?: number }): IbtParsed | null {
  const state = useLiveBridge.getState();
  const tickCount = state.tickCount;
  if (tickCount < 2 || HISTORY.size === 0) return null;

  const tickRate = opts?.tickRate ?? Math.max(1, state.hz || 60);
  const channels: Record<string, IbtChannel> = {};
  const channelNames: string[] = [];
  let bufLen = 0;

  for (const [name, ring] of HISTORY) {
    const data = unrollRing(ring, tickCount);
    let min = Infinity, max = -Infinity, sum = 0, n = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      n++;
    }
    if (!Number.isFinite(min)) { min = 0; max = 0; }
    channels[name] = {
      name,
      unit: ring.unit,
      desc: "",
      type: 4,
      data,
      min,
      max,
      avg: n > 0 ? sum / n : 0,
      group: ring.group,
    };
    channelNames.push(name);
    bufLen = data.length;
  }

  // Synthesize SessionTime if not present (downstream code uses it heavily).
  if (!channels["SessionTime"]) {
    const data = new Float32Array(bufLen);
    for (let i = 0; i < bufLen; i++) data[i] = i / tickRate;
    channels["SessionTime"] = {
      name: "SessionTime",
      unit: "s",
      desc: "Synthetic session time (live)",
      type: 4,
      data,
      min: data[0] ?? 0,
      max: data[bufLen - 1] ?? 0,
      avg: bufLen > 0 ? (data[0] + data[bufLen - 1]) / 2 : 0,
      group: "Live",
    };
    channelNames.push("SessionTime");
  }

  // Lap list: snapshots + the current (in-progress) lap.
  const laps = state.lapSnapshots.map((l) => ({
    lap: l.lap,
    startTick: Math.max(0, l.startTick - (tickCount - bufLen)),
    endTick: Math.max(0, l.endTick - (tickCount - bufLen)),
    timeS: l.timeS,
  })).filter((l) => l.endTick > 0);
  // Add live in-progress lap so widgets that key off the current lap have a row.
  if (currentLapNum != null) {
    const liveStart = Math.max(0, currentLapStartTick - (tickCount - bufLen));
    laps.push({
      lap: currentLapNum,
      startTick: liveStart,
      endTick: bufLen - 1,
      timeS: Math.max(0, lastSessionTime - currentLapStartTime),
    });
  }

  // Track XY: if we have Lat/Lon, project loosely; otherwise leave undefined.
  let trackXY: IbtParsed["trackXY"] = undefined;
  const lat = channels["Lat"]?.data;
  const lon = channels["Lon"]?.data;
  if (lat && lon && lat.length === lon.length && lat.length > 1) {
    const x = new Float32Array(lon.length);
    const y = new Float32Array(lat.length);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < lon.length; i++) {
      const xv = lon[i];
      const yv = lat[i];
      x[i] = xv;
      y[i] = -yv; // flip so north is up
      if (Number.isFinite(xv)) { if (xv < minX) minX = xv; if (xv > maxX) maxX = xv; }
      if (Number.isFinite(yv)) { if (-yv < minY) minY = -yv; if (-yv > maxY) maxY = -yv; }
    }
    if (Number.isFinite(minX)) trackXY = { x, y, minX, maxX, minY, maxY };
  }

  return {
    meta: {
      ver: 1,
      tickRate,
      numVars: channelNames.length,
      numTicks: bufLen,
      durationS: bufLen / tickRate,
      bufLen,
      trackName: "Live",
      carName: "Live",
      recordedAt: new Date().toISOString(),
    },
    channels,
    channelNames,
    laps,
    trackXY,
  };
}

function normalizeFrame(msg: unknown): {
  values: LiveValues;
  sessionTime: number | null;
  lap: number | null;
} | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;

  // Filter pure control envelopes.
  const t = typeof m.type === "string" ? m.type.toLowerCase() : "";
  if (t === "ping" || t === "pong" || t === "hello" || t === "info") return null;

  // Per-channel event shape.
  if (typeof m.name === "string" && typeof m.value === "number") {
    return { values: { [m.name]: m.value }, sessionTime: null, lap: null };
  }

  const candidate =
    (m.values && typeof m.values === "object" && (m.values as Record<string, unknown>)) ||
    (m.channels && typeof m.channels === "object" && (m.channels as Record<string, unknown>)) ||
    (m.data && typeof m.data === "object" && (m.data as Record<string, unknown>)) ||
    m;

  const values: LiveValues = {};
  for (const [k, v] of Object.entries(candidate)) {
    if (typeof v === "number" && Number.isFinite(v)) values[k] = v;
    else if (typeof v === "boolean") values[k] = v ? 1 : 0;
  }
  if (Object.keys(values).length === 0) return null;

  const sessionTime =
    typeof m.sessionTime === "number"
      ? m.sessionTime
      : typeof values.SessionTime === "number"
        ? values.SessionTime
        : null;
  const lap =
    typeof m.lap === "number"
      ? m.lap
      : typeof values.Lap === "number"
        ? values.Lap
        : typeof values.LapCompleted === "number"
          ? values.LapCompleted
          : null;

  return { values, sessionTime, lap };
}

export const useLiveBridge = create<LiveBridgeState>((set, get) => ({
  url:
    (typeof localStorage !== "undefined" && localStorage.getItem("apextrace.bridgeUrl")) ||
    "ws://localhost:3001",
  setUrl: (u) => {
    if (typeof localStorage !== "undefined") localStorage.setItem("apextrace.bridgeUrl", u);
    set({ url: u });
  },

  status: "disconnected",
  error: null,
  values: {},
  channelNames: [],
  sessionTime: null,
  lap: null,
  hz: 0,
  lastFrameAt: 0,
  rawLog: [],
  clearRawLog: () => set({ rawLog: [] }),

  tickCount: 0,
  lapSnapshots: [],
  rev: 0,

  connect: (url) => {
    const target = url ?? get().url;
    get().disconnect();
    manuallyClosed = false;
    resetHistory();
    set({ tickCount: 0, lapSnapshots: [], values: {}, channelNames: [], rev: 0 });
    set({ status: "connecting", error: null });
    try {
      ws = new WebSocket(target);
    } catch (e) {
      set({ status: "error", error: (e as Error).message });
      return;
    }
    ws.onopen = () => set({ status: "connected", error: null });
    ws.onerror = () => set({ status: "error", error: "WebSocket error (is the bridge running?)" });
    ws.onclose = () => {
      set({ status: "disconnected" });
      if (!manuallyClosed) {
        reconnectTimer = setTimeout(() => get().connect(target), 2000);
      }
    };
    ws.onmessage = (ev) => {
      let parsed: unknown;
      const raw = typeof ev.data === "string" ? ev.data : "[binary]";
      const nextLog = [raw, ...get().rawLog].slice(0, RAW_LOG_MAX);
      try {
        parsed = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch {
        set({ rawLog: nextLog });
        return;
      }
      const frame = normalizeFrame(parsed);
      if (!frame) {
        set({ rawLog: nextLog });
        return;
      }
      frameCounter += 1;
      const merged = { ...get().values, ...frame.values };
      const tick = get().tickCount;
      // Append every numeric value to its ring.
      for (const [k, v] of Object.entries(frame.values)) {
        if (Number.isFinite(v)) writeSample(k, v, tick);
      }
      const sessionTime = frame.sessionTime ?? get().sessionTime;
      if (sessionTime != null) lastSessionTime = sessionTime;

      // Lap-change detection.
      const lapNow = frame.lap ?? get().lap;
      let lapSnapshots = get().lapSnapshots;
      if (lapNow != null) {
        if (currentLapNum == null) {
          currentLapNum = lapNow;
          currentLapStartTick = tick;
          currentLapStartTime = sessionTime ?? 0;
        } else if (lapNow !== currentLapNum) {
          // Close out the previous lap.
          const timeS = Math.max(0, (sessionTime ?? lastSessionTime) - currentLapStartTime);
          lapSnapshots = [
            ...lapSnapshots,
            { lap: currentLapNum, startTick: currentLapStartTick, endTick: tick, timeS },
          ].slice(-32);
          currentLapNum = lapNow;
          currentLapStartTick = tick;
          currentLapStartTime = sessionTime ?? lastSessionTime;
        }
      }

      set({
        values: merged,
        channelNames: Object.keys(merged).sort(),
        sessionTime,
        lap: lapNow,
        lastFrameAt: performance.now(),
        rawLog: nextLog,
        tickCount: tick + 1,
        lapSnapshots,
        rev: get().rev + 1,
      });
    };

    if (hzTimer) clearInterval(hzTimer);
    hzTimer = setInterval(() => {
      set({ hz: frameCounter });
      frameCounter = 0;
    }, 1000);
  },

  disconnect: () => {
    manuallyClosed = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (hzTimer) {
      clearInterval(hzTimer);
      hzTimer = null;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* noop */
      }
      ws = null;
    }
    set({ status: "disconnected", hz: 0 });
    resetHistory();
  },
}));