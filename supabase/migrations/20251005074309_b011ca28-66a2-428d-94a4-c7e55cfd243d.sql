-- Add pharmacy_name column to profiles table
ALTER TABLE public.profiles 
ADD COLUMN pharmacy_name text;