-- Tighten RLS to scope data to the logged-in owner's branches and staff's own branch

-- 1) pharmacy_branches: fix staff SELECT policy to only their owner's branches
DROP POLICY IF EXISTS "Staff can view branches of their owner" ON public.pharmacy_branches;
CREATE POLICY "Staff can view branches of their owner"
ON public.pharmacy_branches
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role = 'staff'
  )
  AND EXISTS (
    SELECT 1
    FROM public.pharmacy_branches sb
    WHERE sb.id = public.get_user_branch()
      AND sb.pharmacy_owner_id = pharmacy_branches.pharmacy_owner_id
  )
);

-- 2) sales: restrict SELECT to owner branches or staff branch
DROP POLICY IF EXISTS "All users can view sales" ON public.sales;
CREATE POLICY "Owners can view sales in their branches"
ON public.sales
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.pharmacy_branches pb
    WHERE pb.id = sales.branch_id
      AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can view sales in own branch"
ON public.sales
FOR SELECT
USING (
  sales.branch_id = public.get_user_branch()
);

-- 3) expenses: replace broad owner policy with branch-scoped owner + staff policies
DROP POLICY IF EXISTS "Owners can manage expenses" ON public.expenses;

CREATE POLICY "Owners can view own expenses"
ON public.expenses
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = expenses.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Owners can insert expenses for own branches"
ON public.expenses
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = expenses.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Owners can update expenses for own branches"
ON public.expenses
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = expenses.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = expenses.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Owners can delete expenses for own branches"
ON public.expenses
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = expenses.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

-- Staff policies (manage expenses only in their own branch)
CREATE POLICY "Staff can manage expenses in own branch"
ON public.expenses
FOR ALL
USING (expenses.branch_id = public.get_user_branch())
WITH CHECK (expenses.branch_id = public.get_user_branch());

-- 4) suppliers: scope to owner branches only
DROP POLICY IF EXISTS "Owners can manage suppliers" ON public.suppliers;
CREATE POLICY "Owners can manage own suppliers"
ON public.suppliers
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = suppliers.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = suppliers.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

-- 5) medicines: restrict read and write by branch ownership
DROP POLICY IF EXISTS "All users can view medicines" ON public.medicines;
DROP POLICY IF EXISTS "Owners can manage medicines" ON public.medicines;

CREATE POLICY "Owners can view medicines in their branches"
ON public.medicines
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = medicines.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can view medicines in own branch"
ON public.medicines
FOR SELECT
USING (medicines.branch_id = public.get_user_branch());

CREATE POLICY "Owners can manage medicines in their branches"
ON public.medicines
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = medicines.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.pharmacy_branches pb
    WHERE pb.id = medicines.branch_id AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can manage medicines in own branch"
ON public.medicines
FOR ALL
USING (medicines.branch_id = public.get_user_branch())
WITH CHECK (medicines.branch_id = public.get_user_branch());

-- 6) sale_items: scope via related sale's branch
DROP POLICY IF EXISTS "All users can view sale items" ON public.sale_items;
DROP POLICY IF EXISTS "All users can create sale items" ON public.sale_items;

CREATE POLICY "Owners can view sale_items in their branches"
ON public.sale_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    JOIN public.pharmacy_branches pb ON pb.id = s.branch_id
    WHERE s.id = sale_items.sale_id
      AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can view sale_items in own branch"
ON public.sale_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.branch_id = public.get_user_branch()
  )
);

CREATE POLICY "Owners can insert sale_items for own branches"
ON public.sale_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales s
    JOIN public.pharmacy_branches pb ON pb.id = s.branch_id
    WHERE s.id = sale_items.sale_id
      AND pb.pharmacy_owner_id = auth.uid()
  )
);

CREATE POLICY "Staff can insert sale_items in own branch"
ON public.sale_items
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND s.branch_id = public.get_user_branch()
  )
);
