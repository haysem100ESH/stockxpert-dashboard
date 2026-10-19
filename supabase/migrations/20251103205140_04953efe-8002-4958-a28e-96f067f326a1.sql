-- Add RLS policy for staff to view their pharmacy owner's subscription
CREATE POLICY "Staff can view their pharmacy owner's subscription"
ON public.pharmacy_subscriptions
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.pharmacy_branches pb
    JOIN public.profiles p ON p.branch_id = pb.id
    WHERE p.id = auth.uid()
    AND p.role = 'staff'
    AND pb.pharmacy_owner_id = pharmacy_subscriptions.pharmacy_owner_id
  )
);