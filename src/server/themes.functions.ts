import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const listSharedThemes = createServerFn({ method: "GET" }).handler(async () => {
  const { data, error } = await supabaseAdmin
    .from("shared_themes")
    .select("id, user_id, name, description, theme, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { themes: [], error: error.message } as const;
  return { themes: data ?? [] } as const;
});

export const publishTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      name: z.string().min(1).max(60),
      description: z.string().max(280).optional().nullable(),
      theme: z.record(z.string(), z.string()),
    }).parse,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("shared_themes")
      .insert({
        user_id: userId,
        name: data.name,
        description: data.description ?? null,
        theme: data.theme,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message } as const;
    return { ok: true, id: row.id } as const;
  });

export const deleteSharedTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }).parse)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { error } = await supabase.from("shared_themes").delete().eq("id", data.id);
    if (error) return { ok: false, error: error.message } as const;
    return { ok: true } as const;
  });