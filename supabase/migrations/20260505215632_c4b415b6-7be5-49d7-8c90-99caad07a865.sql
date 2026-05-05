
CREATE TABLE public.shared_laps (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  session_id UUID NOT NULL REFERENCES public.telemetry_sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  ref_lap INTEGER,
  cmp_lap INTEGER,
  view_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_shared_laps_token ON public.shared_laps(token);
CREATE INDEX idx_shared_laps_user ON public.shared_laps(user_id);

ALTER TABLE public.shared_laps ENABLE ROW LEVEL SECURITY;

-- Owners can manage their own share links
CREATE POLICY "Owners select own shares"
  ON public.shared_laps FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners insert own shares"
  ON public.shared_laps FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Owners delete own shares"
  ON public.shared_laps FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Public read by token is performed via the service-role server function;
-- no anon SELECT policy is added so direct PostgREST cannot enumerate tokens.
