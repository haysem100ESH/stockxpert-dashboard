-- Drop the existing overly permissive insert policy
DROP POLICY IF EXISTS "All users can create sales" ON sales;

-- Create proper insert policies for owners and staff
CREATE POLICY "Owners can create sales for their branches"
ON sales
FOR INSERT
TO authenticated
WITH CHECK (
  user_owns_branch(branch_id)
);

CREATE POLICY "Staff can create sales in their branch"
ON sales
FOR INSERT
TO authenticated
WITH CHECK (
  branch_id = get_user_branch()
);