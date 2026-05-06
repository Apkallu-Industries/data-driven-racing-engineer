import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { AppHeader } from "@/components/AppHeader";
import { Upload, Trash2, Clock, Flag, Car, MapPin } from "lucide-react";
import { uploadAndIndexIbt } from "@/lib/uploadIbt";
import { toast } from "sonner";

type Sess = Tables<"telemetry_sessions">;

export const Route = createFileRoute("/sessions/")({
  head: () => ({
    meta: [
      { title: "Sessions — ApexTrace" },
      { name: "description", content: "Your uploaded iRacing telemetry sessions." },
    ],
  }),
  component: SessionsPage,
});

function fmtDuration(s?: number | null) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtLap(s?: number | null) {
  if (!s || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = (s - m * 60).toFixed(3);
  return `${m}:${sec.padStart(6, "0")}`;
}
function fmtSize(b?: number | null) {
  if (!b) return "—";
  const mb = b / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function SessionsPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; pct: number; msg?: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth" });
  }, [user, loading, navigate]);

  const refresh = async () => {
    const { data, error } = await supabase
      .from("telemetry_sessions")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setSessions(data ?? []);
  };

  useEffect(() => {
    if (user) refresh();
  }, [user]);

  const handleFile = async (file: File) => {
    if (!user) return;
    if (!file.name.toLowerCase().endsWith(".ibt")) {
      toast.error("Please choose an .ibt file");
      return;
    }
    setBusy(true);
    setProgress({ phase: "read", pct: 0 });
    try {
      const res = await uploadAndIndexIbt(file, user.id, (phase, pct, msg) => setProgress({ phase, pct, msg }));
      toast.success("Telemetry indexed");
      navigate({ to: "/sessions/$id", params: { id: res.sessionId } });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const handleDelete = async (s: Sess) => {
    if (!confirm(`Delete "${s.name}"?`)) return;
    await supabase.storage.from("telemetry").remove([s.storage_path]);
    const { error } = await supabase.from("telemetry_sessions").delete().eq("id", s.id);
    if (error) toast.error(error.message);
    else refresh();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader>
        <span className="font-mono uppercase tracking-wider">Sessions</span>
        <Link to="/lab/lapfile" className="ml-3 text-muted-foreground hover:text-foreground">
          Lapfile Lab
        </Link>
        <Link to="/fingerprint" className="ml-3 text-muted-foreground hover:text-foreground">
          Fingerprint
        </Link>
      </AppHeader>

      <main className="mx-auto max-w-7xl p-6">
        {/* Upload zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className={`hairline mb-6 flex cursor-pointer flex-col items-center justify-center rounded-sm bg-panel py-12 transition-colors ${drag ? "border-primary bg-accent" : "hover:bg-panel-2"}`}
        >
          <Upload className="h-8 w-8 text-primary" />
          <p className="mt-3 text-sm">
            {busy ? (
              <span className="font-mono">
                {progress?.phase} · {progress?.pct}% {progress?.msg ? `· ${progress.msg}` : ""}
              </span>
            ) : (
              <>Drop an <span className="font-mono text-primary">.ibt</span> file or click to browse</>
            )}
          </p>
          {busy && progress && (
            <div className="mt-3 h-1 w-72 overflow-hidden rounded-full bg-rail">
              <div className="h-full bg-primary transition-all" style={{ width: `${progress.pct}%` }} />
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".ibt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>

        {/* Sessions grid */}
        {sessions.length === 0 ? (
          <div className="hairline rounded-sm bg-panel p-12 text-center text-sm text-muted-foreground">
            No sessions yet. Upload your first .ibt file above.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((s) => (
              <div key={s.id} className="hairline group relative rounded-sm bg-panel p-4 hover:border-primary">
                <Link to="/sessions/$id" params={{ id: s.id }} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-medium">{s.track ?? "Unknown track"}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{s.car ?? "—"}</p>
                    </div>
                    <div className="rounded-sm bg-rail px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      {s.tick_rate ?? "?"} Hz
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Clock className="h-3 w-3" /> {fmtDuration(s.duration_s)}
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Flag className="h-3 w-3" /> {s.lap_count ?? 0} laps
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Car className="h-3 w-3" /> {s.num_vars ?? 0} vars
                    </div>
                    <div className="flex items-center gap-1.5 text-primary">
                      <MapPin className="h-3 w-3" /> {fmtLap(s.best_lap_s)}
                    </div>
                  </div>
                  <div className="mt-3 truncate text-[11px] text-muted-foreground">{s.name} · {fmtSize(s.file_size)}</div>
                </Link>
                <button
                  onClick={() => handleDelete(s)}
                  className="absolute right-2 top-2 rounded-sm p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive hover:text-destructive-foreground group-hover:opacity-100"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}