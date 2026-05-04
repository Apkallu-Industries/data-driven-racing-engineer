import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `You are an expert race engineer + driving coach analyzing iRacing telemetry.

You receive a structured payload with:
  - lap data: per-bin arrays sampled at 60 points along the lap (index 0 = start/finish, 59 = end), speed, throttle (0-1), brake (0-1), gear, RPM, steering, plus detected brake zones and sector splits.
  - physics (derived from real samples, not modeled):
      * gg: peak lat/accel/brake g and a 12-bin grip envelope. Use this to spot quadrants of the friction circle the driver underuses (e.g. low combined-g while trail-braking).
      * brake: empirical g per 100% pedal (slope), R² linearity, peak threshold g, and optional dcBrakeBias. Low R² = lockup/ABS modulation. Reference real numbers.
      * slip: body slip β at high lateral g, balance label (loose/tight/neutral). Tie advice to real β rather than guessing.
      * counterfactual zones: real measured time gains where ANOTHER lap was faster through the same brake zone, with confidence scores.
  - history (optional): prior sessions on this track + car. Includes best-ever lap, recent best, top 5 historical laps, and a trend label (improving/regressing/flat).

Rules:
  1. Be concrete and quantitative. Reference distance using "% lap distance" or actual meters when possible.
  2. Cite physics numbers when available — e.g. "you peak at 1.4g lat but 0.9g combined under trail-braking, leaving grip on the table".
  3. If counterfactual zones are present, prefer those for "where time is" — they are measured, not guessed.
  4. If history is present and shows regression, mention it explicitly. If the current best beats the historical best, congratulate briefly.
  5. Avoid generic advice. Every tip must be tied to a number in the payload. Never fabricate values.`;

const SCHEMA_CONCISE = {
  name: "coach_concise",
  description: "Return 3-6 prioritized, actionable coaching tips.",
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
  description: "Return a per-corner breakdown of the lap with entry/mid/exit notes.",
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
      return { error: "AI coach is not configured (missing LOVABLE_API_KEY)." } as const;
    }

    const schema = data.detailed ? SCHEMA_DETAILED : SCHEMA_CONCISE;

    const body = {
      model: "google/gemini-2.5-pro",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Analyze this telemetry and give ${data.detailed ? "a detailed per-corner breakdown" : "concise prioritized tips"}.\n\nDATA:\n${JSON.stringify(data.payload)}`,
        },
      ],
      tools: [{ type: "function", function: schema }],
      tool_choice: { type: "function", function: { name: schema.name } },
    };

    try {
      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        if (resp.status === 429) {
          return { error: "Rate limit hit. Wait a moment and try again." } as const;
        }
        if (resp.status === 402) {
          return {
            error: "AI credits exhausted. Add credits in Settings → Workspace → Usage.",
          } as const;
        }
        const txt = await resp.text();
        console.error("[coach] gateway error", resp.status, txt);
        return { error: `AI gateway error (${resp.status}).` } as const;
      }

      const json = await resp.json();
      const call = json?.choices?.[0]?.message?.tool_calls?.[0];
      const argsStr = call?.function?.arguments;
      if (!argsStr) {
        return { error: "AI did not return a structured response." } as const;
      }
      const parsed = JSON.parse(argsStr);
      return { result: parsed, detailed: data.detailed } as const;
    } catch (e) {
      console.error("[coach] failed", e);
      return { error: e instanceof Error ? e.message : "Unknown error" } as const;
    }
  });