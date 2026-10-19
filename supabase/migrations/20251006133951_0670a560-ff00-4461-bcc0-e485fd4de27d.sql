-- Add country_name column to medicines table
ALTER TABLE public.medicines 
ADD COLUMN country_name TEXT;