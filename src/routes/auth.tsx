import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — ApexTrace" },
      { name: "description", content: "Sign in to your ApexTrace telemetry workbench." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/sessions" });
  }, [user, loading, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: `${window.location.origin}/sessions` },
        });
        if (error) throw error;
        toast.success("Account created. You're signed in.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-sm">
        <Link to="/" className="mb-8 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" />
          </div>
          <span className="font-mono text-sm tracking-wider">APEXTRACE</span>
        </Link>

        <div className="hairline rounded-sm bg-panel p-6">
          <h1 className="text-xl font-semibold">{mode === "signin" ? "Sign in" : "Create account"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {mode === "signin" ? "Open your telemetry library." : "Start uploading .ibt files."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Email</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-sm border border-border bg-rail px-3 py-2 text-sm outline-none focus:border-primary"
                autoComplete="email"
              />
            </label>
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Password</span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-sm border border-border bg-rail px-3 py-2 text-sm outline-none focus:border-primary"
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 w-full rounded-sm bg-primary py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-4 w-full text-center text-xs text-muted-foreground hover:text-foreground"
          >
            {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}