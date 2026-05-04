import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const fetchTrackCarHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { track: string; car: string; excludeSessionId?: string }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const q = supabase
      .from("telemetry_sessions")
      .select(
        "id,name,track,car,recorded_at,best_lap_s,lap_count,duration_s,created_at",
      )
      .eq("track", data.track)
      .eq("car", data.car)
      .not("best_lap_s", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(40);
    const { data: rows, error } = await q;
    if (error) return { error: error.message } as const;
    const sessions = (rows ?? []).filter((r) => r.id !== data.excludeSessionId);
    if (sessions.length === 0) {
      return { history: null } as const;
    }
    const bests = sessions
      .map((s) => Number(s.best_lap_s))
      .filter((n) => Number.isFinite(n) && n > 0);
    const bestEverS = bests.length ? Math.min(...bests) : null;
    // Recent = up to 5 most recent (already sorted desc by recorded_at)
    const recent = sessions.slice(0, 5);
    const recentBestS = recent.length
      ? Math.min(...recent.map((s) => Number(s.best_lap_s)).filter(Number.isFinite))
      : null;
    // Trend: compare oldest 5 vs newest 5 best laps
    const sortedAsc = [...sessions].sort(
      (a, b) =>
        new Date(a.recorded_at ?? a.created_at ?? 0).getTime() -
        new Date(b.recorded_at ?? b.created_at ?? 0).getTime(),
    );
    let trend: "improving" | "regressing" | "flat" | null = null;
    if (sortedAsc.length >= 4) {
      const half = Math.floor(sortedAsc.length / 2);
      const earlyBest = Math.min(
        ...sortedAsc.slice(0, half).map((s) => Number(s.best_lap_s)).filter(Number.isFinite),
      );
      const lateBest = Math.min(
        ...sortedAsc.slice(half).map((s) => Number(s.best_lap_s)).filter(Number.isFinite),
      );
      const delta = earlyBest - lateBest;
      if (Math.abs(delta) < 0.05) trend = "flat";
      else trend = delta > 0 ? "improving" : "regressing";
    }
    // Top 5 fastest laps across history
    const fastest = [...sessions]
      .filter((s) => Number.isFinite(Number(s.best_lap_s)))
      .sort((a, b) => Number(a.best_lap_s) - Number(b.best_lap_s))
      .slice(0, 5)
      .map((s) => ({
        sessionName: s.name,
        recordedAt: s.recorded_at,
        lapTimeS: +Number(s.best_lap_s).toFixed(3),
        bestLapS: +Number(s.best_lap_s).toFixed(3),
      }));
    return {
      history: {
        track: data.track,
        car: data.car,
        totalSessions: sessions.length,
        bestEverS: bestEverS != null ? +bestEverS.toFixed(3) : null,
        recentBestS: recentBestS != null ? +recentBestS.toFixed(3) : null,
        laps: fastest,
        trend,
      },
    } as const;
  });