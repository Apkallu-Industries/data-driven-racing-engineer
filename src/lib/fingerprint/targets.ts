/** User-entered target lap times (seconds), keyed by `${track}|${car}`. */
const KEY = "apextrace.targets.v1";

export type TargetMap = Record<string, number>;

export function loadTargets(): TargetMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TargetMap) : {};
  } catch {
    return {};
  }
}

export function saveTargets(t: TargetMap) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* quota */
  }
}

export function pairKey(track: string, car: string): string {
  return `${track}|${car}`;
}

/** Parse "1:23.456" or "83.456" into seconds. Returns null on invalid. */
export function parseLapInput(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const min = m[1] ? parseInt(m[1], 10) : 0;
  const sec = parseFloat(m[2]);
  const total = min * 60 + sec;
  return total >= 5 && total <= 1800 ? total : null;
}