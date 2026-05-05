import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function fmtLap(s: number | null | undefined): string {
  if (s == null) return "—";
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(3).padStart(6, "0");
  return `${m}:${r}`;
}

export const Route = createFileRoute("/api/public/og/share/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { data: share } = await supabaseAdmin
          .from("shared_laps")
          .select("session_id, ref_lap, cmp_lap, revoked_at, expires_at")
          .eq("token", params.token)
          .maybeSingle();

        let track = "Shared Lap";
        let car = "ApexTrace telemetry";
        let refLap: number | null = null;
        let cmpLap: number | null = null;
        let bestLapS: number | null = null;
        let badge = "SHARED LAP";

        if (share) {
          if (share.revoked_at) badge = "REVOKED";
          else if (share.expires_at && new Date(share.expires_at) < new Date())
            badge = "EXPIRED";
          refLap = share.ref_lap;
          cmpLap = share.cmp_lap;
          const { data: sess } = await supabaseAdmin
            .from("telemetry_sessions")
            .select("track, car, best_lap_s")
            .eq("id", share.session_id)
            .single();
          if (sess) {
            track = sess.track ?? track;
            car = sess.car ?? car;
            bestLapS = sess.best_lap_s != null ? Number(sess.best_lap_s) : null;
          }
        }

        const w = 1200;
        const h = 630;
        const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b0d10"/>
      <stop offset="100%" stop-color="#15191f"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#ff5b1f"/>
      <stop offset="100%" stop-color="#ffb347"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${w}" height="6" fill="url(#accent)"/>
  <g font-family="ui-monospace,SFMono-Regular,Menlo,monospace" fill="#e6e8eb">
    <text x="64" y="120" font-size="22" letter-spacing="6" fill="#9aa3ad">APEXTRACE · ${esc(badge)}</text>
    <text x="64" y="220" font-size="78" font-weight="700">${esc(track)}</text>
    <text x="64" y="270" font-size="30" fill="#9aa3ad">${esc(car)}</text>
    <g transform="translate(64,360)">
      <text x="0" y="0" font-size="22" letter-spacing="4" fill="#9aa3ad">REF LAP</text>
      <text x="0" y="60" font-size="64" font-weight="700">L${refLap ?? "—"}</text>
      <text x="0" y="100" font-size="26" fill="#ff8a4c">${fmtLap(bestLapS)}</text>
    </g>
    ${
      cmpLap != null
        ? `<g transform="translate(420,360)">
      <text x="0" y="0" font-size="22" letter-spacing="4" fill="#9aa3ad">VS</text>
      <text x="0" y="60" font-size="64" font-weight="700">L${cmpLap}</text>
      <text x="0" y="100" font-size="26" fill="#9aa3ad">ghost compare</text>
    </g>`
        : ""
    }
    <text x="64" y="${h - 48}" font-size="20" fill="#6b7280">apextrace · iRacing telemetry workbench</text>
  </g>
</svg>`;

        return new Response(svg, {
          status: 200,
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=300, s-maxage=300",
          },
        });
      },
    },
  },
});