import { useMemo, useState } from "react";
import type { IbtParsed } from "@/lib/ibt/types";
import { useWorkbench } from "@/lib/store";
import { analyzeTelemetry } from "@/server/coach.functions";
import { buildSessionSummary, buildCoachPayload, type CoachMode } from "@/lib/coach/summarize";
import { Brain, Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";

interface ConciseTip {
  priority: "high" | "medium" | "low";
  location: string;
  tip: string;
  reason: string;
  estGainS: number;
}
interface ConciseResult {
  headline: string;
  tips: ConciseTip[];
}
interface CornerNote {
  label: string;
  locationPct: number;
  entry: string;
  mid: string;
  exit: string;
  estGainS: number;
}
interface DetailedResult {
  headline: string;
  overview: string;
  corners: CornerNote[];
}

export function AICoach({
  parsed,
  track,
  car,
}: {
  parsed: IbtParsed;
  track?: string | null;
  car?: string | null;
}) {
  const { refLap, cmpLap } = useWorkbench();
  const [mode, setMode] = useState<CoachMode>("single");
  const [detailed, setDetailed] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConciseResult | DetailedResult | null>(null);
  const [resultDetailed, setResultDetailed] = useState(false);

  const summary = useMemo(
    () => buildSessionSummary(parsed, track ?? undefined, car ?? undefined),
    [parsed, track, car],
  );

  const canRun = summary.laps.length > 0 && (mode !== "compare" || summary.laps.length >= 2);

  const run = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const payload = buildCoachPayload(summary, mode, refLap, cmpLap, detailed);
      const resp = await analyzeTelemetry({ data: { payload, detailed } });
      if ("error" in resp) {
        setError(resp.error);
      } else {
        setResult(resp.result as ConciseResult | DetailedResult);
        setResultDetailed(resp.detailed);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="hairline-t flex shrink-0 flex-col bg-panel">
      {/* Header / toolbar */}
      <div className="hairline-b flex items-center gap-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-1.5 text-foreground hover:text-primary"
        >
          <Brain className="h-3.5 w-3.5 text-primary" />
          AI Coach
          {collapsed ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {!collapsed && (
          <>
            <span className="text-muted-foreground">·</span>
            <div className="flex items-center gap-px rounded-sm bg-rail">
              {(["single", "compare", "session"] as CoachMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-2 py-1 ${
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "single" ? "Single Lap" : m === "compare" ? "Compare" : "Session"}
                </button>
              ))}
            </div>

            <span className="text-muted-foreground">·</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={detailed}
                onChange={(e) => setDetailed(e.target.checked)}
                className="h-3 w-3 accent-primary"
              />
              <span className="text-muted-foreground">Detailed</span>
            </label>

            <div className="ml-auto flex items-center gap-2">
              {mode === "compare" && (
                <span className="text-muted-foreground">
                  Lap {refLap ?? "?"} vs {cmpLap ?? "?"}
                </span>
              )}
              {mode === "single" && (
                <span className="text-muted-foreground">
                  Lap {refLap ?? "best"}
                </span>
              )}
              <button
                onClick={run}
                disabled={loading || !canRun}
                className="flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1 text-[11px] uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {loading ? "Analyzing" : "Analyze"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="max-h-72 overflow-y-auto px-3 py-2">
          {!canRun && (
            <div className="text-xs text-muted-foreground">
              {mode === "compare"
                ? "Need at least 2 valid laps to compare."
                : "No valid laps to analyze."}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-sm border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!error && !result && !loading && canRun && (
            <div className="text-xs text-muted-foreground">
              Pick a mode and click <span className="text-foreground">Analyze</span> to get
              data-driven coaching tips. Compare uses your Ref/Cmp lap selectors above.
            </div>
          )}

          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reading the lap, looking for time…
            </div>
          )}

          {result && !resultDetailed && "tips" in result && (
            <ConciseView data={result as ConciseResult} />
          )}
          {result && resultDetailed && "corners" in result && (
            <DetailedView data={result as DetailedResult} />
          )}
        </div>
      )}
    </div>
  );
}

function priorityClass(p: ConciseTip["priority"]) {
  if (p === "high") return "bg-destructive/20 text-destructive-foreground border-destructive/40";
  if (p === "medium") return "bg-primary/15 text-foreground border-primary/40";
  return "bg-rail text-muted-foreground border-border";
}

function ConciseView({ data }: { data: ConciseResult }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{data.headline}</div>
      <ul className="space-y-1.5">
        {data.tips.map((t, i) => (
          <li
            key={i}
            className="hairline rounded-sm bg-rail/40 p-2 text-xs"
          >
            <div className="flex items-center gap-2">
              <span
                className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${priorityClass(t.priority)}`}
              >
                {t.priority}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                {t.location}
              </span>
              {t.estGainS > 0 && (
                <span className="ml-auto font-mono text-[11px] text-primary">
                  +{t.estGainS.toFixed(2)}s
                </span>
              )}
            </div>
            <div className="mt-1 text-foreground">{t.tip}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{t.reason}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailedView({ data }: { data: DetailedResult }) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-foreground">{data.headline}</div>
      <div className="text-xs text-muted-foreground">{data.overview}</div>
      <div className="grid gap-2 md:grid-cols-2">
        {data.corners.map((c, i) => (
          <div key={i} className="hairline rounded-sm bg-rail/40 p-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-primary">
                {c.label}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">
                ~{c.locationPct.toFixed(0)}% lap
              </span>
              {c.estGainS > 0 && (
                <span className="ml-auto font-mono text-[11px] text-primary">
                  +{c.estGainS.toFixed(2)}s
                </span>
              )}
            </div>
            <div className="mt-1 space-y-0.5 text-[11px]">
              <div>
                <span className="font-mono uppercase text-muted-foreground">Entry</span>{" "}
                <span className="text-foreground">{c.entry}</span>
              </div>
              <div>
                <span className="font-mono uppercase text-muted-foreground">Mid</span>{" "}
                <span className="text-foreground">{c.mid}</span>
              </div>
              <div>
                <span className="font-mono uppercase text-muted-foreground">Exit</span>{" "}
                <span className="text-foreground">{c.exit}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}