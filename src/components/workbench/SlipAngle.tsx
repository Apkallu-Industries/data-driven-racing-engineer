import { useEffect, useMemo, useRef, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";

/**
 * Body slip angle (β) estimate from real telemetry.
 * iRacing reports VelocityX (forward) and VelocityY (lateral) in the car frame,
 * so β = atan2(Vy, Vx) is a direct measurement — no model fabrication.
 *
 * We also derive the front-tyre slip indicator: δ - β where δ is the road-wheel
 * angle (steering angle / steering ratio). When the steering ratio isn't known
 * we fall back to plotting raw SteeringWheelAngle vs β so the *shape* still
 * reads as understeer / oversteer.
 *
 * Plot: β (deg) vs LatAccel (g). Real samples only; gated to |speed| > 8 m/s.
 */
const G = 9.80665;

export function SlipAngle({ parsed }: { parsed: IbtParsed }) {
  const { refLap, cmpLap } = useWorkbench();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 360, h: 280 });

  const vx = parsed.channels["VelocityX"]?.data;
  const vy = parsed.channels["VelocityY"]?.data;
  const lat = parsed.channels["LatAccel"]?.data;
  const steer = parsed.channels["SteeringWheelAngle"]?.data;
  const speedCh = parsed.channels["Speed"]?.data;

  const result = useMemo(() => {
    if (!vx || !vy || !lat) return null;

    function buildRange(a: number, b: number) {
      const len = b - a;
      const beta = new Float32Array(len);
      const ay = new Float32Array(len);
      const steerArr = steer ? new Float32Array(len) : null;
      let n = 0;
      let peakBeta = 0;
      for (let i = 0; i < len; i++) {
        const t = a + i;
        const fwd = vx[t];
        const sd = vy[t];
        const sp = speedCh ? speedCh[t] : Math.hypot(fwd, sd);
        if (sp < 8) continue;
        const b1 = Math.atan2(sd, Math.max(0.1, fwd)) * (180 / Math.PI);
        beta[n] = b1;
        ay[n] = lat[t] / G;
        if (steerArr && steer) steerArr[n] = steer[t] * (180 / Math.PI);
        if (Math.abs(b1) > peakBeta) peakBeta = Math.abs(b1);
        n++;
      }
      return { beta: beta.subarray(0, n), ay: ay.subarray(0, n), steer: steerArr ? steerArr.subarray(0, n) : null, peakBeta, n };
    }

    let r0 = 0, r1 = vx.length;
    if (refLap != null) {
      const l = parsed.laps.find((x) => x.lap === refLap);
      if (l) { r0 = l.startTick; r1 = l.endTick; }
    }
    const ref = buildRange(r0, r1);
    let cmp: ReturnType<typeof buildRange> | null = null;
    if (cmpLap != null) {
      const l = parsed.laps.find((x) => x.lap === cmpLap);
      if (l) cmp = buildRange(l.startTick, l.endTick);
    }

    // Balance signature: average β at high-|ay| (>0.6g) per side.
    let leftSum = 0, leftN = 0, rightSum = 0, rightN = 0;
    for (let i = 0; i < ref.n; i++) {
      const a = ref.ay[i];
      if (a > 0.6) { leftSum += ref.beta[i]; leftN++; }
      else if (a < -0.6) { rightSum += ref.beta[i]; rightN++; }
    }
    const leftBeta = leftN ? leftSum / leftN : 0;
    const rightBeta = rightN ? rightSum / rightN : 0;
    // Convention: in a left turn (ay>0) positive β = oversteer-ish (rear sliding out),
    // negative β = understeer (nose plowing). Mirror for right.
    const balanceLeft = leftN ? leftBeta : null;
    const balanceRight = rightN ? -rightBeta : null;
    const overall =
      balanceLeft != null && balanceRight != null
        ? (balanceLeft + balanceRight) / 2
        : (balanceLeft ?? balanceRight ?? 0);

    return { ref, cmp, balanceLeft, balanceRight, overall };
  }, [vx, vy, lat, steer, speedCh, parsed.laps, refLap, cmpLap]);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0].contentRect;
      setSize({ w: Math.max(240, r.width), h: Math.max(160, r.height) });
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

    const peak = Math.max(2, Math.ceil(Math.max(result.ref.peakBeta, result.cmp?.peakBeta ?? 0) + 0.5));
    const ayMax = 3;
    const xToPx = (ay: number) => padL + ((ay + ayMax) / (2 * ayMax)) * W;
    const yToPx = (beta: number) => padT + H - ((beta + peak) / (2 * peak)) * H;

    // grid
    ctx.strokeStyle = "rgba(120,130,140,0.18)";
    ctx.fillStyle = "rgba(160,170,180,0.55)";
    ctx.font = "10px JetBrains Mono, monospace";
    for (let g = -ayMax; g <= ayMax; g++) {
      const x = xToPx(g);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + H); ctx.stroke();
      if (g !== 0) ctx.fillText(`${g}g`, x - 6, size.h - 6);
    }
    const step = peak <= 4 ? 1 : 2;
    for (let b = -peak; b <= peak; b += step) {
      const y = yToPx(b);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      ctx.fillText(`${b}°`, 4, y + 3);
    }
    // axes
    ctx.strokeStyle = "rgba(120,130,140,0.45)";
    ctx.beginPath();
    ctx.moveTo(xToPx(0), padT); ctx.lineTo(xToPx(0), padT + H);
    ctx.moveTo(padL, yToPx(0)); ctx.lineTo(padL + W, yToPx(0));
    ctx.stroke();

    // cmp cloud
    if (result.cmp) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      for (let i = 0; i < result.cmp.n; i++) {
        ctx.fillRect(xToPx(result.cmp.ay[i]), yToPx(result.cmp.beta[i]), 1, 1);
      }
    }
    // ref cloud
    ctx.fillStyle = "rgba(56,189,248,0.55)";
    for (let i = 0; i < result.ref.n; i++) {
      ctx.fillRect(xToPx(result.ref.ay[i]), yToPx(result.ref.beta[i]), 1, 1);
    }

    // balance markers
    if (result.balanceLeft != null) {
      ctx.fillStyle = "rgba(244,114,182,0.95)";
      const x = xToPx(0.8); const y = yToPx(result.balanceLeft);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    if (result.balanceRight != null) {
      ctx.fillStyle = "rgba(244,114,182,0.95)";
      const x = xToPx(-0.8); const y = yToPx(-result.balanceRight);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
  }, [result, size]);

  if (!vx || !vy || !lat) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-4 text-center">
        <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Slip angle unavailable</div>
        <div className="text-[11px] text-muted-foreground">Need <span className="font-mono">VelocityX</span>, <span className="font-mono">VelocityY</span>, <span className="font-mono">LatAccel</span>.</div>
      </div>
    );
  }
  if (!result || result.ref.n < 30) {
    return <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted-foreground">Not enough cornering samples.</div>;
  }

  const balanceWord =
    Math.abs(result.overall) < 0.5
      ? "neutral"
      : result.overall > 0
        ? "loose (oversteer)"
        : "tight (understeer)";

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Body slip β · atan2(Vy, Vx){refLap != null ? ` · L${refLap}` : ""}</span>
        <span className="flex items-center gap-3">
          <span>Peak <span className="text-foreground">{result.ref.peakBeta.toFixed(1)}°</span></span>
          {result.balanceLeft != null && <span>L: <span className="text-foreground">{result.balanceLeft.toFixed(2)}°</span></span>}
          {result.balanceRight != null && <span>R: <span className="text-foreground">{(-result.balanceRight).toFixed(2)}°</span></span>}
          <span>Balance <span className="text-foreground">{balanceWord}</span></span>
        </span>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1">
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      </div>
      <div className="hairline-t px-3 py-1 font-mono text-[10px] text-muted-foreground">
        <span className="uppercase tracking-wider">X: LatAccel · Y: body slip β · pink dot = mean β at &gt;0.6g</span>
      </div>
    </div>
  );
}