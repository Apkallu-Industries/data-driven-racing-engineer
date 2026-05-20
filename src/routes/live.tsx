import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppHeader } from "@/components/AppHeader";
import { useAuth } from "@/lib/auth";
import { useLiveBridge } from "@/lib/liveBridge";
import { DEFAULT_CHANNELS, colorForChannel } from "@/lib/store";
import { catalogEntry } from "@/lib/ibt/channelCatalog";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Live Bridge — ApexTrace" },
      {
        name: "description",
        content:
          "Stream live iRacing telemetry into ApexTrace from the local bridge.",
      },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const {
    url,
    setUrl,
    status,
    error,
    values,
    channelNames,
    sessionTime,
    lap,
    hz,
    connect,
    disconnect,
    rawLog,
    clearRawLog,
  } = useLiveBridge();
  const [draftUrl, setDraftUrl] = useState(url);
  const [filter, setFilter] = useState("");
  const [showRaw, setShowRaw] = useState(true);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  // Auto-connect once on mount if we have a URL and we're idle.
  useEffect(() => {
    if (status === "disconnected") connect(url);
    return () => {
      // keep connection alive when navigating away? disconnect on unmount for now
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return channelNames.filter((n) => !f || n.toLowerCase().includes(f));
  }, [channelNames, filter]);

  const featured = useMemo(
    () => DEFAULT_CHANNELS.filter((n) => n in values),
    [values],
  );

  const groupOf = (name: string) => catalogEntry(name)?.group ?? "Other";

  // Detect the https-page → ws:// mixed-content block. The bridge itself
  // is fine, but browsers refuse to open an insecure WebSocket from a
  // secure (HTTPS) origin and the connection dies immediately.
  const isMixedContentBlocked =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    url.startsWith("ws://");

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader>
        <span className="font-mono uppercase tracking-wider">Live Bridge</span>
        <span className="text-muted-foreground">·</span>
        <span
          className={
            status === "connected"
              ? "font-mono text-emerald-400"
              : status === "connecting"
                ? "font-mono text-amber-400"
                : status === "error"
                  ? "font-mono text-destructive"
                  : "font-mono text-muted-foreground"
          }
        >
          ● {status}
        </span>
        {status === "connected" && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="font-mono tabular-nums">{hz} Hz</span>
            {sessionTime != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono tabular-nums">
                  t = {sessionTime.toFixed(2)}s
                </span>
              </>
            )}
            {lap != null && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono">lap {lap}</span>
              </>
            )}
          </>
        )}
        <span className="text-muted-foreground">·</span>
        <Link
          to="/live/workbench"
          className="rounded-sm border border-border bg-primary px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-primary-foreground hover:opacity-90"
        >
          Open Workbench (Live) →
        </Link>
      </AppHeader>

      {isMixedContentBlocked && (
        <div className="bg-amber-500/15 px-3 py-2 font-mono text-[11px] leading-relaxed text-amber-200">
          <strong className="mr-1 font-semibold">Browser blocks ws:// from this hosted page.</strong>
          The bridge is healthy, but secure pages can't open insecure WebSockets.
          Run ApexTrace on the same PC as the bridge:
          <code className="ml-1 rounded-sm bg-black/30 px-1.5 py-0.5">git clone … && npm install && npm run dev</code>
          then open <code className="rounded-sm bg-black/30 px-1.5 py-0.5">http://localhost:5173/live</code> — that's an http origin and is allowed to talk to <code className="rounded-sm bg-black/30 px-1.5 py-0.5">ws://localhost:3001</code>.
        </div>
      )}

      <div className="hairline-b flex items-center gap-2 bg-panel px-3 py-2">
        <input
          className="w-72 rounded-sm border border-border bg-rail px-2 py-1 font-mono text-xs"
          value={draftUrl}
          onChange={(e) => setDraftUrl(e.target.value)}
          placeholder="ws://localhost:3001"
        />
        <button
          onClick={() => {
            setUrl(draftUrl);
            connect(draftUrl);
          }}
          className="rounded-sm border border-border bg-primary px-3 py-1 font-mono text-xs uppercase tracking-wider text-primary-foreground hover:opacity-90"
        >
          Connect
        </button>
        <button
          onClick={() => disconnect()}
          className="rounded-sm border border-border bg-rail px-3 py-1 font-mono text-xs uppercase tracking-wider hover:bg-accent"
        >
          Disconnect
        </button>
        <div className="ml-4 flex-1 text-xs text-muted-foreground">
          Start the bridge locally (<code className="font-mono">npm start</code>{" "}
          in the iracing-bridge folder) then connect. Channel names match the
          ones used in uploaded .ibt files.
        </div>
        <input
          className="w-56 rounded-sm border border-border bg-rail px-2 py-1 font-mono text-xs"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter channels…"
        />
      </div>

      {error && (
        <div className="bg-destructive/15 px-3 py-1.5 font-mono text-[11px] text-destructive">
          {error}
        </div>
      )}

      {showRaw && (
        <div className="hairline-b max-h-56 overflow-auto bg-black/40 p-2 font-mono text-[10px] leading-relaxed text-emerald-300">
          <div className="mb-1 flex items-center justify-between text-muted-foreground">
            <span>RAW FRAMES (newest first · {rawLog.length})</span>
            <span className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(rawLog.slice(0, 5).join("\n\n"));
                }}
                className="rounded-sm border border-border px-2 py-0.5 hover:bg-accent"
              >
                Copy first 5
              </button>
              <button
                onClick={clearRawLog}
                className="rounded-sm border border-border px-2 py-0.5 hover:bg-accent"
              >
                Clear
              </button>
              <button
                onClick={() => setShowRaw(false)}
                className="rounded-sm border border-border px-2 py-0.5 hover:bg-accent"
              >
                Hide
              </button>
            </span>
          </div>
          {rawLog.length === 0 ? (
            <div className="text-muted-foreground">No messages received yet.</div>
          ) : (
            rawLog.map((m, i) => (
              <div key={i} className="border-t border-white/5 py-0.5">
                {m.length > 800 ? m.slice(0, 800) + " …(truncated)" : m}
              </div>
            ))
          )}
        </div>
      )}
      {!showRaw && (
        <button
          onClick={() => setShowRaw(true)}
          className="hairline-b bg-panel px-3 py-1 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Show raw frames ▾
        </button>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Featured tiles */}
        <div className="hairline-r w-2/5 overflow-auto bg-background p-3">
          <div className="mb-2 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Live Readout
          </div>
          {featured.length === 0 ? (
            <div className="rounded-sm border border-border bg-panel p-6 text-center text-xs text-muted-foreground">
              Waiting for telemetry frames…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {featured.map((name) => {
                const v = values[name];
                return (
                  <div
                    key={name}
                    className="rounded-sm border border-border bg-panel p-3"
                  >
                    <div
                      className="font-mono text-[10px] uppercase tracking-wider"
                      style={{ color: colorForChannel(name) }}
                    >
                      {name}
                    </div>
                    <div className="mt-1 font-mono text-2xl tabular-nums">
                      {Number.isFinite(v) ? v.toFixed(2) : "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* All channels */}
        <div className="min-w-0 flex-1 overflow-auto bg-background p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <span>All Channels</span>
            <span className="tabular-nums">{filtered.length} / {channelNames.length}</span>
          </div>
          <div className="overflow-hidden rounded-sm border border-border">
            <table className="w-full font-mono text-xs">
              <thead className="bg-rail text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-2 py-1 text-left">Channel</th>
                  <th className="px-2 py-1 text-left">Group</th>
                  <th className="px-2 py-1 text-right">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((name) => {
                  const v = values[name];
                  return (
                    <tr key={name} className="border-t border-border/50">
                      <td className="px-2 py-1" style={{ color: colorForChannel(name) }}>
                        {name}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        {groupOf(name)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {Number.isFinite(v) ? v.toFixed(3) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}