import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Activity, CheckCircle2, Circle, LogOut, Mail, Chrome, Apple, KeyRound } from "lucide-react";
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
  const { user, session, loading, signOut } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

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

  // Derive provider info from the Supabase user object
  const provider = (user?.app_metadata?.provider as string | undefined) ?? "email";
  const allProviders = (user?.app_metadata?.providers as string[] | undefined) ?? [provider];
  const identities = user?.identities ?? [];
  const lastSignInAt = user?.last_sign_in_at;

  const providerLabel = (p: string) =>
    p === "google" ? "Google" : p === "apple" ? "Apple" : p === "email" ? "Email + password" : p;
  const providerIcon = (p: string) => {
    if (p === "google") return Chrome;
    if (p === "apple") return Apple;
    if (p === "email") return Mail;
    return KeyRound;
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

        {/* Auth status panel */}
        <div className="hairline mb-4 rounded-sm bg-panel p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Status
            </span>
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider ${
                loading
                  ? "text-muted-foreground"
                  : user
                    ? "text-primary"
                    : "text-muted-foreground"
              }`}
            >
              {loading ? (
                <>
                  <Circle className="h-3 w-3 animate-pulse" />
                  Checking…
                </>
              ) : user ? (
                <>
                  <CheckCircle2 className="h-3 w-3" />
                  Signed in
                </>
              ) : (
                <>
                  <Circle className="h-3 w-3" />
                  Signed out
                </>
              )}
            </span>
          </div>

          {user ? (
            <div className="mt-3 space-y-2 text-xs">
              <Row label="Account" value={user.email ?? user.id} />
              <Row
                label="Provider"
                value={
                  <span className="flex flex-wrap items-center gap-1.5">
                    {allProviders.map((p) => {
                      const Icon = providerIcon(p);
                      return (
                        <span
                          key={p}
                          className="inline-flex items-center gap-1 rounded-sm border border-border bg-rail px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider"
                        >
                          <Icon className="h-3 w-3" />
                          {providerLabel(p)}
                        </span>
                      );
                    })}
                  </span>
                }
              />
              {identities.length > 1 && (
                <Row
                  label="Linked"
                  value={`${identities.length} identities`}
                />
              )}
              {lastSignInAt && (
                <Row
                  label="Last sign-in"
                  value={new Date(lastSignInAt).toLocaleString()}
                />
              )}
              {session?.expires_at && (
                <Row
                  label="Session ends"
                  value={new Date(session.expires_at * 1000).toLocaleString()}
                />
              )}
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={() => navigate({ to: "/sessions" })}
                  className="flex-1 rounded-sm bg-primary py-1.5 text-[11px] font-medium text-primary-foreground hover:opacity-90"
                >
                  Open workbench →
                </button>
                <button
                  onClick={async () => {
                    await signOut();
                    toast.success("Signed out");
                  }}
                  className="flex items-center gap-1 rounded-sm border border-border-strong px-2 py-1.5 text-[11px] hover:bg-accent"
                >
                  <LogOut className="h-3 w-3" />
                  Sign out
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              You're not signed in. Use the form below to access your telemetry library.
            </p>
          )}
        </div>

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

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-right text-foreground">{value}</span>
    </div>
  );
}