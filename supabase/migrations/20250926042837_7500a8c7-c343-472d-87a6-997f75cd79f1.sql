-- Create transactions table to log credit payments
CREATE TABLE public.transactions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  pharmacy_owner_id UUID NOT NULL,
  amount_collected NUMERIC NOT NULL,
  credit_days_added INTEGER NOT NULL,
  transaction_type TEXT NOT NULL DEFAULT 'credit_payment',
  processed_by UUID NOT NULL, -- developer who processed the payment
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Developers can manage all transactions" 
ON public.transactions 
FOR ALL 
USING (is_developer());

-- Add index for better performance
CREATE INDEX idx_transactions_pharmacy_owner_id ON public.transactions(pharmacy_owner_id);
CREATE INDEX idx_transactions_created_at ON public.transactions(created_at DESC);