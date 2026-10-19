
-- Create customers table
CREATE TABLE public.customers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  notes TEXT,
  branch_id UUID REFERENCES public.pharmacy_branches(id),
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage customers in their branches"
  ON public.customers FOR ALL
  USING (user_owns_branch(branch_id))
  WITH CHECK (user_owns_branch(branch_id));

CREATE POLICY "Staff can manage customers in own branch"
  ON public.customers FOR ALL
  USING (branch_id = get_user_branch())
  WITH CHECK (branch_id = get_user_branch());

-- Create customer_payments table (debt payment records)
CREATE TABLE public.customer_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  sale_id UUID REFERENCES public.sales(id),
  amount NUMERIC NOT NULL,
  payment_method TEXT DEFAULT 'Cash',
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  branch_id UUID REFERENCES public.pharmacy_branches(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can manage customer payments in their branches"
  ON public.customer_payments FOR ALL
  USING (user_owns_branch(branch_id))
  WITH CHECK (user_owns_branch(branch_id));

CREATE POLICY "Staff can view customer payments in own branch"
  ON public.customer_payments FOR SELECT
  USING (branch_id = get_user_branch());

CREATE POLICY "Staff can insert customer payments in own branch"
  ON public.customer_payments FOR INSERT
  WITH CHECK (branch_id = get_user_branch());

-- Add customer_id and payment tracking to sales table
ALTER TABLE public.sales
  ADD COLUMN customer_id UUID REFERENCES public.customers(id),
  ADD COLUMN amount_paid NUMERIC DEFAULT 0,
  ADD COLUMN payment_status TEXT DEFAULT 'paid';

-- Create trigger for customer updated_at
CREATE TRIGGER update_customers_updated_at
  BEFORE UPDATE ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
