-- Create RLS policies and functions for subscription management

-- Create function to check if user is developer
CREATE OR REPLACE FUNCTION public.is_developer()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'developer'
  );
$$;

-- Create function to get user subscription status
CREATE OR REPLACE FUNCTION public.get_subscription_status()
RETURNS subscription_status
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 
      CASE 
        WHEN subscription_credit <= 0 THEN 'expired'::subscription_status
        WHEN subscription_credit <= 7 THEN 'expiring_soon'::subscription_status
        ELSE 'active'::subscription_status
      END
    FROM public.pharmacy_subscriptions 
    WHERE pharmacy_owner_id = auth.uid()),
    'expired'::subscription_status
  );
$$;

-- Create RLS policies for pharmacy_subscriptions
CREATE POLICY "Developers can manage all subscriptions" ON public.pharmacy_subscriptions
FOR ALL USING (is_developer());

CREATE POLICY "Owners can view their own subscription" ON public.pharmacy_subscriptions
FOR SELECT USING (
  pharmacy_owner_id = auth.uid() AND 
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
);

-- Create RLS policies for pharmacy_branches  
CREATE POLICY "Developers can manage all branches" ON public.pharmacy_branches
FOR ALL USING (is_developer());

CREATE POLICY "Owners can manage their branches" ON public.pharmacy_branches
FOR ALL USING (
  pharmacy_owner_id = auth.uid() AND
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
);

CREATE POLICY "Staff can view branches of their owner" ON public.pharmacy_branches
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.profiles p1
    WHERE p1.id = auth.uid() AND p1.role = 'staff'
  )
);

-- Create RLS policies for payment_requests
CREATE POLICY "Developers can manage all payment requests" ON public.payment_requests
FOR ALL USING (is_developer());

CREATE POLICY "Owners can manage their payment requests" ON public.payment_requests
FOR ALL USING (
  pharmacy_owner_id = auth.uid() AND
  EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'owner')
);

-- Create triggers for updated_at
CREATE TRIGGER update_pharmacy_subscriptions_updated_at
BEFORE UPDATE ON public.pharmacy_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_pharmacy_branches_updated_at  
BEFORE UPDATE ON public.pharmacy_branches
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_payment_requests_updated_at
BEFORE UPDATE ON public.payment_requests
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create initial subscription for existing owners
INSERT INTO public.pharmacy_subscriptions (pharmacy_owner_id, subscription_credit, status)
SELECT id, 30, 'active'::subscription_status
FROM public.profiles 
WHERE role = 'owner' 
AND NOT EXISTS (
  SELECT 1 FROM public.pharmacy_subscriptions WHERE pharmacy_owner_id = profiles.id
);