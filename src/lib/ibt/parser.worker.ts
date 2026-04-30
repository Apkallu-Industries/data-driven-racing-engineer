/// <reference lib="webworker" />
import { parseIbt } from "./parser";

self.onmessage = (ev: MessageEvent<{ buffer: ArrayBuffer }>) => {
  const { buffer } = ev.data;
  try {
    const parsed = parseIbt(buffer, (phase, pct, message) => {
      (self as unknown as Worker).postMessage({ kind: "progress", phase, pct, message });
    });
    // Transfer the underlying typed arrays to avoid copying
    const transfers: ArrayBuffer[] = [];
    for (const c of Object.values(parsed.channels)) transfers.push(c.data.buffer);
    if (parsed.trackXY) {
      transfers.push(parsed.trackXY.x.buffer);
      transfers.push(parsed.trackXY.y.buffer);
    }
    (self as unknown as Worker).postMessage({ kind: "done", parsed }, transfers);
  } catch (err) {
    (self as unknown as Worker).postMessage({ kind: "error", message: (err as Error).message });
  }
};

export {};