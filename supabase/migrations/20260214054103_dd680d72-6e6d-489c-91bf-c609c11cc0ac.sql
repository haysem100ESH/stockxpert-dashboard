
-- Create custom categories table
CREATE TABLE public.custom_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id UUID NOT NULL,
  name TEXT NOT NULL,
  system_type TEXT NOT NULL CHECK (system_type IN ('pharmacy', 'general')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(owner_id, name, system_type)
);

-- Enable RLS
ALTER TABLE public.custom_categories ENABLE ROW LEVEL SECURITY;

-- Owners can manage their own categories
CREATE POLICY "Owners can manage their categories"
ON public.custom_categories
FOR ALL
USING (owner_id = auth.uid() AND is_owner())
WITH CHECK (owner_id = auth.uid() AND is_owner());

-- Staff can view categories of their pharmacy owner
CREATE POLICY "Staff can view owner categories"
ON public.custom_categories
FOR SELECT
USING (owner_id = get_pharmacy_owner_id());

-- Trigger for updated_at
CREATE TRIGGER update_custom_categories_updated_at
BEFORE UPDATE ON public.custom_categories
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();
