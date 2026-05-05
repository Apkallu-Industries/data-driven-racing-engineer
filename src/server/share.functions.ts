import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function makeToken(): string {
  // 18 random bytes -> 24 url-safe base64 chars
  const arr = new Uint8Array(18);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Owner-only: create a share token for a session + ref/cmp lap. */
export const createShareLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        refLap: z.number().int().nullable().optional(),
        cmpLap: z.number().int().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Verify ownership through RLS-respecting client.
    const { data: sess, error: sErr } = await supabase
      .from("telemetry_sessions")
      .select("id")
      .eq("id", data.sessionId)
      .single();
    if (sErr || !sess) throw new Error("Session not found");

    const token = makeToken();
    const { error } = await supabase.from("shared_laps").insert({
      token,
      session_id: data.sessionId,
      user_id: userId,
      ref_lap: data.refLap ?? null,
      cmp_lap: data.cmpLap ?? null,
    });
    if (error) throw new Error(error.message);
    return { token };
  });

/** Public: resolve a share token to session metadata + signed file URL. */
export const getSharedLap = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) =>
    z.object({ token: z.string().min(8).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    // Use service role: there is no anon SELECT policy on shared_laps,
    // and we want a single trusted read path that increments view_count.
    const { data: share, error: shareErr } = await supabaseAdmin
      .from("shared_laps")
      .select("id, session_id, ref_lap, cmp_lap, view_count")
      .eq("token", data.token)
      .maybeSingle();
    if (shareErr) throw new Error(shareErr.message);
    if (!share) throw new Error("Share link not found");

    const { data: sess, error: sErr } = await supabaseAdmin
      .from("telemetry_sessions")
      .select("id, name, track, car, recorded_at, lap_count, best_lap_s, storage_path")
      .eq("id", share.session_id)
      .single();
    if (sErr || !sess) throw new Error("Session not found");

    const { data: signed, error: urlErr } = await supabaseAdmin.storage
      .from("telemetry")
      .createSignedUrl(sess.storage_path, 60 * 60); // 1 hour
    if (urlErr || !signed) throw new Error("Could not sign file URL");

    // Fire-and-forget view counter; ignore errors.
    supabaseAdmin
      .from("shared_laps")
      .update({ view_count: share.view_count + 1 })
      .eq("id", share.id)
      .then(() => void 0);

    return {
      refLap: share.ref_lap,
      cmpLap: share.cmp_lap,
      session: {
        id: sess.id,
        name: sess.name,
        track: sess.track,
        car: sess.car,
        recordedAt: sess.recorded_at,
        lapCount: sess.lap_count,
        bestLapS: sess.best_lap_s,
      },
      signedUrl: signed.signedUrl,
    };
  });