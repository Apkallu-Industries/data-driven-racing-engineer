
# iRacing .ibt Telemetry Workbench (MoTeC i2 Style)

A full telemetry analysis app modeled on the MoTeC i2 Pro workspace: dark technical UI, stacked time-series traces, reconstructed track map, lap-by-lap overlay, and a searchable channel browser exposing every variable in the .ibt file.

## Visual Direction — MoTeC HD Workspace

- Dark charcoal background (`#1a1d21`), panel surfaces `#22262b`, hairline borders `#2f343a`
- Monospace numerics (JetBrains Mono), compact sans UI (Inter)
- Channel-coded trace colors: Speed cyan, Throttle green, Brake red, RPM yellow, Steering magenta, Gear white
- Dense, information-first layout — no rounded card padding, tight 1px borders, gridded charts with minor/major ticks
- A vertical "time cursor" line that spans every stacked chart and the track map simultaneously

## App Structure

```text
/                     Landing + drag-drop upload (signed-out: marketing; signed-in: redirect to /sessions)
/auth                 Email + password (Lovable Cloud)
/sessions             Library of uploaded .ibt sessions (cards: track, car, date, duration, laps)
/sessions/$id         The MoTeC workbench (the main view)
```

## The Workbench (`/sessions/$id`)

Four-pane layout:

```text
┌───────────────────────────────────────────────────────────────┐
│  Header: Track · Car · Session date · Lap selector · Compare  │
├──────────────┬────────────────────────────────────────────────┤
│              │  Stacked Trace Charts (the core view)          │
│  Channel     │   ── Speed ───────────────────────────────     │
│  Browser     │   ── Throttle / Brake ────────────────────     │
│  (left rail) │   ── RPM / Gear ──────────────────────────     │
│              │   ── Steering ────────────────────────────     │
│  search +    │   ── G-Force (Lat/Long) ──────────────────     │
│  tree of     │   shared time cursor across all panes          │
│  ~250 chans  ├────────────────────────────────────────────────┤
│              │  Track map  │  Live values readout (gauges)    │
│              │  (X/Y from  │  Speed 187 mph · Thr 84% · ...   │
│              │  position)  │  shows values at cursor frame    │
├──────────────┴─────────────┴──────────────────────────────────┤
│  Timeline scrubber: full session, lap markers, play/pause     │
└───────────────────────────────────────────────────────────────┘
```

### Channel Browser (left rail)
- Search box, grouped tree (Driver Inputs, Vehicle, Engine, Tires, Suspension, Session, Environment)
- Each row: name, unit, current-value-at-cursor, min/max/avg for current lap
- Click to add/remove from the stacked trace area; drag to reorder

### Stacked Traces (center)
- Each channel gets its own horizontal strip with its own Y-axis
- X-axis = time (or distance, toggleable)
- Synchronized time cursor — moving it on any chart moves all of them and updates the track map dot and live readouts
- Hover tooltip shows exact value + timestamp + lap

### Track Map (bottom-left)
- Reconstructed by integrating VelocityX/Y or using Lat/Lon if present
- Animated dot showing car position at cursor
- Color the racing line by selected channel (e.g. throttle = green→red gradient) — toggle in toolbar

### Lap Comparison
- Pick "Reference Lap" + "Compare Lap" from the lap dropdown
- Each trace shows two overlaid lines (solid + dashed)
- Track map shows two dots and two colored lines
- Delta-time strip added at top: cumulative time gap vs reference

### Timeline + Playback
- Full-session scrubber across the bottom with lap-boundary tick marks
- Play / pause / 0.25× / 1× / 2× / 4× speed
- All visualizations animate in lockstep driven by current frame index

## .ibt Parsing

Pure TypeScript parser running in the browser (Web Worker so the UI stays responsive on 50 MB+ files):

1. Read header (112 bytes) — `ver`, `tickRate`, `numVars`, `varHeaderOffset`, `bufLen`, `sessionInfoLen/Offset`, `varBuf[0].bufOffset`
2. Read `numVars` × 144-byte var headers → `{name, type, offset, count, unit}`
3. Parse session-info YAML to get track name, car, driver, weather, lap times
4. Stream tick records, decoding each field per its type (bool/int/float/double)
5. Index data by lap using the `Lap` channel for fast lap selection
6. Return: metadata + per-channel `Float32Array` (one value per tick) + lap boundaries

Type codes handled: `1=bool`, `2=int32`, `3=bitfield`, `4=float`, `5=double`, plus arrays via `count`.

## Account & Storage (Lovable Cloud)

- Email + password + Google sign-in
- `sessions` table: `id, user_id, track, car, recorded_at, duration_s, lap_count, tick_rate, file_size, storage_path`
- `.ibt` file uploaded to Cloud Storage bucket (`telemetry`), private with RLS — only owner can read
- On open: download the file blob, parse in worker, cache parsed result in IndexedDB so reopening is instant

## Tech

- TanStack Start + React 19, Tailwind v4, shadcn primitives where useful
- **uPlot** for the stacked traces (handles 100k+ points at 60fps, MoTeC-grade rendering)
- Custom SVG track map and gauges (small, controllable)
- Web Worker for parsing; transferable `ArrayBuffer` to keep memory tight
- Zustand for cursor position / selected channels / lap selection (shared across panes)

## Scope for v1

Included: parser, all 5 chosen features (channel browser, track map, lap compare, multi-channel charts, timeline playback), upload + account, full MoTeC dark aesthetic.

Not in v1 (easy follow-ups): math channels, distance-based X-axis (toggle stub only), session sharing links, CSV export, multi-file/multi-driver overlay.
