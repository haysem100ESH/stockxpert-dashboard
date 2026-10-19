-- Add RLS policies for developers to access profiles and other necessary data

-- Allow developers to view all profiles (needed for developer dashboard)
CREATE POLICY "Developers can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (is_developer());

-- The pharmacy_subscriptions table already has developer policies, but let's ensure they can view all
-- (This should already exist based on the table info provided)
-- CREATE POLICY "Developers can view all subscriptions" 
-- ON public.pharmacy_subscriptions 
-- FOR SELECT 
-- USING (is_developer());