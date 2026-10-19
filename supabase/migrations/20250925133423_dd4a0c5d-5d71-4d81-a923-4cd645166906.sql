-- Update the daily credit deduction function to automatically deactivate accounts when credit runs out
CREATE OR REPLACE FUNCTION deduct_daily_credit()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Automatically deactivate user accounts when subscription expires
  UPDATE profiles 
  SET active = false
  WHERE id IN (
    SELECT pharmacy_owner_id 
    FROM pharmacy_subscriptions 
    WHERE status = 'expired' 
      AND subscription_credit <= 0
  ) 
  AND role = 'owner' 
  AND active = true;

  -- Log the operation
  RAISE NOTICE 'Daily credit deduction completed. Deactivated accounts with expired subscriptions.';
END;
$$;