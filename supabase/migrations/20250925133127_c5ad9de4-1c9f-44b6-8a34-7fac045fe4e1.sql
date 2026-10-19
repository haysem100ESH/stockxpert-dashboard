-- Add activation status and pharmacy address to profiles table
ALTER TABLE public.profiles 
ADD COLUMN active BOOLEAN DEFAULT true,
ADD COLUMN pharmacy_address TEXT;

-- Update existing profiles to be active by default
UPDATE public.profiles SET active = true WHERE active IS NULL;

-- Add comment for clarity
COMMENT ON COLUMN public.profiles.active IS 'Whether the pharmacy owner account is active and can login';
COMMENT ON COLUMN public.profiles.pharmacy_address IS 'Address of the pharmacy for owner accounts';