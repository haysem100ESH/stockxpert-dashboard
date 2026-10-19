-- Add unique constraint on pharmacy_owner_id in pharmacy_subscriptions table
-- This will allow upsert operations to work properly in the developer dashboard

ALTER TABLE public.pharmacy_subscriptions 
ADD CONSTRAINT pharmacy_subscriptions_pharmacy_owner_id_unique 
UNIQUE (pharmacy_owner_id);