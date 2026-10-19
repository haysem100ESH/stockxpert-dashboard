-- Create credit plans table
CREATE TABLE public.credit_plans (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_owner_id UUID NOT NULL,
  days INTEGER NOT NULL,
  price NUMERIC NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.credit_plans ENABLE ROW LEVEL SECURITY;

-- Create policies for credit plans
CREATE POLICY "Developers can manage all credit plans" 
ON public.credit_plans 
FOR ALL 
USING (is_developer());

-- Add trigger for timestamps
CREATE TRIGGER update_credit_plans_updated_at
BEFORE UPDATE ON public.credit_plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();