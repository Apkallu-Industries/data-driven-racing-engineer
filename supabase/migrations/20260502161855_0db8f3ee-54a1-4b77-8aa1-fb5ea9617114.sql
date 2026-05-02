CREATE POLICY "Users update own telemetry files"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'telemetry' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'telemetry' AND (auth.uid())::text = (storage.foldername(name))[1]);