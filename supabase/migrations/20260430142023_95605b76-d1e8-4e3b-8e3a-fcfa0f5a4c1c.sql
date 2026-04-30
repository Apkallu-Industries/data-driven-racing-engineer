
-- Sessions table: one row per uploaded .ibt file
CREATE TABLE public.telemetry_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  track TEXT,
  car TEXT,
  driver TEXT,
  recorded_at TIMESTAMPTZ,
  duration_s NUMERIC,
  lap_count INTEGER,
  tick_rate INTEGER,
  num_vars INTEGER,
  file_size BIGINT,
  storage_path TEXT NOT NULL,
  best_lap_s NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.telemetry_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own sessions" ON public.telemetry_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own sessions" ON public.telemetry_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own sessions" ON public.telemetry_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users delete own sessions" ON public.telemetry_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX idx_telemetry_sessions_user ON public.telemetry_sessions(user_id, created_at DESC);

-- Storage bucket for raw .ibt files (private)
INSERT INTO storage.buckets (id, name, public) VALUES ('telemetry', 'telemetry', false);

CREATE POLICY "Users read own telemetry files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'telemetry' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users upload own telemetry files" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'telemetry' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users delete own telemetry files" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'telemetry' AND auth.uid()::text = (storage.foldername(name))[1]);
