import { useEffect, useMemo, useRef, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

/**
 * Friction-circle / "g-g" diagram.
 * Plots LongAccel (Y, braking down / accel up) against LatAccel (X, left/right)
 * for the selected reference lap (or all laps if none selected).
 * No fabricated values — if LatAccel/LongAccel aren't in the file, we say so.
 * Also computes the empirical grip envelope: peak |g| in 36 angular bins.
 */
export function GGDiagram({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap } = useWorkbench();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 320 });

  const lat = parsed.channels["LatAccel"]?.data;
  const lon = parsed.channels["LongAccel"]?.data;
  // iRacing reports m/s²; convert to g for display.
  const G = 9.80665;

  // Build the point cloud for the selected lap(s).
  const { points, refRange, cmpRange, peakLat, peakAccel, peakBrake, envelope } = useMemo(() => {
    if (!lat || !lon) {
      return {
        points: null as Float32Array | null,
        refRange: null as [number, number] | null,
        cmpRange: null as [number, number] | null,
        peakLat: 0,
        peakAccel: 0,
        peakBrake: 0,
        envelope: null as Float32Array | null,
      };
    }
    let r0 = 0;
    let r1 = lat.length;
    let cr: [number, number] | null = null;
    if (refLap != null) {
      const l = parsed.laps.find((x) => x.lap === refLap);
      if (l) {
        r0 = l.startTick;
        r1 = l.endTick;
      }
    }
    if (cmpLap != null) {
      const l = parsed.laps.find((x) => x.lap === cmpLap);
      if (l) cr = [l.startTick, l.endTick];
    }
    const len = r1 - r0;
    const pts = new Float32Array(len * 2);
    let pLat = 0;
    let pAcc = 0;
    let pBrk = 0;
    for (let i = 0; i < len; i++) {
      const x = lat[r0 + i] / G;
      const y = lon[r0 + i] / G;
      pts[i * 2] = x;
      pts[i * 2 + 1] = y;
      const ax = Math.abs(x);
      if (ax > pLat) pLat = ax;
      if (y > pAcc) pAcc = y;
      if (-y > pBrk) pBrk = -y;
    }
    // Empirical envelope: 36 angular bins, max radius in each.
    const BINS = 36;
    const env = new Float32Array(BINS);
    for (let i = 0; i < len; i++) {
      const x = pts[i * 2];
      const y = pts[i * 2 + 1];
      const r = Math.hypot(x, y);
      if (r < 0.05) continue;
      let ang = Math.atan2(y, x);
      if (ang < 0) ang += Math.PI * 2;
      const b = Math.min(BINS - 1, Math.floor((ang / (Math.PI * 2)) * BINS));
      if (r > env[b]) env[b] = r;
    }
    return {
      points: pts,
      refRange: [r0, r1] as [number, number],
      cmpRange: cr,
      peakLat: pLat,
      peakAccel: pAcc,
      peakBrake: pBrk,
      envelope: env,
    };
  }, [lat, lon, parsed.laps, refLap, cmpLap]);

  // Comparison points (drawn under in a different colour).
  const cmpPoints = useMemo(() => {
    if (!lat || !lon || !cmpRange) return null;
    const [a, b] = cmpRange;
    const len = b - a;
    const pts = new Float32Array(len * 2);
    for (let i = 0; i < len; i++) {
      pts[i * 2] = lat[a + i] / G;
      pts[i * 2 + 1] = lon[a + i] / G;
    }
    return pts;
  }, [lat, lon, cmpRange]);

  // Resize observer.
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const s = Math.max(160, Math.min(r.width, r.height));
      setSize({ w: s, h: s });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Render.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);

    const cx = size.w / 2;
    const cy = size.h / 2;
    const maxG = Math.max(2, Math.ceil(Math.max(peakLat, peakAccel, peakBrake) + 0.25));
    const scale = (Math.min(size.w, size.h) / 2 - 16) / maxG;

    // Grid rings + labels.
    ctx.strokeStyle = "rgba(120,130,140,0.18)";
    ctx.lineWidth = 1;
    ctx.font = "10px JetBrains Mono, monospace";
    ctx.fillStyle = "rgba(180,190,200,0.5)";
    for (let g = 1; g <= maxG; g++) {
      ctx.beginPath();
      ctx.arc(cx, cy, g * scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${g}g`, cx + 2, cy - g * scale - 2);
    }
    // Cross-hairs.
    ctx.strokeStyle = "rgba(120,130,140,0.25)";
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(size.w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, size.h);
    ctx.stroke();

    // Quadrant labels.
    ctx.fillStyle = "rgba(140,150,160,0.55)";
    ctx.fillText("Accel", cx + 4, 12);
    ctx.fillText("Brake", cx + 4, size.h - 4);
    ctx.fillText("← Left", 4, cy - 4);
    ctx.textAlign = "right";
    ctx.fillText("Right →", size.w - 4, cy - 4);
    ctx.textAlign = "left";

    // Comparison cloud.
    if (cmpPoints) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < cmpPoints.length; i += 2) {
        const x = cx + cmpPoints[i] * scale;
        const y = cy - cmpPoints[i + 1] * scale;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Reference cloud.
    if (points) {
      ctx.fillStyle = "rgba(56,189,248,0.55)"; // sky-400
      for (let i = 0; i < points.length; i += 2) {
        const x = cx + points[i] * scale;
        const y = cy - points[i + 1] * scale;
        ctx.fillRect(x, y, 1, 1);
      }
    }

    // Empirical envelope.
    if (envelope && envelope.length) {
      ctx.strokeStyle = "rgba(244,114,182,0.85)"; // pink-400
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false;
      for (let b = 0; b <= envelope.length; b++) {
        const idx = b % envelope.length;
        const r = envelope[idx];
        if (r < 0.1) continue;
        const ang = (idx / envelope.length) * Math.PI * 2;
        const x = cx + Math.cos(ang) * r * scale;
        const y = cy - Math.sin(ang) * r * scale;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
      ctx.stroke();
    }
  }, [points, cmpPoints, envelope, peakLat, peakAccel, peakBrake, size]);

  if (!lat || !lon) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          g-g unavailable
        </div>
        <div className="text-[11px] text-muted-foreground">
          This .ibt has no <span className="font-mono">LatAccel</span> /{" "}
          <span className="font-mono">LongAccel</span> channels.
        </div>
      </div>
    );
  }

  const combined = Math.hypot(peakLat, Math.max(peakAccel, peakBrake));

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Friction circle{refLap != null ? ` · L${refLap}` : " · all laps"}</span>
        <span className="flex items-center gap-3">
          <span><span className="text-foreground">{peakLat.toFixed(2)}g</span> lat</span>
          <span><span className="text-foreground">{peakAccel.toFixed(2)}g</span> accel</span>
          <span><span className="text-foreground">{peakBrake.toFixed(2)}g</span> brake</span>
          <span><span className="text-foreground">{combined.toFixed(2)}g</span> combined</span>
        </span>
      </div>
      <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center">
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>
      <div className="hairline-t flex items-center gap-3 px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-sky-400" /> Ref</span>
        {cmpLap != null && (
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-white/40" /> Cmp L{cmpLap}</span>
        )}
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-pink-400" /> Grip envelope</span>
      </div>
    </div>
  );
}