import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // George — calm, coach-like
/** Server-side allowlist. Prevents path-segment injection and abuse of premium voices. */
const ALLOWED_VOICES: ReadonlySet<string> = new Set([
  "JBFqnCBsd6RMkjVDRZzb", // George
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "CwhRBWXzGAHq8TQ4Fs17", // Roger
  "TX3LPaxmHKxFdv7VOQHJ", // Liam
  "onwK4e9ZLuTAKqWW03F9", // Daniel
]);
const VOICE_ID_RE = /^[A-Za-z0-9]{20}$/;

export const speakText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { text: string; voiceId?: string }) => {
    const text = (data.text ?? "").toString().slice(0, 4500);
    if (!text.trim()) throw new Error("Empty text");
    let voiceId = VOICE_ID;
    if (data.voiceId) {
      if (!VOICE_ID_RE.test(data.voiceId) || !ALLOWED_VOICES.has(data.voiceId)) {
        throw new Error("Invalid voiceId");
      }
      voiceId = data.voiceId;
    }
    return { text, voiceId };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return {
        error:
          "Voice coaching is not configured. Add the ELEVENLABS_API_KEY secret to enable read-aloud.",
      } as const;
    }
    const voice = data.voiceId; // already validated + allowlisted
    try {
      const resp = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: data.text,
            model_id: "eleven_turbo_v2_5",
          }),
        },
      );
      if (!resp.ok) {
        const t = await resp.text();
        console.error("[tts] elevenlabs error", resp.status, t);
        if (resp.status === 401) return { error: "Invalid ElevenLabs API key." } as const;
        if (resp.status === 429) return { error: "ElevenLabs rate limit hit." } as const;
        return { error: `Voice service error (${resp.status}).` } as const;
      }
      const buf = await resp.arrayBuffer();
      const audioBase64 = Buffer.from(buf).toString("base64");
      return { audioBase64, mime: "audio/mpeg" } as const;
    } catch (e) {
      console.error("[tts] failed", e);
      return { error: e instanceof Error ? e.message : "TTS failed" } as const;
    }
  });