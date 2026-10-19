-- Create subscription plans table
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  branches_limit INTEGER, -- NULL means unlimited
  staff_limit INTEGER, -- NULL means unlimited
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on subscription_plans
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Allow anyone to view subscription plans
CREATE POLICY "Anyone can view subscription plans"
  ON public.subscription_plans
  FOR SELECT
  USING (true);

-- Only developers can manage subscription plans
CREATE POLICY "Developers can manage subscription plans"
  ON public.subscription_plans
  FOR ALL
  USING (is_developer());

-- Add plan_id to pharmacy_subscriptions
ALTER TABLE public.pharmacy_subscriptions
ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.subscription_plans(id);

-- Insert default subscription plans
INSERT INTO public.subscription_plans (name, description, branches_limit, staff_limit)
VALUES 
  ('Basic', 'Ideal for single-branch pharmacies with a small team.', 1, 3),
  ('Advanced', 'Suitable for growing pharmacies with multiple branches.', 3, 9),
  ('Premium', 'For established pharmacy networks managing multiple teams.', 5, 15),
  ('Premium Plus', 'For large-scale pharmacy chains with no limits.', NULL, NULL)
ON CONFLICT (name) DO NOTHING;

-- Set default plan to Basic for existing subscriptions
UPDATE public.pharmacy_subscriptions
SET plan_id = (SELECT id FROM public.subscription_plans WHERE name = 'Basic')
WHERE plan_id IS NULL;

-- Create function to get current branches count for an owner
CREATE OR REPLACE FUNCTION public.get_branches_count(owner_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM pharmacy_branches
  WHERE pharmacy_owner_id = owner_id;
$$;

-- Create function to get current staff count for an owner
CREATE OR REPLACE FUNCTION public.get_staff_count(owner_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM profiles
  WHERE role = 'staff' 
  AND branch_id IN (
    SELECT id FROM pharmacy_branches WHERE pharmacy_owner_id = owner_id
  );
$$;

-- Create function to check if owner can add branch
CREATE OR REPLACE FUNCTION public.can_add_branch(owner_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (
      SELECT branches_limit 
      FROM subscription_plans sp
      INNER JOIN pharmacy_subscriptions ps ON ps.plan_id = sp.id
      WHERE ps.pharmacy_owner_id = owner_id
    ) IS NULL THEN true -- Unlimited
    ELSE (
      SELECT COUNT(*) 
      FROM pharmacy_branches 
      WHERE pharmacy_owner_id = owner_id
    ) < (
      SELECT branches_limit 
      FROM subscription_plans sp
      INNER JOIN pharmacy_subscriptions ps ON ps.plan_id = sp.id
      WHERE ps.pharmacy_owner_id = owner_id
    )
  END;
$$;

-- Create function to check if owner can add staff
CREATE OR REPLACE FUNCTION public.can_add_staff(owner_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN (
      SELECT staff_limit 
      FROM subscription_plans sp
      INNER JOIN pharmacy_subscriptions ps ON ps.plan_id = sp.id
      WHERE ps.pharmacy_owner_id = owner_id
    ) IS NULL THEN true -- Unlimited
    ELSE (
      SELECT COUNT(*) 
      FROM profiles
      WHERE role = 'staff' 
      AND branch_id IN (
        SELECT id FROM pharmacy_branches WHERE pharmacy_owner_id = owner_id
      )
    ) < (
      SELECT staff_limit 
      FROM subscription_plans sp
      INNER JOIN pharmacy_subscriptions ps ON ps.plan_id = sp.id
      WHERE ps.pharmacy_owner_id = owner_id
    )
  END;
$$;

-- Add trigger to update updated_at on subscription_plans
CREATE TRIGGER update_subscription_plans_updated_at
  BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();