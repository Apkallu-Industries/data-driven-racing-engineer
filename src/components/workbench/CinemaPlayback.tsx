import { useMemo, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { Play, Pause, Rewind, FastForward, SkipBack, SkipForward, Settings } from "lucide-react";
import { useHudPrefs } from "@/lib/hudConfig";
import { HudSettings } from "./HudSettings";

/**
 * Cinematic telemetry playback HUD.
 * Reads the shared cursorTick (advanced by Timeline's RAF when playing) so
 * scrubbing here, scrubbing the timeline, or hitting space-bar all stay in
 * sync. Renders a broadcast-style overlay: huge speed digit, RPM arc with
 * gear, throttle/brake stacked bars, steering wheel that actually rotates,
 * a lat/long G dot, and a track-progress arc with the current lap time.
 */

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return m > 0 ? `${m}:${r.toFixed(2).padStart(5, "0")}` : r.toFixed(2);
}

/** Hover overlay listing the channel name + live value/unit for a widget. */
function WidgetInfo({
  items,
}: {
  items: { label: string; channel: string | undefined; value: number | undefined; unit?: string; fmt?: (v: number) => string }[];
}) {
  return (
    <div className="pointer-events-none absolute right-1.5 top-1.5 z-10 min-w-[160px] rounded-sm border border-border bg-panel/95 p-1.5 font-mono text-[10px] opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-100 group-hover:opacity-100">
      {items.map((it) => (
        <div key={it.label} className="flex items-baseline justify-between gap-2 py-0.5">
          <span className="uppercase tracking-wider text-muted-foreground">{it.label}</span>
          <span className="flex flex-col items-end leading-tight">
            <span className="tabular-nums text-foreground">
              {it.value == null || !isFinite(it.value)
                ? "—"
                : (it.fmt ? it.fmt(it.value) : it.value.toFixed(2)) + (it.unit ? ` ${it.unit}` : "")}
            </span>
            <span className="text-[9px] text-muted-foreground/80">
              {it.channel || "—"}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function CinemaPlayback({ parsed }: { parsed: IbtParsed }) {
  const {
    cursorTick,
    setCursorTick,
    playing,
    setPlaying,
    speed,
    setSpeed,
    refLap,
  } = useWorkbench();
  const [prefs] = useHudPrefs();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const total = parsed.meta.numTicks;

  // Resolve which lap the cursor sits in, for in-lap progress + lap timer.
  const currentLap = useMemo(() => {
    return (
      parsed.laps.find((l) => cursorTick >= l.startTick && cursorTick <= l.endTick) ??
      parsed.laps[0]
    );
  }, [parsed.laps, cursorTick]);

  // Pull live channel values at cursor.
  const ch = parsed.channels;
  const v = (slotName: string | undefined) =>
    slotName && ch[slotName] ? ch[slotName].data[cursorTick] : undefined;
  const cfg = prefs.config;

  const speedRaw = v(cfg.speed) ?? 0;
  const speedFactor =
    prefs.speedUnit === "kmh" ? 3.6 : prefs.speedUnit === "mph" ? 2.23694 : 1;
  const speedDisplay = speedRaw * speedFactor;
  const speedUnitLabel =
    prefs.speedUnit === "kmh" ? "KM/H" : prefs.speedUnit === "mph" ? "MPH" : "M/S";
  const rpm = v(cfg.rpm) ?? 0;
  const rpmMax = ch[cfg.rpm]?.max ?? 9000;
  const gear = Math.round(v(cfg.gear) ?? 0);
  const throttle = clamp01(v(cfg.throttle) ?? 0);
  const brake = clamp01(v(cfg.brake) ?? 0);
  const clutch = clamp01(v(cfg.clutch) ?? 0);
  const steerRad = v(cfg.steer) ?? 0;
  const steerMax =
    v(cfg.steerMax) ?? Math.max(Math.PI, ch[cfg.steer]?.max ?? Math.PI);
  const latG = (v(cfg.latG) ?? 0) / 9.81;
  const longG = (v(cfg.longG) ?? 0) / 9.81;
  const lapTime = v(cfg.lapTime) ?? 0;
  const lapPct = clamp01(v(cfg.lapPct) ?? 0);
  const fuelL = v(cfg.fuel);
  const lapNum = currentLap?.lap ?? 0;
  const unitOf = (slot: string | undefined) =>
    slot && ch[slot] ? ch[slot].unit : undefined;

  // RPM arc (0–270°, sweeping clockwise from south-west).
  const rpmFrac = clamp01(rpm / Math.max(1, rpmMax));
  const arcStart = -210;
  const arcEnd = 30;
  const arcSpan = arcEnd - arcStart;
  const arcAngle = arcStart + arcSpan * rpmFrac;
  const polar = (r: number, deg: number, cx = 100, cy = 100) => {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const arcPath = (() => {
    const r = 78;
    const [sx, sy] = polar(r, arcStart);
    const [ex, ey] = polar(r, arcAngle);
    const large = arcAngle - arcStart > 180 ? 1 : 0;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  })();
  const arcBgPath = (() => {
    const r = 78;
    const [sx, sy] = polar(r, arcStart);
    const [ex, ey] = polar(r, arcEnd);
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 1 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  })();

  // Steering wheel rotation: degrees, capped at ±180 visually.
  const steerDeg = Math.max(-360, Math.min(360, (steerRad / Math.max(0.1, steerMax)) * 180));

  // Lap progress arc.
  const progPath = (() => {
    const r = 46;
    const sx = 50;
    const sy = 50 - r;
    const a = arcStart + 360 * lapPct - arcStart; // sweep from top
    const ang = -90 + 360 * lapPct;
    const [ex, ey] = polar(r, ang, 50, 50);
    if (lapPct <= 0.001) return "";
    const large = lapPct > 0.5 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  })();

  // G-dot map: ±1.5g window scaled into a 100px box.
  const G_RANGE = 2.5;
  const gDotX = 50 + clamp01((latG + G_RANGE) / (2 * G_RANGE)) * 100 - 50;
  const gDotY = 50 - clamp01((longG + G_RANGE) / (2 * G_RANGE)) * 100 + 50;

  // Step transports.
  const stepTick = (delta: number) =>
    setCursorTick(Math.max(0, Math.min(total - 1, cursorTick + delta)));
  const jumpToLap = (which: "prev" | "next") => {
    const here = parsed.laps.findIndex((l) => l.lap === currentLap?.lap);
    if (here < 0) return;
    const target =
      which === "prev"
        ? parsed.laps[Math.max(0, here - 1)]
        : parsed.laps[Math.min(parsed.laps.length - 1, here + 1)];
    setCursorTick(target.startTick);
  };

  return (
    <div className="flex h-full flex-col bg-[radial-gradient(ellipse_at_center,_color-mix(in_oklab,var(--panel)_92%,var(--primary))_0%,var(--panel)_70%)]">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Cinema · L{lapNum}{refLap === lapNum ? " · ref" : ""}</span>
        <div className="flex items-center gap-2">
          <span className="tabular-nums">{fmtTime(lapTime)}</span>
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] hover:text-foreground"
            title="Customize HUD"
          >
            <Settings className="h-3 w-3" /> Layout
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[1.2fr_1fr_1fr] gap-px overflow-hidden bg-border/40">
        {/* RPM arc + huge speed */}
        <div className="group relative flex items-center justify-center bg-panel">
          <WidgetInfo
            items={[
              { label: "Speed", channel: cfg.speed, value: speedDisplay, unit: speedUnitLabel.toLowerCase(), fmt: (x) => x.toFixed(1) },
              { label: "RPM", channel: cfg.rpm, value: rpm, unit: "rpm", fmt: (x) => x.toFixed(0) },
              { label: "Gear", channel: cfg.gear, value: gear, fmt: (x) => (x === 0 ? "N" : x === -1 ? "R" : String(x)) },
            ]}
          />
          <svg viewBox="0 0 200 200" className="h-full w-full max-h-[280px] p-2">
            <path d={arcBgPath} fill="none" stroke="var(--border-strong)" strokeWidth={6} strokeLinecap="round" opacity={0.5} />
            <path
              d={arcPath}
              fill="none"
              stroke={rpmFrac > 0.92 ? "var(--ch-brake)" : "var(--primary)"}
              strokeWidth={6}
              strokeLinecap="round"
              style={{ transition: "stroke 60ms linear" }}
            />
            {/* Tick marks */}
            {Array.from({ length: 11 }).map((_, i) => {
              const t = i / 10;
              const ang = arcStart + arcSpan * t;
              const [x1, y1] = polar(72, ang);
              const [x2, y2] = polar(82, ang);
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--muted-foreground)"
                  strokeWidth={i % 2 === 0 ? 1.2 : 0.5}
                  opacity={0.7}
                />
              );
            })}
            {/* Center text: gear + speed */}
            <text x={100} y={88} textAnchor="middle" fontSize={56} fontFamily="monospace" fontWeight={700} fill="var(--foreground)">
              {gear === 0 ? "N" : gear === -1 ? "R" : gear}
            </text>
            <text x={100} y={120} textAnchor="middle" fontSize={36} fontFamily="monospace" fontWeight={700} fill="var(--foreground)" className="tabular-nums">
              {speedDisplay.toFixed(0)}
            </text>
            <text x={100} y={138} textAnchor="middle" fontSize={10} fontFamily="monospace" fill="var(--muted-foreground)">
              {speedUnitLabel}
            </text>
            <text x={100} y={172} textAnchor="middle" fontSize={11} fontFamily="monospace" fill="var(--muted-foreground)" className="tabular-nums">
              {Math.round(rpm)} RPM
            </text>
          </svg>
        </div>

        {/* Steering + pedals */}
        <div className="group relative flex flex-col items-center justify-center gap-3 bg-panel p-3">
          <WidgetInfo
            items={[
              { label: "Steer", channel: cfg.steer, value: (steerRad * 180) / Math.PI, unit: "°", fmt: (x) => x.toFixed(0) },
              { label: "Throttle", channel: cfg.throttle, value: throttle * 100, unit: "%", fmt: (x) => x.toFixed(0) },
              { label: "Brake", channel: cfg.brake, value: brake * 100, unit: "%", fmt: (x) => x.toFixed(0) },
              { label: "Clutch", channel: cfg.clutch, value: clutch * 100, unit: "%", fmt: (x) => x.toFixed(0) },
            ]}
          />
          <svg viewBox="0 0 120 120" className="h-32 w-32">
            <g style={{ transform: `rotate(${steerDeg}deg)`, transformOrigin: "60px 60px", transition: "transform 50ms linear" }}>
              <circle cx={60} cy={60} r={48} fill="none" stroke="var(--border-strong)" strokeWidth={3} />
              <circle cx={60} cy={60} r={8} fill="var(--primary)" />
              <line x1={60} y1={12} x2={60} y2={28} stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" />
              <line x1={12} y1={60} x2={108} y2={60} stroke="var(--primary)" strokeWidth={3} strokeLinecap="round" />
            </g>
            <text x={60} y={114} textAnchor="middle" fontSize={9} fontFamily="monospace" fill="var(--muted-foreground)" className="tabular-nums">
              {((steerRad * 180) / Math.PI).toFixed(0)}°
            </text>
          </svg>
          <div className="flex w-full items-end justify-center gap-2">
            {[
              { k: "T", v: throttle, color: "var(--ch-throttle)" },
              { k: "B", v: brake, color: "var(--ch-brake)" },
              { k: "C", v: clutch, color: "var(--ch-default)" },
            ].map((p) => (
              <div key={p.k} className="flex flex-col items-center gap-1">
                <div className="relative h-24 w-5 overflow-hidden rounded-sm bg-rail">
                  <div
                    className="absolute inset-x-0 bottom-0"
                    style={{ height: `${p.v * 100}%`, background: p.color, transition: "height 50ms linear" }}
                  />
                </div>
                <span className="font-mono text-[10px] text-muted-foreground">{p.k}</span>
                <span className="font-mono text-[10px] tabular-nums text-foreground">{Math.round(p.v * 100)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* G-dot + lap-progress + fuel */}
        <div className="group relative flex flex-col items-center justify-center gap-2 bg-panel p-3">
          <WidgetInfo
            items={[
              { label: "Lat G", channel: cfg.latG, value: latG, unit: "g", fmt: (x) => (x >= 0 ? "+" : "") + x.toFixed(2) },
              { label: "Long G", channel: cfg.longG, value: longG, unit: "g", fmt: (x) => (x >= 0 ? "+" : "") + x.toFixed(2) },
              { label: "Lap %", channel: cfg.lapPct, value: lapPct * 100, unit: "%", fmt: (x) => x.toFixed(1) },
              { label: "Fuel", channel: cfg.fuel, value: fuelL, unit: unitOf(cfg.fuel) || "L", fmt: (x) => x.toFixed(2) },
              { label: "Lap time", channel: cfg.lapTime, value: lapTime, unit: "s", fmt: (x) => fmtTime(x) },
            ]}
          />
          <div className="relative">
            <svg viewBox="0 0 100 100" className="h-32 w-32">
              <circle cx={50} cy={50} r={48} fill="none" stroke="var(--border-strong)" strokeWidth={1} />
              {[0.5, 1, 1.5, 2].map((g) => (
                <circle key={g} cx={50} cy={50} r={(g / G_RANGE) * 50} fill="none" stroke="var(--border)" strokeWidth={0.4} opacity={0.7} />
              ))}
              <line x1={50} y1={2} x2={50} y2={98} stroke="var(--border)" strokeWidth={0.4} />
              <line x1={2} y1={50} x2={98} y2={50} stroke="var(--border)" strokeWidth={0.4} />
              <circle cx={gDotX} cy={gDotY} r={3.5} fill="var(--primary)" style={{ transition: "all 60ms linear" }} />
              <text x={50} y={10} textAnchor="middle" fontSize={6} fontFamily="monospace" fill="var(--muted-foreground)">ACCEL</text>
              <text x={50} y={96} textAnchor="middle" fontSize={6} fontFamily="monospace" fill="var(--muted-foreground)">BRAKE</text>
            </svg>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 font-mono text-[10px]">
            <div className="flex items-center justify-between rounded-sm bg-rail px-2 py-1">
              <span className="text-muted-foreground">LAT</span>
              <span className="tabular-nums">{latG >= 0 ? "+" : ""}{latG.toFixed(2)}g</span>
            </div>
            <div className="flex items-center justify-between rounded-sm bg-rail px-2 py-1">
              <span className="text-muted-foreground">LONG</span>
              <span className="tabular-nums">{longG >= 0 ? "+" : ""}{longG.toFixed(2)}g</span>
            </div>
            <div className="flex items-center justify-between rounded-sm bg-rail px-2 py-1">
              <span className="text-muted-foreground">PCT</span>
              <span className="tabular-nums">{(lapPct * 100).toFixed(1)}%</span>
            </div>
            <div className="flex items-center justify-between rounded-sm bg-rail px-2 py-1">
              <span className="text-muted-foreground">FUEL</span>
              <span className="tabular-nums">{fuelL != null ? `${fuelL.toFixed(1)}L` : "—"}</span>
            </div>
          </div>
          {/* Lap progress arc */}
          <svg viewBox="0 0 100 100" className="h-12 w-12">
            <circle cx={50} cy={50} r={46} fill="none" stroke="var(--border-strong)" strokeWidth={3} />
            {progPath && (
              <path d={progPath} fill="none" stroke="var(--primary)" strokeWidth={4} strokeLinecap="round" />
            )}
            <text x={50} y={56} textAnchor="middle" fontSize={20} fontFamily="monospace" fontWeight={700} fill="var(--foreground)">
              {Math.round(lapPct * 100)}
            </text>
          </svg>
        </div>
      </div>

      {/* Transport */}
      <div className="hairline-t flex items-center gap-2 bg-panel px-3 py-2">
        <button
          onClick={() => jumpToLap("prev")}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground"
          title="Previous lap"
        >
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => stepTick(-Math.round(parsed.meta.tickRate))}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground"
          title="−1s"
        >
          <Rewind className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => setPlaying(!playing)}
          className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-primary-foreground hover:opacity-90"
        >
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <button
          onClick={() => stepTick(Math.round(parsed.meta.tickRate))}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground"
          title="+1s"
        >
          <FastForward className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => jumpToLap("next")}
          className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-muted-foreground hover:text-foreground"
          title="Next lap"
        >
          <SkipForward className="h-3.5 w-3.5" />
        </button>
        <select
          value={speed}
          onChange={(e) => setSpeed(parseFloat(e.target.value))}
          className="rounded-sm border border-border bg-rail px-2 py-1 font-mono text-xs"
          title="Playback speed"
        >
          {[0.25, 0.5, 1, 2, 4, 8].map((s) => (
            <option key={s} value={s}>{s}×</option>
          ))}
        </select>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - 1)}
          value={cursorTick}
          onChange={(e) => setCursorTick(parseInt(e.target.value, 10))}
          className="flex-1 accent-[color:var(--primary)]"
        />
        <div className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {fmtTime(cursorTick / parsed.meta.tickRate)} / {fmtTime((total - 1) / parsed.meta.tickRate)}
        </div>
      </div>
      {settingsOpen && (
        <HudSettings parsed={parsed} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}