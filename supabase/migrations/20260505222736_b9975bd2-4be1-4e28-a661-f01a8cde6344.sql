ALTER TABLE public.shared_laps
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

CREATE INDEX IF NOT EXISTS shared_laps_token_idx ON public.shared_laps(token);

DROP POLICY IF EXISTS "Owners update own shares" ON public.shared_laps;
CREATE POLICY "Owners update own shares"
ON public.shared_laps
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);