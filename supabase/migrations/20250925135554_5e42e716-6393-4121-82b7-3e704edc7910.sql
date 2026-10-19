-- Add a column to distinguish between manual deactivation and automatic expiry deactivation
ALTER TABLE public.profiles 
ADD COLUMN manually_deactivated boolean DEFAULT false;

-- Update the deduct_daily_credit function to not deactivate manually deactivated accounts
CREATE OR REPLACE FUNCTION public.deduct_daily_credit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $function$
BEGIN
  -- Deduct 1 credit from all active subscriptions where last_credit_deduction is not today
  UPDATE pharmacy_subscriptions 
  SET 
    subscription_credit = GREATEST(subscription_credit - 1, 0),
    last_credit_deduction = CURRENT_DATE,
    status = CASE 
      WHEN (subscription_credit - 1) <= 0 THEN 'expired'::subscription_status
      WHEN (subscription_credit - 1) <= 7 THEN 'expiring_soon'::subscription_status
      ELSE status
    END
  WHERE status IN ('active', 'expiring_soon') 
    AND (last_credit_deduction IS NULL OR last_credit_deduction < CURRENT_DATE);

  -- Automatically deactivate user accounts when subscription expires, but only if not manually deactivated
  UPDATE profiles 
  SET active = false
  WHERE id IN (
    SELECT pharmacy_owner_id 
    FROM pharmacy_subscriptions 
    WHERE status = 'expired' 
      AND subscription_credit <= 0
  ) 
  AND role = 'owner' 
  AND active = true
  AND manually_deactivated = false;

  -- Log the operation
  RAISE NOTICE 'Daily credit deduction completed. Deactivated accounts with expired subscriptions (excluding manually deactivated).';
END;
$function$;