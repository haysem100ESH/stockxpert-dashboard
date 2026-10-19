-- Allow authenticated users to upload their own receipt files
CREATE POLICY "Users can upload their own receipt files" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'payment receipts' AND
  auth.uid() IS NOT NULL AND
  (storage.foldername(name))[1] = 'receipts' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Allow users to view their own receipt files
CREATE POLICY "Users can view their own receipt files" ON storage.objects
FOR SELECT USING (
  bucket_id = 'payment receipts' AND
  auth.uid() IS NOT NULL AND
  (storage.foldername(name))[1] = 'receipts' AND
  (storage.foldername(name))[2] = auth.uid()::text
);

-- Public read access for Telegram bot
CREATE POLICY "Public read access for receipt files" ON storage.objects
FOR SELECT USING (bucket_id = 'payment receipts');