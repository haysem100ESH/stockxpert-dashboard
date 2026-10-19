-- Add created_by column to medicines table
ALTER TABLE public.medicines ADD COLUMN created_by uuid REFERENCES auth.users(id);

-- Create universal_credit_plans table
CREATE TABLE public.universal_credit_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  days integer NOT NULL,
  price numeric NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on universal_credit_plans
ALTER TABLE public.universal_credit_plans ENABLE ROW LEVEL SECURITY;

-- Developers can manage all universal credit plans
CREATE POLICY "Developers can manage all universal credit plans"
ON public.universal_credit_plans
FOR ALL
USING (is_developer());

-- Anyone can view universal credit plans
CREATE POLICY "Anyone can view universal credit plans"
ON public.universal_credit_plans
FOR SELECT
USING (true);

-- Create trigger for updated_at on universal_credit_plans
CREATE TRIGGER update_universal_credit_plans_updated_at
BEFORE UPDATE ON public.universal_credit_plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default universal credit plans
INSERT INTO public.universal_credit_plans (days, price) VALUES
  (30, 50),
  (60, 90),
  (90, 120);