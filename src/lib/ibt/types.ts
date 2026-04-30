// Shared .ibt parsed-data types (used by worker + UI).

// iRacing irsdk variable type codes
export const IBT_TYPE = {
  Char: 0,
  Bool: 1,
  Int: 2,
  Bitfield: 3,
  Float: 4,
  Double: 5,
} as const;

export interface IbtVarHeader {
  name: string;
  desc: string;
  unit: string;
  type: number;
  offset: number;
  count: number;
}

export interface IbtChannel {
  name: string;
  unit: string;
  desc: string;
  type: number;
  /** Per-tick values. For bool/int/bitfield stored as float-coerced numbers. */
  data: Float32Array;
  min: number;
  max: number;
  avg: number;
  group: string;
}

export interface IbtLap {
  lap: number;
  startTick: number;
  endTick: number;
  /** Lap time in seconds (from SessionTime). */
  timeS: number;
}

export interface IbtMeta {
  ver: number;
  tickRate: number;
  numVars: number;
  numTicks: number;
  durationS: number;
  bufLen: number;
  trackName?: string;
  trackDisplayName?: string;
  trackLengthKm?: number;
  carName?: string;
  driverName?: string;
  recordedAt?: string;
  bestLapS?: number;
  sessionInfoYaml?: string;
}

export interface IbtParsed {
  meta: IbtMeta;
  channels: Record<string, IbtChannel>;
  channelNames: string[];
  laps: IbtLap[];
  /** Reconstructed XY track outline (one point per tick, normalized). */
  trackXY?: { x: Float32Array; y: Float32Array; minX: number; maxX: number; minY: number; maxY: number };
}

export interface IbtParseProgress {
  phase: "header" | "vars" | "yaml" | "samples" | "laps" | "track" | "done";
  pct: number;
  message?: string;
}