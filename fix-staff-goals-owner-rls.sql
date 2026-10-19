-- Fix: owners (role='owner', branch_id NULL) were blocked from staff_goals SELECT
-- because the previous policy LEFT JOIN on pharmacy_branches via p.branch_id
-- evaluated to NULL for owners. Allow owner_id = auth.uid() directly.

DROP POLICY IF EXISTS staff_goals_select_assigned ON public.staff_goals;

CREATE POLICY staff_goals_select_assigned ON public.staff_goals
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.pharmacy_branches b ON b.id = p.branch_id
      WHERE p.id = auth.uid()
        AND p.role != 'owner'
        AND b.pharmacy_owner_id = staff_goals.owner_id
        AND (
          staff_goals.assignment_scope = 'all'
          OR (staff_goals.assignment_scope = 'branch' AND staff_goals.branch_id = p.branch_id)
          OR (staff_goals.assignment_scope = 'staff' AND EXISTS (
            SELECT 1 FROM public.staff_goal_assignments a
            WHERE a.goal_id = staff_goals.id AND a.staff_id = auth.uid()
          ))
        )
    )
  );
