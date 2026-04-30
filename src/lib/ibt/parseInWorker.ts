import type { IbtParsed } from "./types";

export function parseIbtInWorker(
  buffer: ArrayBuffer,
  onProgress?: (phase: string, pct: number, message?: string) => void,
): Promise<IbtParsed> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./parser.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (ev: MessageEvent<any>) => {
      const m = ev.data;
      if (m.kind === "progress") onProgress?.(m.phase, m.pct, m.message);
      else if (m.kind === "done") {
        // Re-hydrate Float32Arrays (postMessage preserves them across module workers, this is for typing only)
        resolve(m.parsed as IbtParsed);
        worker.terminate();
      } else if (m.kind === "error") {
        reject(new Error(m.message));
        worker.terminate();
      }
    };
    worker.onerror = (e) => {
      reject(new Error(e.message || "Worker error"));
      worker.terminate();
    };
    worker.postMessage({ buffer }, [buffer]);
  });
}