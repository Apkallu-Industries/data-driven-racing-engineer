import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyTheme = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("user_preferences")
      .select("theme")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return { theme: null, error: error.message } as const;
    return { theme: (data?.theme ?? null) as Record<string, string> | null } as const;
  });

export const saveMyTheme = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { theme: Record<string, string> | null }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("user_preferences")
      .upsert(
        { user_id: userId, theme: data.theme, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    if (error) return { ok: false, error: error.message } as const;
    return { ok: true } as const;
  });