import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyTheme,
  DARK_THEME,
  loadLocalTheme,
  saveLocalTheme,
  type ThemeMap,
} from "./theme";
import { useAuth } from "./auth";
import { supabase } from "@/integrations/supabase/client";

interface ThemeCtx {
  theme: ThemeMap;
  setToken: (key: string, value: string) => void;
  setTheme: (theme: ThemeMap) => void;
  reset: () => void;
}

const Ctx = createContext<ThemeCtx>({
  theme: DARK_THEME,
  setToken: () => {},
  setTheme: () => {},
  reset: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<ThemeMap>(() => loadLocalTheme() ?? DARK_THEME);
  const hydratedFor = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Apply on every change
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Hydrate from server when user logs in
  useEffect(() => {
    if (!user) {
      hydratedFor.current = null;
      return;
    }
    if (hydratedFor.current === user.id) return;
    hydratedFor.current = user.id;
    supabase
      .from("user_preferences")
      .select("theme")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.theme) {
          setThemeState(data.theme as ThemeMap);
          saveLocalTheme(data.theme as ThemeMap);
        }
      });
  }, [user]);

  const persist = useCallback(
    (next: ThemeMap) => {
      saveLocalTheme(next);
      if (!user) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        supabase
          .from("user_preferences")
          .upsert(
            {
              user_id: user.id,
              theme: next as Record<string, string>,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          )
          .then(() => {});
      }, 500);
    },
    [user],
  );

  const setToken = useCallback(
    (key: string, value: string) => {
      setThemeState((prev) => {
        const next = { ...prev, [key]: value } as ThemeMap;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const setTheme = useCallback(
    (next: ThemeMap) => {
      setThemeState(next);
      persist(next);
    },
    [persist],
  );

  const reset = useCallback(() => {
    setThemeState(DARK_THEME);
    saveLocalTheme(null);
    if (user) {
      supabase
        .from("user_preferences")
        .upsert(
          { user_id: user.id, theme: null, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        )
        .then(() => {});
    }
  }, [user]);

  return (
    <Ctx.Provider value={{ theme, setToken, setTheme, reset }}>{children}</Ctx.Provider>
  );
}

export const useTheme = () => useContext(Ctx);