-- Fix attendance-photos bucket RLS policies to allow uploads
-- Run this SQL in your Supabase SQL Editor

-- Create policy to allow authenticated users to upload their own attendance photos
CREATE POLICY "Allow authenticated users to upload attendance photos"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'attendance-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Create policy to allow authenticated users to read attendance photos
CREATE POLICY "Allow authenticated users to read attendance photos"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'attendance-photos');

-- Create policy to allow users to update their own attendance photos
CREATE POLICY "Allow authenticated users to update their own attendance photos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'attendance-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'attendance-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);