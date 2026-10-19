-- Create medicine_transfers table
CREATE TABLE public.medicine_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id UUID NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  from_branch_id UUID NOT NULL REFERENCES public.pharmacy_branches(id) ON DELETE CASCADE,
  to_branch_id UUID NOT NULL REFERENCES public.pharmacy_branches(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  transferred_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  notes TEXT
);

-- Enable RLS
ALTER TABLE public.medicine_transfers ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Owners can view transfers for their branches"
ON public.medicine_transfers
FOR SELECT
USING (
  user_owns_branch(from_branch_id) OR user_owns_branch(to_branch_id)
);

CREATE POLICY "Owners can insert transfers for their branches"
ON public.medicine_transfers
FOR INSERT
WITH CHECK (
  user_owns_branch(from_branch_id) AND user_owns_branch(to_branch_id)
);

CREATE POLICY "Staff can view transfers in their branch"
ON public.medicine_transfers
FOR SELECT
USING (
  from_branch_id = get_user_branch() OR to_branch_id = get_user_branch()
);

CREATE POLICY "Staff can insert transfers from their branch"
ON public.medicine_transfers
FOR INSERT
WITH CHECK (
  from_branch_id = get_user_branch() AND 
  EXISTS (
    SELECT 1 FROM pharmacy_branches pb1, pharmacy_branches pb2
    WHERE pb1.id = from_branch_id 
    AND pb2.id = to_branch_id
    AND pb1.pharmacy_owner_id = pb2.pharmacy_owner_id
  )
);

-- Create index for better query performance
CREATE INDEX idx_medicine_transfers_from_branch ON public.medicine_transfers(from_branch_id);
CREATE INDEX idx_medicine_transfers_to_branch ON public.medicine_transfers(to_branch_id);
CREATE INDEX idx_medicine_transfers_medicine ON public.medicine_transfers(medicine_id);