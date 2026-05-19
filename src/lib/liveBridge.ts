import { create } from "zustand";

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

  connect: (url?: string) => void;
  disconnect: () => void;
}

let ws: WebSocket | null = null;
let frameCounter = 0;
let hzTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let manuallyClosed = false;

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

  connect: (url) => {
    const target = url ?? get().url;
    get().disconnect();
    manuallyClosed = false;
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
      try {
        parsed = typeof ev.data === "string" ? JSON.parse(ev.data) : null;
      } catch {
        return;
      }
      const frame = normalizeFrame(parsed);
      if (!frame) return;
      frameCounter += 1;
      const merged = { ...get().values, ...frame.values };
      set({
        values: merged,
        channelNames: Object.keys(merged).sort(),
        sessionTime: frame.sessionTime ?? get().sessionTime,
        lap: frame.lap ?? get().lap,
        lastFrameAt: performance.now(),
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
  },
}));