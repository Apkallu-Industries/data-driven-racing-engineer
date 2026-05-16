import { create } from "zustand";
import type { IbtParsed } from "./ibt/types";

export const DEFAULT_CHANNELS = ["Speed", "Throttle", "Brake", "RPM", "Gear", "SteeringWheelAngle", "LatAccel", "LongAccel"];

export type MapMode = "drift" | "aligned" | "averaged";
export type MapColorChannel = "none" | "Throttle" | "Brake" | "Speed" | "RPM" | "Gear" | "DeltaT";

export const CHANNEL_COLOR: Record<string, string> = {
  Speed: "var(--ch-speed)",
  Throttle: "var(--ch-throttle)",
  Brake: "var(--ch-brake)",
  RPM: "var(--ch-rpm)",
  Gear: "var(--ch-gear)",
  SteeringWheelAngle: "var(--ch-steer)",
  LatAccel: "var(--ch-glat)",
  LongAccel: "var(--ch-glong)",
};

export function colorForChannel(name: string): string {
  return CHANNEL_COLOR[name] ?? "var(--ch-default)";
}

interface WorkbenchState {
  parsed: IbtParsed | null;
  setParsed: (p: IbtParsed | null) => void;

  cursorTick: number;
  setCursorTick: (t: number) => void;

  selectedChannels: string[];
  toggleChannel: (name: string) => void;
  setChannels: (names: string[]) => void;

  refLap: number | null;
  cmpLap: number | null;
  setRefLap: (l: number | null) => void;
  setCmpLap: (l: number | null) => void;

  playing: boolean;
  speed: number;
  setPlaying: (p: boolean) => void;
  setSpeed: (s: number) => void;

  mapMode: MapMode;
  mapColorBy: MapColorChannel;
  setMapMode: (m: MapMode) => void;
  setMapColorBy: (c: MapColorChannel) => void;

  showSectorHeat: boolean;
  showTrackBands: boolean;
  showDeviation: boolean;
  setShowSectorHeat: (v: boolean) => void;
  setShowTrackBands: (v: boolean) => void;
  setShowDeviation: (v: boolean) => void;

  mapThicknessBySpeed: boolean;
  setMapThicknessBySpeed: (v: boolean) => void;
}

export const useWorkbench = create<WorkbenchState>((set) => ({
  parsed: null,
  setParsed: (p) => {
    // Default refLap = fastest valid lap (skip in/out & corrupt laps).
    let bestLap: number | null = null;
    if (p && p.laps.length) {
      let bestT = Infinity;
      for (const l of p.laps) {
        const valid = l.endTick - l.startTick > 30 && l.timeS > 5;
        if (valid && l.timeS < bestT) {
          bestT = l.timeS;
          bestLap = l.lap;
        }
      }
      if (bestLap == null) bestLap = p.laps[0].lap;
    }
    // Cursor starts at the fastest lap so widgets reflect the best run.
    const startTick = bestLap != null
      ? (p!.laps.find((l) => l.lap === bestLap)?.startTick ?? 0)
      : 0;
    set(() => ({
      parsed: p,
      cursorTick: startTick,
      selectedChannels: p
        ? DEFAULT_CHANNELS.filter((c) => c in p.channels)
        : [],
      refLap: bestLap,
      cmpLap: null,
      playing: false,
    }));
  },
  cursorTick: 0,
  setCursorTick: (t) => set({ cursorTick: t }),
  selectedChannels: [],
  toggleChannel: (name) =>
    set((s) => ({
      selectedChannels: s.selectedChannels.includes(name)
        ? s.selectedChannels.filter((n) => n !== name)
        : [...s.selectedChannels, name],
    })),
  setChannels: (names) => set({ selectedChannels: names }),
  refLap: null,
  cmpLap: null,
  setRefLap: (l) => set({ refLap: l }),
  setCmpLap: (l) => set({ cmpLap: l }),
  playing: false,
  speed: 1,
  setPlaying: (p) => set({ playing: p }),
  setSpeed: (s) => set({ speed: s }),

  mapMode: "aligned",
  mapColorBy: "Throttle",
  setMapMode: (m) => set({ mapMode: m }),
  setMapColorBy: (c) => set({ mapColorBy: c }),

  showSectorHeat: false,
  showTrackBands: false,
  showDeviation: false,
  setShowSectorHeat: (v) => set({ showSectorHeat: v }),
  setShowTrackBands: (v) => set({ showTrackBands: v }),
  setShowDeviation: (v) => set({ showDeviation: v }),

  mapThicknessBySpeed: false,
  setMapThicknessBySpeed: (v) => set({ mapThicknessBySpeed: v }),
}));