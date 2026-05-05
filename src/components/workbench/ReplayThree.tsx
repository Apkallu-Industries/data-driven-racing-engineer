import { useMemo, useRef, useState, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { exportCanvasAsPng } from "@/lib/exportView";
import { Download, Eye, EyeOff } from "lucide-react";

/** Build a centered, scaled, elevation-aware track polyline from parsed data. */
function buildTrackGeometry(parsed: IbtParsed) {
  const xy = parsed.trackXY;
  if (!xy) return null;
  const altCh =
    parsed.channels["Alt"] ??
    parsed.channels["Altitude"] ??
    parsed.channels["LapDistAlt"];
  const alt = altCh?.data;

  const cx = (xy.minX + xy.maxX) / 2;
  const cy = (xy.minY + xy.maxY) / 2;
  const span = Math.max(xy.maxX - xy.minX, xy.maxY - xy.minY) || 1;
  const scale = 100 / span; // normalize world to ~100 units across

  // Subsample for the line geometry (one vertex per ~ tick group).
  const n = xy.x.length;
  const step = Math.max(1, Math.floor(n / 4000));
  const positions: number[] = [];
  let altMin = Infinity, altMax = -Infinity;
  if (alt) {
    for (let i = 0; i < n; i += step) {
      const a = alt[i];
      if (isFinite(a)) {
        if (a < altMin) altMin = a;
        if (a > altMax) altMax = a;
      }
    }
  }
  if (!isFinite(altMin)) { altMin = 0; altMax = 1; }
  const altRange = Math.max(0.5, altMax - altMin);
  const altScale = 12 / altRange; // exaggerate elevation for readability

  for (let i = 0; i < n; i += step) {
    const x = (xy.x[i] - cx) * scale;
    const z = -(xy.y[i] - cy) * scale; // map Y world -> -Z so up=N
    const y = alt ? (alt[i] - altMin) * altScale : 0;
    positions.push(x, y, z);
  }
  return { positions: new Float32Array(positions), step, scale, cx, cy, altMin, altScale, hasAlt: !!alt };
}

function carPosition(
  parsed: IbtParsed,
  geom: ReturnType<typeof buildTrackGeometry>,
  tick: number,
): [number, number, number] {
  if (!geom || !parsed.trackXY) return [0, 0, 0];
  const xy = parsed.trackXY;
  const altCh =
    parsed.channels["Alt"] ??
    parsed.channels["Altitude"] ??
    parsed.channels["LapDistAlt"];
  const alt = altCh?.data;
  const i = Math.max(0, Math.min(xy.x.length - 1, tick));
  const x = (xy.x[i] - geom.cx) * geom.scale;
  const z = -(xy.y[i] - geom.cy) * geom.scale;
  const y = alt ? (alt[i] - geom.altMin) * geom.altScale : 0;
  return [x, y, z];
}

function CarMarker({ position, color }: { position: [number, number, number]; color: string }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) ref.current.position.set(position[0], position[1] + 0.6, position[2]);
  });
  return (
    <mesh ref={ref}>
      <coneGeometry args={[0.7, 1.6, 16]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
    </mesh>
  );
}

function TrackLine({ positions, color }: { positions: Float32Array; color: string }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return g;
  }, [positions]);
  const material = useMemo(
    () => new THREE.LineBasicMaterial({ color }),
    [color],
  );
  const lineObj = useMemo(() => new THREE.Line(geom, material), [geom, material]);
  return <primitive object={lineObj} />;
}

/** Find tick within the chosen lap's range matching cursor offset. */
function lapTickAt(parsed: IbtParsed, lapNum: number | null, cursorTick: number): number {
  if (lapNum == null) return cursorTick;
  const lap = parsed.laps.find((l) => l.lap === lapNum);
  if (!lap) return cursorTick;
  // Map cursor's session position into this lap by % of lap distance.
  const pct = parsed.channels["LapDistPct"]?.data;
  if (!pct) return Math.min(lap.endTick, lap.startTick + (cursorTick - parsed.laps[0].startTick));
  const cursorPct = pct[Math.min(pct.length - 1, Math.max(0, cursorTick))];
  // Find tick in lap range whose pct is closest to cursorPct.
  let bestT = lap.startTick;
  let bestD = Infinity;
  for (let t = lap.startTick; t <= lap.endTick; t += 4) {
    const d = Math.abs(pct[t] - cursorPct);
    if (d < bestD) { bestD = d; bestT = t; }
  }
  return bestT;
}

export function ReplayThree({ parsed }: { parsed: IbtParsed }) {
  const { cursorTick, refLap, cmpLap, setCursorTick, parsed: pp } = useWorkbench();
  const [showGhost, setShowGhost] = useState(true);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const geom = useMemo(() => buildTrackGeometry(parsed), [parsed]);

  if (!geom) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No position data available
      </div>
    );
  }

  const refTick = lapTickAt(parsed, refLap, cursorTick);
  const cmpTick = showGhost && cmpLap != null ? lapTickAt(parsed, cmpLap, cursorTick) : null;
  const refPos = carPosition(parsed, geom, refTick);
  const cmpPos = cmpTick != null ? carPosition(parsed, geom, cmpTick) : null;

  // Slider scrubs cursor through the chosen reference lap (or full session if none).
  const refLapObj = refLap != null ? parsed.laps.find((l) => l.lap === refLap) : null;
  const sliderMin = refLapObj ? refLapObj.startTick : 0;
  const sliderMax = refLapObj ? refLapObj.endTick : (pp ? pp.tickCount - 1 : 0);
  const sliderVal = Math.max(sliderMin, Math.min(sliderMax, cursorTick));

  const handleExport = () => {
    const canvas = containerRef.current?.querySelector("canvas");
    if (canvas) exportCanvasAsPng(canvas as HTMLCanvasElement, "replay-3d.png");
  };

  return (
    <div className="flex h-full flex-col">
      <div className="hairline-b flex items-center justify-between gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>3D Replay {geom.hasAlt ? "· elevation" : "· flat (no alt channel)"}</span>
        <div className="flex items-center gap-2">
          {cmpLap != null && (
            <button
              onClick={() => setShowGhost((g) => !g)}
              className={`flex h-5 items-center gap-1 rounded-sm border border-border px-1.5 text-[10px] uppercase ${
                showGhost ? "bg-primary text-primary-foreground" : "bg-rail text-muted-foreground hover:text-foreground"
              }`}
              title="Toggle ghost (compare lap)"
            >
              {showGhost ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />} Ghost
            </button>
          )}
          <button
            onClick={handleExport}
            className="flex h-5 items-center gap-1 rounded-sm border border-border bg-rail px-1.5 text-[10px] uppercase text-muted-foreground hover:text-foreground"
            title="Export PNG"
          >
            <Download className="h-3 w-3" /> PNG
          </button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1">
        <Canvas camera={{ position: [70, 50, 70], fov: 45 }} dpr={[1, 1.5]} gl={{ preserveDrawingBuffer: true }}>
          <Suspense fallback={null}>
            <color attach="background" args={["#16191d"]} />
            <fog attach="fog" args={["#16191d", 120, 260]} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[40, 80, 30]} intensity={0.8} />
            <gridHelper args={[200, 40, "#2a2f36", "#22262b"]} position={[0, -0.01, 0]} />
            <TrackLine positions={geom.positions} color="#7dd3fc" />
            <CarMarker position={refPos} color="#22d3ee" />
            {cmpPos && <CarMarker position={cmpPos} color="#f59e0b" />}
            <OrbitControls enableDamping makeDefault />
          </Suspense>
        </Canvas>
      </div>
      <div className="hairline-t flex items-center gap-2 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <span className="w-12">Scrub</span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax}
          value={sliderVal}
          onChange={(e) => setCursorTick(parseInt(e.target.value, 10))}
          className="flex-1 accent-primary"
        />
        <span className="w-24 text-right tabular-nums">
          {refLapObj ? `${(((sliderVal - sliderMin) / Math.max(1, sliderMax - sliderMin)) * 100).toFixed(0)}%` : `t=${sliderVal}`}
        </span>
      </div>
    </div>
  );
}