import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const fetchPbSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { track: string; car: string; excludeSessionId?: string }) => data,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("telemetry_sessions")
      .select("id,name,recorded_at,best_lap_s,setup_yaml")
      .eq("track", data.track)
      .eq("car", data.car)
      .not("best_lap_s", "is", null)
      .not("setup_yaml", "is", null)
      .order("best_lap_s", { ascending: true })
      .limit(10);
    if (error) return { error: error.message } as const;
    const candidates = (rows ?? []).filter(
      (r) => r.id !== data.excludeSessionId && r.setup_yaml,
    );
    if (candidates.length === 0) return { pb: null } as const;
    const pb = candidates[0];
    return {
      pb: {
        sessionId: pb.id,
        name: pb.name,
        recordedAt: pb.recorded_at,
        bestLapS: pb.best_lap_s ? +Number(pb.best_lap_s).toFixed(3) : null,
        setupYaml: pb.setup_yaml as string,
      },
    } as const;
  });