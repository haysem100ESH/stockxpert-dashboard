
CREATE TABLE public.credit_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id UUID NOT NULL,
  previous_score INTEGER NOT NULL,
  new_score INTEGER NOT NULL,
  change_amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  created_by UUID,
  branch_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.credit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view credit logs" ON public.credit_logs FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert credit logs" ON public.credit_logs FOR INSERT WITH CHECK (true);
