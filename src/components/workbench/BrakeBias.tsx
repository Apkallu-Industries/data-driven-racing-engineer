import { useEffect, useMemo, useRef, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

/**
 * Brake performance & bias inference.
 * All values measured from real samples — no synthetic curves.
 *
 * - Response curve: median |LongAccel| (deceleration in g) per Brake-pedal bin.
 *   Slope (g per 100% pedal) is the empirical effectiveness coefficient.
 * - Linearity: R² of a least-squares fit through the binned medians.
 *   Low R² often means lockup, ABS modulation, or bias misalignment.
 * - Threshold peak: max decel achieved at >= 90% pedal (reference for capability).
 * - dcBrakeBias: if iRacing exports the in-car bias channel, show min/max/avg.
 */
const G = 9.80665;
const BINS = 10; // 10% buckets

export function BrakeBias({ parsed }: { parsed: IbtParsed }) {
  const { refLap } = useWorkbench();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 320, h: 220 });

  const brake = parsed.channels["Brake"]?.data;
  const lon = parsed.channels["LongAccel"]?.data;
  const biasCh = parsed.channels["dcBrakeBias"]?.data;

  const result = useMemo(() => {
    if (!brake || !lon) return null;
    let r0 = 0;
    let r1 = brake.length;
    if (refLap != null) {
      const l = parsed.laps.find((x) => x.lap === refLap);
      if (l) { r0 = l.startTick; r1 = l.endTick; }
    }
    const buckets: number[][] = Array.from({ length: BINS }, () => []);
    let peak = 0;
    let nBraking = 0;
    for (let t = r0; t < r1; t++) {
      const b = brake[t];
      if (b < 0.05) continue;
      const decelG = -lon[t] / G; // braking → positive
      if (!isFinite(decelG) || decelG < 0) continue;
      nBraking++;
      const bi = Math.min(BINS - 1, Math.floor(b * BINS));
      buckets[bi].push(decelG);
      if (b >= 0.9 && decelG > peak) peak = decelG;
    }
    const medians: (number | null)[] = buckets.map((arr) => {
      if (arr.length < 4) return null;
      const s = arr.slice().sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    });
    // Linear fit y = m*x + c through bin midpoints (x = (i+0.5)/BINS).
    const pts: { x: number; y: number }[] = [];
    medians.forEach((m, i) => { if (m != null) pts.push({ x: (i + 0.5) / BINS, y: m }); });
    let slope = 0; let intercept = 0; let r2 = 0;
    if (pts.length >= 3) {
      const n = pts.length;
      const sx = pts.reduce((a, p) => a + p.x, 0);
      const sy = pts.reduce((a, p) => a + p.y, 0);
      const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
      const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
      slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      intercept = (sy - slope * sx) / n;
      const ymean = sy / n;
      let ssr = 0; let sst = 0;
      for (const p of pts) {
        const yhat = slope * p.x + intercept;
        ssr += (p.y - yhat) ** 2;
        sst += (p.y - ymean) ** 2;
      }
      r2 = sst > 0 ? Math.max(0, 1 - ssr / sst) : 0;
    }
    let bias: { min: number; max: number; avg: number; cur: number } | null = null;
    if (biasCh) {
      let mn = Infinity, mx = -Infinity, sm = 0, c = 0;
      for (let t = r0; t < r1; t++) {
        const v = biasCh[t];
        if (!isFinite(v)) continue;
        if (v < mn) mn = v; if (v > mx) mx = v; sm += v; c++;
      }
      if (c > 0) bias = { min: mn, max: mx, avg: sm / c, cur: biasCh[Math.min(biasCh.length - 1, r0)] };
    }
    return { medians, counts: buckets.map((b) => b.length), peak, nBraking, slope, intercept, r2, bias };
  }, [brake, lon, biasCh, parsed.laps, refLap]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setSize({ w: Math.max(220, r.width), h: Math.max(160, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !result) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr; c.height = size.h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const padL = 36, padR = 12, padT = 10, padB = 22;
    const W = size.w - padL - padR, H = size.h - padT - padB;
    const yMax = Math.max(1.5, Math.ceil((result.peak || 1) + 0.25));
    // grid
    ctx.strokeStyle = "rgba(120,130,140,0.18)";
    ctx.fillStyle = "rgba(160,170,180,0.55)";
    ctx.font = "10px JetBrains Mono, monospace";
    for (let g = 0; g <= yMax; g += 0.5) {
      const y = padT + H - (g / yMax) * H;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      ctx.fillText(`${g.toFixed(1)}g`, 4, y + 3);
    }
    for (let i = 0; i <= BINS; i++) {
      const x = padL + (i / BINS) * W;
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
    }
    ctx.fillText("0%", padL, size.h - 6);
    ctx.fillText("100%", padL + W - 26, size.h - 6);
    // bars (median per bin)
    result.medians.forEach((m, i) => {
      if (m == null) return;
      const bw = W / BINS;
      const x = padL + i * bw + 2;
      const h = (m / yMax) * H;
      ctx.fillStyle = "rgba(56,189,248,0.7)";
      ctx.fillRect(x, padT + H - h, bw - 4, h);
    });
    // fit line
    if (result.r2 > 0) {
      ctx.strokeStyle = "rgba(244,114,182,0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      const y0 = result.intercept; const y1 = result.slope * 1 + result.intercept;
      ctx.moveTo(padL, padT + H - (Math.max(0, Math.min(yMax, y0)) / yMax) * H);
      ctx.lineTo(padL + W, padT + H - (Math.max(0, Math.min(yMax, y1)) / yMax) * H);
      ctx.stroke();
    }
  }, [result, size]);

  if (!brake || !lon) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Brake analysis unavailable</div>
        <div className="text-[11px] text-muted-foreground">Need <span className="font-mono">Brake</span> + <span className="font-mono">LongAccel</span> channels.</div>
      </div>
    );
  }
  if (!result || result.nBraking < 30) {
    return <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">Not enough braking samples in this lap.</div>;
  }

  const linearityLabel = result.r2 >= 0.9 ? "linear" : result.r2 >= 0.7 ? "fair" : "noisy";

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Brake response{refLap != null ? ` · L${refLap}` : " · all laps"}</span>
        <span className="flex items-center gap-3">
          <span><span className="text-foreground">{result.peak.toFixed(2)}g</span> peak</span>
          <span><span className="text-foreground">{result.slope.toFixed(2)}</span> g/100%</span>
          <span>R²&nbsp;<span className="text-foreground">{result.r2.toFixed(2)}</span> · {linearityLabel}</span>
          {result.bias && (
            <span>Bias&nbsp;<span className="text-foreground">{(result.bias.avg * 100).toFixed(1)}%F</span></span>
          )}
        </span>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1">
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>
      <div className="hairline-t px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">X: brake pedal · Y: deceleration (g, median per 10% bin)</span>
        {result.bias && (
          <span className="ml-3">dcBrakeBias range {(result.bias.min * 100).toFixed(1)}–{(result.bias.max * 100).toFixed(1)}% front</span>
        )}
      </div>
    </div>
  );
}