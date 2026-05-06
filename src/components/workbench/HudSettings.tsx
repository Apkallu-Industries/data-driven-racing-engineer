import { useMemo } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { HUD_SLOT_LABELS, useHudPrefs, type HudConfig, type SpeedUnit } from "@/lib/hudConfig";
import { catalogEntry } from "@/lib/ibt/channelCatalog";
import { RotateCcw, X } from "lucide-react";

/**
 * HUD customization panel. Presents one channel <select> per Cinema slot,
 * plus the speed-unit toggle. Saves automatically to localStorage via the
 * useHudPrefs hook (no explicit "save" needed).
 */
export function HudSettings({
  parsed,
  onClose,
}: {
  parsed: IbtParsed;
  onClose: () => void;
}) {
  const [prefs, setPrefs, reset] = useHudPrefs();

  const channelNames = useMemo(
    () => [...parsed.channelNames].sort((a, b) => a.localeCompare(b)),
    [parsed.channelNames],
  );

  const update = (slot: keyof HudConfig, value: string) =>
    setPrefs({ ...prefs, config: { ...prefs.config, [slot]: value } });

  return (
    <div className="absolute inset-0 z-20 flex items-stretch justify-end bg-background/60 backdrop-blur-sm">
      <div
        className="hairline-l flex h-full w-[420px] max-w-full flex-col bg-panel shadow-xl"
        role="dialog"
        aria-label="HUD settings"
      >
        <div className="hairline-b flex items-center justify-between px-3 py-2 font-mono text-[11px] uppercase tracking-wider">
          <span>HUD layout</span>
          <div className="flex items-center gap-1">
            <button
              onClick={reset}
              className="flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
              title="Restore defaults"
            >
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
            <button
              onClick={onClose}
              className="flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground hover:bg-rail hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="hairline-b flex items-center justify-between gap-3 px-3 py-2 font-mono text-[11px]">
          <span className="text-muted-foreground">Speed unit</span>
          <div className="flex gap-px overflow-hidden rounded-sm border border-border">
            {(["kmh", "mph", "ms"] as SpeedUnit[]).map((u) => (
              <button
                key={u}
                onClick={() => setPrefs({ ...prefs, speedUnit: u })}
                className={`px-2 py-0.5 text-[10px] uppercase ${
                  prefs.speedUnit === u
                    ? "bg-primary text-primary-foreground"
                    : "bg-rail text-muted-foreground hover:text-foreground"
                }`}
              >
                {u === "kmh" ? "km/h" : u === "mph" ? "mph" : "m/s"}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-1 gap-2">
            {(Object.keys(HUD_SLOT_LABELS) as (keyof HudConfig)[]).map((slot) => {
              const meta = HUD_SLOT_LABELS[slot];
              const value = prefs.config[slot];
              const present = !value || value in parsed.channels;
              const cat = value ? catalogEntry(value) : null;
              const ch = value ? parsed.channels[value] : undefined;
              return (
                <label
                  key={slot}
                  className="hairline rounded-sm bg-rail/40 p-2 font-mono text-[11px]"
                >
                  <div className="flex items-center justify-between">
                    <span className="uppercase tracking-wider text-muted-foreground">
                      {meta.label}
                    </span>
                    {!present && (
                      <span className="rounded-sm bg-destructive/20 px-1.5 py-0.5 text-[9px] uppercase text-destructive-foreground">
                        not in file
                      </span>
                    )}
                  </div>
                  <select
                    value={value}
                    onChange={(e) => update(slot, e.target.value)}
                    className="mt-1 w-full rounded-sm border border-border bg-panel px-2 py-1 text-[11px] outline-none focus:border-primary"
                  >
                    <option value="">— none —</option>
                    {channelNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <div className="mt-1 text-[10px] normal-case tracking-normal text-muted-foreground">
                    {meta.hint}
                    {ch && (
                      <>
                        {" "}· range {ch.min.toFixed(2)}–{ch.max.toFixed(2)}
                        {ch.unit ? ` ${ch.unit}` : ""}
                      </>
                    )}
                    {cat && cat.desc !== meta.hint && (
                      <>
                        <br />
                        <span className="text-muted-foreground/80">{cat.desc}</span>
                      </>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        <div className="hairline-t px-3 py-2 font-mono text-[10px] text-muted-foreground">
          Layout saves automatically to this browser.
        </div>
      </div>
    </div>
  );
}