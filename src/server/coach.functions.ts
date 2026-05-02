import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SYSTEM_PROMPT = `You are an expert race driving coach analyzing iRacing telemetry.
You receive structured per-lap telemetry: per-bin arrays sampled at 60 points along the lap (index 0 = start/finish, 59 = end), speed, throttle (0-1), brake (0-1), gear, RPM, steering, plus detected brake zones and sector splits.

Be concrete and quantitative. Reference distance using "% lap distance" (e.g. "around 35% of the lap"). Say things like "trail brake to apex", "brake 5 m later", "get to throttle earlier on exit", "carry more entry speed". When comparing two laps, identify WHERE time is gained/lost (which sector, which corner, which phase: braking / mid-corner / exit) and WHY based on the data (later/earlier braking, lower min-speed, slower throttle pickup, throttle/brake overlap, gear).

Avoid generic advice. Tie every tip to specific data points in the payload.`;

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