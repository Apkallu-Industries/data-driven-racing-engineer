import { supabase } from "@/integrations/supabase/client";
import { parseIbtInWorker } from "./ibt/parseInWorker";
import { extractCarSetupYaml } from "./ibt/setup";

export interface UploadResult {
  sessionId: string;
}

export async function uploadAndIndexIbt(
  file: File,
  userId: string,
  onProgress?: (phase: string, pct: number, msg?: string) => void,
): Promise<UploadResult> {
  // Read into ArrayBuffer
  onProgress?.("read", 0, "Reading file");
  const buf = await file.arrayBuffer();

  // Clone for parser since worker transfers ownership
  const parseBuf = buf.slice(0);
  const parsed = await parseIbtInWorker(parseBuf, onProgress);

  onProgress?.("upload", 95, "Uploading file");
  const path = `${userId}/${crypto.randomUUID()}-${file.name}`;
  const { error: upErr } = await supabase.storage
    .from("telemetry")
    .upload(path, new Blob([buf]), { contentType: "application/octet-stream", upsert: false });
  if (upErr) throw upErr;

  onProgress?.("save", 98, "Saving metadata");
  const setupYaml = parsed.meta.sessionInfoYaml
    ? extractCarSetupYaml(parsed.meta.sessionInfoYaml)
    : null;
  const { data, error } = await supabase
    .from("telemetry_sessions")
    .insert({
      user_id: userId,
      name: file.name,
      track: parsed.meta.trackDisplayName ?? parsed.meta.trackName ?? null,
      car: parsed.meta.carName ?? null,
      driver: parsed.meta.driverName ?? null,
      duration_s: parsed.meta.durationS,
      lap_count: parsed.laps.length,
      tick_rate: parsed.meta.tickRate,
      num_vars: parsed.meta.numVars,
      file_size: file.size,
      best_lap_s: parsed.meta.bestLapS ?? null,
      storage_path: path,
      recorded_at: new Date(file.lastModified).toISOString(),
      setup_yaml: setupYaml,
    })
    .select("id")
    .single();
  if (error) throw error;

  onProgress?.("done", 100);
  return { sessionId: data.id };
}