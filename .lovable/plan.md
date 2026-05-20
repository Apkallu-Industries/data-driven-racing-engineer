## Problem

The hosted preview (`https://...lovable.app`) cannot open `ws://localhost:3001` — browsers block insecure WebSockets from HTTPS pages ("mixed content"). That's the only reason `/live` shows `WebSocket error` with zero frames; the bridge itself is healthy.

## Approach

Run the ApexTrace dev server on the same machine as the bridge, so the page is served over `http://localhost` and is allowed to talk to `ws://localhost:3001`. Then wire the live feed into the existing widgets.

## Steps

### 1. Local dev mode docs + UX (no transport change needed)

- Add a short banner on `/live` that detects when the page origin is `https:` AND the bridge URL is `ws://` (not `wss://`). Show: *"Browsers block insecure WebSockets from this hosted page. Run ApexTrace locally (`npm run dev`) and open http://localhost:5173/live, or expose the bridge over wss://."*
- Add a "Copy local-dev instructions" link with the 3 commands.

### 2. Confirm frame shape on first connect

You'll run locally, hit Connect, and the existing **RAW FRAMES** panel will show what `server.js` is broadcasting. The current `normalizeFrame()` already handles the four most common shapes, but if your bridge uses a custom envelope (e.g. `{t,v:[...]}` or binary), I'll tighten it once we see one frame.

### 3. Wire live values into the workbench widgets

Create a `useLiveOrIbtChannel(name)` selector that returns:
- the live value from `useLiveBridge().values[name]` when status === `connected` and no `.ibt` is loaded
- otherwise the existing `parsed.channels[name].data[cursorTick]`

Apply it to the widgets that already read single-sample values:
- `LiveReadout` tiles
- `CinemaPlayback` HUD (Speed / RPM / Throttle / Brake / Gear / Steering)
- `GGDiagram` current dot (LatAccel / LongAccel)
- `BrakeBias` instantaneous bar
- `SlipAngle` indicator
- `TrackMap` car dot (Lat / Lon or LapDistPct)

Trace widgets (`StackedTraces`, `PianoRoll`, `TimeLossWaterfall`) need a history buffer, covered next.

### 4. Rolling buffer for traces (~60 s)

Add to `liveBridge.ts`:
- `history: Record<string, Float32Array>` ring buffer per channel, sized `60 s * 60 Hz = 3600` samples.
- Push every incoming frame; expose `getHistory(name): {data, t0, t1}`.
- `StackedTraces` and `PianoRoll` get a `liveMode` prop that reads from the ring buffer instead of `parsed`.

### 5. "Go Live" entry point

- In `sessions.index`, add a **Go Live** card next to the upload zone that links to `/live`.
- In `/live`, once frames are flowing, add an **Open Workbench (Live)** button that routes to `sessions.$id` with `id="live"` and a flag that swaps the data source to the live bridge.

### 6. Lap detection from live stream

Bridge log shows `LapCompleted`/`Lap` are available. On each Lap increment, snapshot the buffer between the two lap boundaries into an in-memory "lap" so `LapList` and best-lap logic work live. No persistence yet.

## Technical notes

- All changes are client-side; no server functions or migrations.
- `useLiveBridge` already auto-reconnects and tracks `hz`; reuse for status pills.
- The reverse-steering fix and timeline-cursor wiring already applied to `.ibt` stay untouched — live mode bypasses `cursorTick` entirely.
- Persisting live sessions to Supabase is **out of scope** for this pass.

## Out of scope (ask later if needed)

- TLS/wss on the bridge itself
- Cloudflare/ngrok tunnel docs
- Recording a live session to a `.ibt`-equivalent for replay
- AI Coach over live stream (currently expects a parsed file)