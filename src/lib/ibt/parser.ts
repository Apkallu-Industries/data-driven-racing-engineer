// Pure .ibt parser. Runs inside a Web Worker.
// Implements iRacing IRSDK binary telemetry layout per the SDK docs.

import { IBT_TYPE, type IbtChannel, type IbtLap, type IbtParsed, type IbtVarHeader } from "./types";

const VAR_HEADER_SIZE = 144;

function readCStr(view: DataView, offset: number, len: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, len);
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, end));
}

function inferGroup(name: string): string {
  const n = name.toLowerCase();
  if (/(throttle|brake|clutch|steer|handbrake|driver)/.test(n)) return "Driver Inputs";
  if (/(speed|velocity|accel|yaw|pitch|roll|gear|rpm|enginerpm|track)/.test(n)) return "Vehicle";
  if (/(fuel|engine|oil|water|coolant|mgu|battery|kers|drs|boost|manifold)/.test(n)) return "Engine";
  if (/(tire|tyre|temp|press|carcass|tread|wear|cf|cm|cl|lf|rf|lr|rr)/.test(n) && /(temp|press|wear|tread|cold|carcass)/.test(n)) return "Tires";
  if (/(shock|spring|ride|damper|susp|arb|height|defl)/.test(n)) return "Suspension";
  if (/(session|lap|race|incident|flag|pit|track|surface|sector)/.test(n)) return "Session";
  if (/(weather|wind|air|track(temp|surface|wetness|usage)|humidity|skies|fog|precip)/.test(n)) return "Environment";
  if (/(cpu|fps|frame|gpu|mem|latency|ping)/.test(n)) return "System";
  return "Other";
}

function readValueAsFloat(view: DataView, abs: number, type: number): number {
  switch (type) {
    case IBT_TYPE.Char: return view.getUint8(abs);
    case IBT_TYPE.Bool: return view.getUint8(abs);
    case IBT_TYPE.Int: return view.getInt32(abs, true);
    case IBT_TYPE.Bitfield: return view.getUint32(abs, true);
    case IBT_TYPE.Float: return view.getFloat32(abs, true);
    case IBT_TYPE.Double: return view.getFloat64(abs, true);
    default: return 0;
  }
}

function parseSessionYaml(yaml: string): {
  trackName?: string;
  trackDisplayName?: string;
  trackLengthKm?: number;
  carName?: string;
  driverName?: string;
  recordedAt?: string;
  bestLapS?: number;
} {
  const out: ReturnType<typeof parseSessionYaml> = {};
  const grab = (key: string): string | undefined => {
    const re = new RegExp(`^\\s*${key}:\\s*(.*?)\\s*$`, "m");
    const m = yaml.match(re);
    return m ? m[1].replace(/^"|"$/g, "") : undefined;
  };
  out.trackName = grab("TrackName");
  out.trackDisplayName = grab("TrackDisplayName");
  const tl = grab("TrackLength");
  if (tl) {
    const m = tl.match(/([\d.]+)\s*km/);
    if (m) out.trackLengthKm = parseFloat(m[1]);
  }
  // Driver: look up DriverInfo.DriverCarIdx then Drivers[i].UserName
  const driverIdxM = yaml.match(/DriverCarIdx:\s*(\d+)/);
  const userName = grab("UserName");
  if (userName) out.driverName = userName;
  if (driverIdxM) {
    const idx = parseInt(driverIdxM[1], 10);
    // find Drivers section - take CarIdx == idx
    const driversBlock = yaml.split(/Drivers:\s*\n/)[1];
    if (driversBlock) {
      const re = new RegExp(`-\\s*CarIdx:\\s*${idx}[\\s\\S]*?UserName:\\s*([^\\n]+)`);
      const m = driversBlock.match(re);
      if (m) out.driverName = m[1].trim();
      const re2 = new RegExp(`-\\s*CarIdx:\\s*${idx}[\\s\\S]*?CarScreenName:\\s*([^\\n]+)`);
      const m2 = driversBlock.match(re2);
      if (m2) out.carName = m2[1].trim();
    }
  }
  if (!out.carName) {
    const cs = grab("CarScreenName");
    if (cs) out.carName = cs;
  }
  return out;
}

export type ProgressCb = (phase: string, pct: number, msg?: string) => void;

export function parseIbt(buffer: ArrayBuffer, onProgress?: ProgressCb): IbtParsed {
  const view = new DataView(buffer);
  onProgress?.("header", 0);

  // irsdk_header (read first 12 ints: 48 bytes)
  const ver = view.getInt32(0, true);
  // status @ 4
  const tickRate = view.getInt32(8, true);
  // sessionInfoUpdate @ 12
  const sessionInfoLen = view.getInt32(16, true);
  const sessionInfoOffset = view.getInt32(20, true);
  const numVars = view.getInt32(24, true);
  const varHeaderOffset = view.getInt32(28, true);
  const numBuf = view.getInt32(32, true);
  const bufLen = view.getInt32(36, true);

  if (ver !== 2) {
    // proceed but warn
    console.warn(`[ibt] unexpected version ${ver}`);
  }
  if (numBuf < 1) throw new Error("Invalid .ibt: no data buffers");

  // first varBuf entry at offset 48: { tickCount, bufOffset, pad[2] }
  const bufOffset = view.getInt32(48 + 4, true);

  // Parse var headers
  onProgress?.("vars", 5);
  const vars: IbtVarHeader[] = new Array(numVars);
  for (let i = 0; i < numVars; i++) {
    const base = varHeaderOffset + i * VAR_HEADER_SIZE;
    const type = view.getInt32(base, true);
    const offset = view.getInt32(base + 4, true);
    const count = view.getInt32(base + 8, true);
    // base+12: bool countAsTime + 3 pad
    const name = readCStr(view, base + 16, 32);
    const desc = readCStr(view, base + 48, 64);
    const unit = readCStr(view, base + 112, 32);
    vars[i] = { name, type, offset, count, desc, unit };
  }

  // Session info YAML
  onProgress?.("yaml", 10);
  let yaml = "";
  if (sessionInfoLen > 0 && sessionInfoOffset > 0 && sessionInfoOffset + sessionInfoLen <= buffer.byteLength) {
    yaml = readCStr(view, sessionInfoOffset, sessionInfoLen);
  }
  const yamlMeta = parseSessionYaml(yaml);

  // How many ticks?
  const dataBytes = buffer.byteLength - bufOffset;
  const numTicks = Math.max(0, Math.floor(dataBytes / bufLen));

  // Allocate per-channel arrays
  onProgress?.("samples", 15, `${numVars} channels × ${numTicks} ticks`);
  const channels: Record<string, IbtChannel> = {};
  // Filter out array-type vars (count > 1) to keep memory bounded; expose them as multi-channels with [n]
  const flatVars: Array<{ name: string; v: IbtVarHeader; arrayIdx: number }> = [];
  for (const v of vars) {
    if (!v.name) continue;
    if (v.count <= 1) {
      flatVars.push({ name: v.name, v, arrayIdx: 0 });
    } else {
      // expand small arrays only (<=8 elements) to avoid memory blowup on tire arrays etc.
      const limit = Math.min(v.count, 8);
      for (let k = 0; k < limit; k++) {
        flatVars.push({ name: `${v.name}[${k}]`, v, arrayIdx: k });
      }
    }
  }

  for (const fv of flatVars) {
    channels[fv.name] = {
      name: fv.name,
      unit: fv.v.unit,
      desc: fv.v.desc,
      type: fv.v.type,
      data: new Float32Array(numTicks),
      min: Infinity,
      max: -Infinity,
      avg: 0,
      group: inferGroup(fv.name),
    };
  }

  // Stream ticks
  const typeSize = (t: number) => (t === 5 ? 8 : t === 0 || t === 1 ? 1 : 4);
  const progressEvery = Math.max(1, Math.floor(numTicks / 40));
  for (let t = 0; t < numTicks; t++) {
    const recordBase = bufOffset + t * bufLen;
    for (const fv of flatVars) {
      const elemSize = typeSize(fv.v.type);
      const abs = recordBase + fv.v.offset + fv.arrayIdx * elemSize;
      const ch = channels[fv.name];
      const val = readValueAsFloat(view, abs, fv.v.type);
      ch.data[t] = val;
      if (val < ch.min) ch.min = val;
      if (val > ch.max) ch.max = val;
      ch.avg += val;
    }
    if (t % progressEvery === 0) {
      onProgress?.("samples", 15 + Math.floor((t / numTicks) * 60), `${t}/${numTicks}`);
    }
  }
  for (const ch of Object.values(channels)) {
    ch.avg = numTicks > 0 ? ch.avg / numTicks : 0;
    if (!isFinite(ch.min)) ch.min = 0;
    if (!isFinite(ch.max)) ch.max = 0;
  }

  // Lap detection from "Lap" channel (or LapDist transitions)
  onProgress?.("laps", 80);
  const laps: IbtLap[] = [];
  const lapCh = channels["Lap"];
  const sessionTimeCh = channels["SessionTime"];
  if (lapCh && sessionTimeCh && numTicks > 0) {
    let curLap = lapCh.data[0];
    let curStart = 0;
    for (let t = 1; t < numTicks; t++) {
      const v = lapCh.data[t];
      if (v !== curLap) {
        laps.push({
          lap: curLap,
          startTick: curStart,
          endTick: t - 1,
          timeS: sessionTimeCh.data[t - 1] - sessionTimeCh.data[curStart],
        });
        curLap = v;
        curStart = t;
      }
    }
    laps.push({
      lap: curLap,
      startTick: curStart,
      endTick: numTicks - 1,
      timeS: sessionTimeCh.data[numTicks - 1] - sessionTimeCh.data[curStart],
    });
  }
  let bestLapS: number | undefined = undefined;
  for (const l of laps) {
    if (l.endTick - l.startTick < 30) continue; // skip outlaps/incomplete
    if (l.timeS > 5 && (bestLapS === undefined || l.timeS < bestLapS)) bestLapS = l.timeS;
  }

  // Track XY reconstruction by integrating velocity components
  onProgress?.("track", 88);
  let trackXY: IbtParsed["trackXY"] | undefined;
  const vxCh = channels["VelocityX"];
  const vyCh = channels["VelocityY"];
  const yawCh = channels["Yaw"] || channels["YawNorth"];
  if (vxCh && vyCh && yawCh && numTicks > 1) {
    const x = new Float32Array(numTicks);
    const y = new Float32Array(numTicks);
    let px = 0, py = 0;
    const dt = 1 / Math.max(1, tickRate);
    let minX = 0, maxX = 0, minY = 0, maxY = 0;
    for (let t = 0; t < numTicks; t++) {
      const yaw = yawCh.data[t];
      // car-local Vx forward, Vy lateral; rotate by yaw to world frame
      const vx = vxCh.data[t];
      const vy = vyCh.data[t];
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const wx = vx * cs - vy * sn;
      const wy = vx * sn + vy * cs;
      px += wx * dt;
      py += wy * dt;
      x[t] = px;
      y[t] = py;
      if (px < minX) minX = px; else if (px > maxX) maxX = px;
      if (py < minY) minY = py; else if (py > maxY) maxY = py;
    }
    trackXY = { x, y, minX, maxX, minY, maxY };
  }

  const sessionTime = sessionTimeCh?.data;
  const durationS = sessionTime && sessionTime.length > 1
    ? sessionTime[sessionTime.length - 1] - sessionTime[0]
    : numTicks / Math.max(1, tickRate);

  onProgress?.("done", 100);

  return {
    meta: {
      ver,
      tickRate,
      numVars,
      numTicks,
      durationS,
      bufLen,
      bestLapS,
      ...yamlMeta,
      sessionInfoYaml: yaml,
    },
    channels,
    channelNames: Object.keys(channels).sort((a, b) => a.localeCompare(b)),
    laps,
    trackXY,
  };
}