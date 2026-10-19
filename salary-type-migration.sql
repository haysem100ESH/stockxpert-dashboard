-- Add salary_type and salary_fixed_amount columns to profiles table
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS salary_type text DEFAULT 'percentage' CHECK (salary_type IN ('percentage', 'fixed')),
  ADD COLUMN IF NOT EXISTS salary_fixed_amount numeric DEFAULT 0;
