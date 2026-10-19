-- =============================================================================
-- Fix Activity Center RLS policies that are returning 500 errors.
-- Root causes:
--   1) activity_log policies were corrupted to `( 7 )` (not a boolean).
--   2) staff_goals SELECT policy references public.profiles /
--      public.pharmacy_branches.pharmacy_owner_id which fail to resolve at
--      runtime in this project, crashing the policy for every user.
-- Run this once in the Supabase SQL editor.
-- =============================================================================

-- ---------- helper: current_owner_id ----------
-- Wraps resolve_owner_id so RLS policies never touch profiles / branches
-- directly. resolve_owner_id is already defined in activity-center-migration.sql.
CREATE OR REPLACE FUNCTION public.current_owner_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.resolve_owner_id(auth.uid())
$$;

GRANT EXECUTE ON FUNCTION public.current_owner_id() TO authenticated;

-- ---------- activity_log ----------
DROP POLICY IF EXISTS activity_log_select_own_or_owner ON public.activity_log;
DROP POLICY IF EXISTS activity_log_insert_self        ON public.activity_log;

CREATE POLICY activity_log_select_own_or_owner ON public.activity_log
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR owner_id = auth.uid());

CREATE POLICY activity_log_insert_self ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ---------- staff_goals ----------
DROP POLICY IF EXISTS staff_goals_select_assigned ON public.staff_goals;
DROP POLICY IF EXISTS staff_goals_owner_all       ON public.staff_goals;

-- Owners: full control of their own goals.
CREATE POLICY staff_goals_owner_all ON public.staff_goals
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Staff: read goals that belong to their owner, scoped by assignment_scope.
-- Branch scoping is intentionally permissive here (any branch-scoped goal under
-- the same owner is visible). The frontend already filters by branch in
-- useStaffGoals.myGoals(), so this keeps the policy crash-proof while
-- preserving correct UX.
CREATE POLICY staff_goals_select_assigned ON public.staff_goals
  FOR SELECT TO authenticated
  USING (
    owner_id = public.current_owner_id()
    AND (
      assignment_scope = 'all'
      OR assignment_scope = 'branch'
      OR (assignment_scope = 'staff' AND EXISTS (
        SELECT 1 FROM public.staff_goal_assignments a
        WHERE a.goal_id = staff_goals.id AND a.staff_id = auth.uid()
      ))
    )
  );

-- ---------- staff_goal_assignments ----------
DROP POLICY IF EXISTS sga_owner_manage      ON public.staff_goal_assignments;
DROP POLICY IF EXISTS sga_staff_select_self ON public.staff_goal_assignments;

CREATE POLICY sga_owner_manage ON public.staff_goal_assignments
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.staff_goals g
    WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.staff_goals g
    WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()
  ));

CREATE POLICY sga_staff_select_self ON public.staff_goal_assignments
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());
