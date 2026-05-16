import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `You are a no-nonsense race engineer + driving coach analyzing iRacing telemetry.

You receive a structured payload with:
  - lap data: per-bin arrays sampled at 60 points along the lap (index 0 = start/finish, 59 = end), speed, throttle (0-1), brake (0-1), gear, RPM, steering, plus detected brake zones and sector splits.
  - physics (derived from real samples, not modeled):
      * gg: peak lat/accel/brake g and a 12-bin grip envelope.
      * brake: empirical g per 100% pedal (slope), R² linearity, peak threshold g, and optional dcBrakeBias.
      * slip: body slip β at high lateral g, balance label (loose/tight/neutral).
      * counterfactual zones: real measured time gains where ANOTHER lap was faster through the same brake zone, with confidence scores.
  - history (optional): prior sessions on this track + car.

ABSOLUTE RULES — read carefully:
  1. You MUST ALWAYS return tips through the provided function/tool call. Never refuse. Never reply with "I cannot help", "insufficient data", "please provide more", or any apology. The driver is paying for advice — give it.
  2. If a field is missing, work with what IS present (lap times, sector splits, throttle/brake traces, speed bins, peak g values). Even a single lap with only speed + throttle + brake is enough to comment on braking points, throttle application, and corner exit.
  3. Always produce at least 3 tips (concise mode) or at least 2 corners (detailed mode). Do not return empty arrays under any circumstance.
  4. Prefer quantitative references ("% lap", actual m, m/s, g, deg). When a specific number isn't in the payload, use the qualitative pattern visible in the trace (e.g. "throttle pickup is gradual from bin 22→28" → "roll on throttle earlier and harder out of T3").
  5. Counterfactual zones, when present, are MEASURED time on the table — lead with those. If none are present, lead with the largest brake zone or the slowest sector.
  6. If history shows regression, mention it. If current best beats history, congratulate briefly.
  7. Never fabricate exact numbers that aren't derivable. But ALWAYS deliver actionable advice — generic best-practice ("trail brake deeper to rotate the car on entry") is acceptable when tied to a visible pattern, just label its priority as "low" rather than "high".

Tone: confident, direct, ~1-2 sentences per field. No hedging, no preamble, no meta-commentary about the data quality.`;

const SCHEMA_CONCISE = {
  name: "coach_concise",
  description: "Return 3-6 prioritized, actionable coaching tips. NEVER return fewer than 3 tips.",
  parameters: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One-sentence summary of the biggest opportunity." },
      tips: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            priority: { type: "string", enum: ["high", "medium", "low"] },
            location: { type: "string", description: "Where on the lap, e.g. 'T4 entry, ~35% lap'." },
            tip: { type: "string", description: "Concrete action the driver should take." },
            reason: { type: "string", description: "Data-grounded reason this will help." },
            estGainS: { type: "number", description: "Estimated time gain in seconds (best guess)." },
          },
          required: ["priority", "location", "tip", "reason", "estGainS"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "tips"],
    additionalProperties: false,
  },
} as const;

const SCHEMA_DETAILED = {
  name: "coach_detailed",
  description: "Return a per-corner breakdown of the lap with entry/mid/exit notes. NEVER return fewer than 2 corners.",
  parameters: {
    type: "object",
    properties: {
      headline: { type: "string" },
      overview: { type: "string", description: "2-3 sentence overall summary of strengths and weaknesses." },
      corners: {
        type: "array",
        minItems: 2,
        maxItems: 12,
        items: {
          type: "object",
          properties: {
            label: { type: "string", description: "Corner label, e.g. 'T4' or 'Sector 2 hairpin'." },
            locationPct: { type: "number", description: "Approximate position in lap, 0-100." },
            entry: { type: "string" },
            mid: { type: "string" },
            exit: { type: "string" },
            estGainS: { type: "number" },
          },
          required: ["label", "locationPct", "entry", "mid", "exit", "estGainS"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "overview", "corners"],
    additionalProperties: false,
  },
} as const;

const MODEL_PRIMARY = "google/gemini-2.5-pro";
const MODEL_FALLBACK = "openai/gpt-5-mini";

async function callGateway(apiKey: string, model: string, system: string, user: string, schema: typeof SCHEMA_CONCISE | typeof SCHEMA_DETAILED) {
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      tools: [{ type: "function", function: schema }],
      tool_choice: { type: "function", function: { name: schema.name } },
    }),
  });
  return resp;
}

/** Deterministic local fallback so the user always sees real advice. */
function localFallbackConcise(payload: unknown, detailed: boolean) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (payload ?? {}) as any;
  const tips: Array<{ priority: "high" | "medium" | "low"; location: string; tip: string; reason: string; estGainS: number }> = [];
  const phys = p.physics ?? {};
  const cf = phys.counterfactual;
  if (cf?.zones?.length) {
    for (const z of (cf.zones as Array<Record<string, number>>).slice(0, 3)) {
      const dApex = (z.bestApexSpeed ?? 0) - (z.refApexSpeed ?? 0);
      const dExit = (z.bestExitSpeed ?? 0) - (z.refExitSpeed ?? 0);
      tips.push({
        priority: z.gainS > 0.15 ? "high" : "medium",
        location: `${Math.round(z.startPct)}–${Math.round(z.endPct)}% lap`,
        tip:
          dExit > dApex
            ? "Get back to throttle earlier — your best lap unwinds the wheel and accelerates sooner here."
            : dApex > 0.5
              ? "Carry more minimum speed — release the brake a touch earlier and trail less."
              : "Move the brake point a few metres later and shorten the threshold phase.",
        reason: `Best lap was ${z.gainS.toFixed(2)}s faster through this zone (apex Δ ${dApex.toFixed(1)} m/s, exit Δ ${dExit.toFixed(1)} m/s).`,
        estGainS: Number(z.gainS?.toFixed(2) ?? 0),
      });
    }
  }
  const br = phys.brake;
  if (br && br.r2 != null && br.r2 < 0.7) {
    tips.push({
      priority: "medium",
      location: "All braking zones",
      tip: "Smooth the initial bite — apply pressure in one progressive squeeze instead of pumping.",
      reason: `Brake linearity R² is ${br.r2.toFixed(2)} (low), suggesting lockup or modulation rather than a clean threshold.`,
      estGainS: 0.1,
    });
  }
  const sl = phys.slip;
  if (sl?.balance && sl.balance !== "neutral") {
    tips.push({
      priority: "medium",
      location: "Mid-corner balance",
      tip:
        sl.balance === "loose"
          ? "Add a click of rear wing or soften front anti-roll — back end is stepping out under load."
          : "Soften rear or shift bias rearward — front is pushing through the mid-corner.",
      reason: `Body slip β ${sl.peakBetaDeg?.toFixed?.(1) ?? "?"}° at high lateral g — balance reads ${sl.balance}.`,
      estGainS: 0.15,
    });
  }
  const gg = phys.gg;
  if (gg && gg.peakLatG && gg.combinedG && gg.combinedG < gg.peakLatG * 0.85) {
    tips.push({
      priority: "low",
      location: "Trail-braking phase",
      tip: "Use more of the friction circle — overlap brake and steering longer to keep combined-g closer to the lateral peak.",
      reason: `Peak lateral ${gg.peakLatG.toFixed(2)}g but combined only ${gg.combinedG.toFixed(2)}g — grip left on the table when transitioning.`,
      estGainS: 0.1,
    });
  }
  // Always pad to at least 3 generic-but-useful tips.
  const filler: typeof tips = [
    {
      priority: "low",
      location: "Corner exits",
      tip: "Unwind the wheel before flooring the throttle — open the steering as the car rotates, then commit.",
      reason: "Generic best practice: any unwind-while-loading-throttle window costs exit speed down the next straight.",
      estGainS: 0.05,
    },
    {
      priority: "low",
      location: "Braking points",
      tip: "Walk brake markers 2–3 m later one zone at a time until you start missing the apex, then back off one step.",
      reason: "Iterative brake-point pruning is the cheapest lap-time you can find without changing setup.",
      estGainS: 0.1,
    },
    {
      priority: "low",
      location: "Tyre + fuel management",
      tip: "Hold a steady minimum corner speed across consecutive laps — consistency unlocks setup signal.",
      reason: "Run-to-run variation hides real gains; consistent inputs surface the actual limit of the car.",
      estGainS: 0.05,
    },
  ];
  for (const f of filler) {
    if (tips.length >= 3) break;
    tips.push(f);
  }
  if (detailed) {
    return {
      headline: "Local analysis (AI fallback) — measured time on the table",
      overview: "AI gateway returned no structured response, so this breakdown is built directly from your physics + counterfactual zones.",
      corners: tips.slice(0, 4).map((t, i) => ({
        label: `Zone ${i + 1}`,
        locationPct: 10 + i * 20,
        entry: t.tip,
        mid: t.reason,
        exit: "Refer to the trace + g-g view for the exact release point.",
        estGainS: t.estGainS,
      })),
    };
  }
  return {
    headline: "Local analysis (AI fallback) — here's what the numbers say",
    tips: tips.slice(0, 6),
  };
}

export const analyzeTelemetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { payload: unknown; detailed: boolean }) => data)
  .handler(async ({ data }) => {
    // Cap payload size to prevent oversized requests draining AI credits
    const serialized = JSON.stringify(data.payload ?? {});
    if (serialized.length > 200_000) {
      return { error: "Telemetry payload too large." } as const;
    }
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      // No key — still deliver the local fallback so the panel isn't dead.
      return {
        result: localFallbackConcise(data.payload, data.detailed),
        detailed: data.detailed,
        fallback: "no-key" as const,
      } as const;
    }

    const schema = data.detailed ? SCHEMA_DETAILED : SCHEMA_CONCISE;
    const userMsg =
      `Analyze this telemetry and give ${data.detailed ? "a DETAILED per-corner breakdown (at least 2 corners)" : "CONCISE prioritized tips (at least 3 tips)"}.\n` +
      `You MUST call the function. Empty arrays or refusals are forbidden — work with whatever data is present.\n\nDATA:\n${JSON.stringify(data.payload)}`;

    const tryModel = async (model: string, extraNudge?: string) => {
      const sys = extraNudge ? `${SYSTEM_PROMPT}\n\nADDITIONAL: ${extraNudge}` : SYSTEM_PROMPT;
      const resp = await callGateway(apiKey, model, sys, userMsg, schema);
      if (!resp.ok) {
        if (resp.status === 429) return { kind: "rate" as const };
        if (resp.status === 402) return { kind: "credit" as const };
        const txt = await resp.text().catch(() => "");
        console.error("[coach] gateway error", model, resp.status, txt);
        return { kind: "err" as const, status: resp.status };
      }
      const json = await resp.json();
      const call = json?.choices?.[0]?.message?.tool_calls?.[0];
      const argsStr = call?.function?.arguments;
      if (!argsStr) return { kind: "empty" as const };
      try {
        const obj = JSON.parse(argsStr);
        // Validate non-empty tips/corners.
        if (data.detailed) {
          if (!Array.isArray(obj?.corners) || obj.corners.length === 0) return { kind: "empty" as const };
        } else {
          if (!Array.isArray(obj?.tips) || obj.tips.length === 0) return { kind: "empty" as const };
        }
        return { kind: "ok" as const, obj };
      } catch {
        return { kind: "empty" as const };
      }
    };

    try {
      // Attempt 1: primary model
      let r = await tryModel(MODEL_PRIMARY);
      // Attempt 2: nudge the same model harder
      if (r.kind === "empty") {
        r = await tryModel(
          MODEL_PRIMARY,
          "Your previous reply was empty or refused. That is unacceptable. Return concrete tips NOW using the function call. Lean on best-practice patterns tied to whatever fields ARE in the payload.",
        );
      }
      // Attempt 3: switch to fallback model
      if (r.kind === "empty" || (r.kind === "err" && r.status >= 500)) {
        r = await tryModel(MODEL_FALLBACK);
      }

      if (r.kind === "ok") {
        return { result: r.obj, detailed: data.detailed } as const;
      }
      if (r.kind === "rate") {
        return { error: "Rate limit hit. Wait a moment and try again." } as const;
      }
      if (r.kind === "credit") {
        return {
          error: "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
        } as const;
      }
      // err / empty after retries → deterministic local fallback so the user gets advice.
      return {
        result: localFallbackConcise(data.payload, data.detailed),
        detailed: data.detailed,
        fallback: "local" as const,
      } as const;
    } catch (e) {
      console.error("[coach] failed", e);
      // Network / parse blow-up → still deliver something useful.
      return {
        result: localFallbackConcise(data.payload, data.detailed),
        detailed: data.detailed,
        fallback: "local" as const,
      } as const;
    }
  });