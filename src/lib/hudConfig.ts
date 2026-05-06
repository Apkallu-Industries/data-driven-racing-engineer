import { useEffect, useState } from "react";

/**
 * Per-slot channel mapping for the Cinema HUD. Lets the user point each
 * widget at any channel in their .ibt file (e.g. swap Speed → GPS speed,
 * LatAccel → a derived channel). Persisted in localStorage.
 */

export interface HudConfig {
  speed: string;
  rpm: string;
  gear: string;
  throttle: string;
  brake: string;
  clutch: string;
  steer: string;
  steerMax: string;
  latG: string;
  longG: string;
  fuel: string;
  lapPct: string;
  lapTime: string;
}

export const HUD_DEFAULTS: HudConfig = {
  speed: "Speed",
  rpm: "RPM",
  gear: "Gear",
  throttle: "Throttle",
  brake: "Brake",
  clutch: "Clutch",
  steer: "SteeringWheelAngle",
  steerMax: "SteeringWheelAngleMax",
  latG: "LatAccel",
  longG: "LongAccel",
  fuel: "FuelLevel",
  lapPct: "LapDistPct",
  lapTime: "LapCurrentLapTime",
};

/** Visual unit for the speed widget. */
export type SpeedUnit = "kmh" | "mph" | "ms";

export interface HudPrefs {
  config: HudConfig;
  speedUnit: SpeedUnit;
}

const STORAGE_KEY = "apextrace.hud.v1";

function readPrefs(): HudPrefs {
  if (typeof window === "undefined") return { config: HUD_DEFAULTS, speedUnit: "kmh" };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { config: HUD_DEFAULTS, speedUnit: "kmh" };
    const parsed = JSON.parse(raw) as Partial<HudPrefs>;
    return {
      config: { ...HUD_DEFAULTS, ...(parsed.config ?? {}) },
      speedUnit: parsed.speedUnit ?? "kmh",
    };
  } catch {
    return { config: HUD_DEFAULTS, speedUnit: "kmh" };
  }
}

function writePrefs(p: HudPrefs) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota / private mode — ignore */
  }
}

/**
 * React hook for HUD prefs. Returns current prefs and a setter that
 * automatically persists. All open Cinema panels stay in sync via a
 * cross-instance "storage"-like custom event.
 */
const EVT = "apextrace:hud-change";

export function useHudPrefs(): [HudPrefs, (next: HudPrefs) => void, () => void] {
  const [prefs, setPrefs] = useState<HudPrefs>(() => readPrefs());

  useEffect(() => {
    const onChange = () => setPrefs(readPrefs());
    window.addEventListener(EVT, onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener(EVT, onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const update = (next: HudPrefs) => {
    writePrefs(next);
    setPrefs(next);
    window.dispatchEvent(new CustomEvent(EVT));
  };

  const reset = () => update({ config: HUD_DEFAULTS, speedUnit: "kmh" });

  return [prefs, update, reset];
}

/** Human-friendly slot labels for the settings panel. */
export const HUD_SLOT_LABELS: Record<keyof HudConfig, { label: string; hint: string }> = {
  speed: { label: "Speed", hint: "Big centre digit (m/s — converted to km/h or mph)" },
  rpm: { label: "RPM", hint: "Drives the arc + redline colour" },
  gear: { label: "Gear", hint: "Centre digit / N / R" },
  throttle: { label: "Throttle", hint: "Green pedal bar (0–1)" },
  brake: { label: "Brake", hint: "Red pedal bar (0–1)" },
  clutch: { label: "Clutch", hint: "Third pedal bar (0–1)" },
  steer: { label: "Steering angle", hint: "Wheel rotation (radians)" },
  steerMax: { label: "Steering max", hint: "Lock used to scale wheel rotation" },
  latG: { label: "Lateral G", hint: "Horizontal axis of the G-dot (m/s²)" },
  longG: { label: "Longitudinal G", hint: "Vertical axis of the G-dot (m/s²)" },
  fuel: { label: "Fuel level", hint: "Bottom-right read-out (L)" },
  lapPct: { label: "Lap progress", hint: "0–1, drives the lap arc" },
  lapTime: { label: "Lap time", hint: "Elapsed time on current lap (s)" },
};