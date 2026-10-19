-- Drop existing problematic policies
DROP POLICY IF EXISTS "Staff can view branches of their owner" ON public.pharmacy_branches;
DROP POLICY IF EXISTS "Owners can manage their branches" ON public.pharmacy_branches;
DROP POLICY IF EXISTS "Owners can view medicines in their branches" ON public.medicines;
DROP POLICY IF EXISTS "Owners can manage medicines in their branches" ON public.medicines;
DROP POLICY IF EXISTS "Owners can view sales in their branches" ON public.sales;
DROP POLICY IF EXISTS "Owners can view sale_items in their branches" ON public.sale_items;
DROP POLICY IF EXISTS "Owners can insert sale_items for own branches" ON public.sale_items;
DROP POLICY IF EXISTS "Owners can view own expenses" ON public.expenses;
DROP POLICY IF EXISTS "Owners can insert expenses for own branches" ON public.expenses;
DROP POLICY IF EXISTS "Owners can update expenses for own branches" ON public.expenses;
DROP POLICY IF EXISTS "Owners can delete expenses for own branches" ON public.expenses;
DROP POLICY IF EXISTS "Owners can manage own suppliers" ON public.suppliers;

-- Create security definer function to get pharmacy owner id
CREATE OR REPLACE FUNCTION public.get_pharmacy_owner_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN (SELECT role FROM profiles WHERE id = auth.uid()) = 'owner' THEN auth.uid()
    WHEN (SELECT role FROM profiles WHERE id = auth.uid()) = 'staff' THEN 
      (SELECT pb.pharmacy_owner_id 
       FROM pharmacy_branches pb 
       WHERE pb.id = (SELECT branch_id FROM profiles WHERE id = auth.uid())
       LIMIT 1)
    ELSE NULL
  END;
$$;

-- Create security definer function to check branch ownership
CREATE OR REPLACE FUNCTION public.user_owns_branch(branch_id_param uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM pharmacy_branches pb
    WHERE pb.id = branch_id_param
    AND (
      pb.pharmacy_owner_id = auth.uid()
      OR pb.id = (SELECT branch_id FROM profiles WHERE id = auth.uid())
    )
  );
$$;

-- Recreate pharmacy_branches policies using simple checks
CREATE POLICY "Owners can manage their branches"
ON public.pharmacy_branches
FOR ALL
USING (pharmacy_owner_id = auth.uid())
WITH CHECK (pharmacy_owner_id = auth.uid());

CREATE POLICY "Staff can view branches of their owner"
ON public.pharmacy_branches
FOR SELECT
USING (id = get_user_branch() OR pharmacy_owner_id = get_pharmacy_owner_id());

-- Recreate medicines policies
CREATE POLICY "Owners can view medicines in their branches"
ON public.medicines
FOR SELECT
USING (user_owns_branch(branch_id));

CREATE POLICY "Owners can manage medicines in their branches"
ON public.medicines
FOR ALL
USING (user_owns_branch(branch_id))
WITH CHECK (user_owns_branch(branch_id));

-- Recreate sales policies
CREATE POLICY "Owners can view sales in their branches"
ON public.sales
FOR SELECT
USING (user_owns_branch(branch_id));

-- Recreate sale_items policies
CREATE POLICY "Owners can view sale_items in their branches"
ON public.sale_items
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM sales s
  WHERE s.id = sale_items.sale_id
  AND user_owns_branch(s.branch_id)
));

CREATE POLICY "Owners can insert sale_items for own branches"
ON public.sale_items
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM sales s
  WHERE s.id = sale_items.sale_id
  AND user_owns_branch(s.branch_id)
));

-- Recreate expenses policies
CREATE POLICY "Owners can view own expenses"
ON public.expenses
FOR SELECT
USING (user_owns_branch(branch_id));

CREATE POLICY "Owners can insert expenses for own branches"
ON public.expenses
FOR INSERT
WITH CHECK (user_owns_branch(branch_id));

CREATE POLICY "Owners can update expenses for own branches"
ON public.expenses
FOR UPDATE
USING (user_owns_branch(branch_id))
WITH CHECK (user_owns_branch(branch_id));

CREATE POLICY "Owners can delete expenses for own branches"
ON public.expenses
FOR DELETE
USING (user_owns_branch(branch_id));

-- Recreate suppliers policies
CREATE POLICY "Owners can manage own suppliers"
ON public.suppliers
FOR ALL
USING (user_owns_branch(branch_id))
WITH CHECK (user_owns_branch(branch_id));