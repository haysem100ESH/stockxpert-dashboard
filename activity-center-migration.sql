-- =============================================================================
-- Activity Center & Staff Goal Management
-- =============================================================================
-- Run this once in Supabase SQL editor. Idempotent where possible.
-- =============================================================================

-- ---------- activity_log ----------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  branch_id uuid,
  activity_type text NOT NULL,
  entity_type text,
  entity_id text,
  previous_value jsonb,
  new_value jsonb,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_owner_created_idx ON public.activity_log (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_user_created_idx  ON public.activity_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_branch_created_idx ON public.activity_log (branch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_log_type_idx ON public.activity_log (activity_type);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS activity_log_select_own_or_owner ON public.activity_log;
CREATE POLICY activity_log_select_own_or_owner ON public.activity_log
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR owner_id = auth.uid()
  );

DROP POLICY IF EXISTS activity_log_insert_self ON public.activity_log;
CREATE POLICY activity_log_insert_self ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ---------- staff_goals ----------
CREATE TABLE IF NOT EXISTS public.staff_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL,
  goal_type text NOT NULL CHECK (goal_type IN ('daily','weekly','monthly','custom')),
  target_count integer NOT NULL CHECK (target_count > 0),
  start_date date,
  end_date date,
  assignment_scope text NOT NULL DEFAULT 'all' CHECK (assignment_scope IN ('all','branch','staff')),
  branch_id uuid,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS staff_goals_owner_idx ON public.staff_goals (owner_id, active);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_goals TO authenticated;
GRANT ALL ON public.staff_goals TO service_role;

ALTER TABLE public.staff_goals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_goals_owner_all ON public.staff_goals;
CREATE POLICY staff_goals_owner_all ON public.staff_goals
  FOR ALL TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Owners read all their goals directly (branch_id is NULL for owners, so no join).
-- Staff read goals scoped 'all' for their owner, 'branch' for their branch, or 'staff' assignments.
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

-- ---------- staff_goal_assignments ----------
CREATE TABLE IF NOT EXISTS public.staff_goal_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.staff_goals(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE (goal_id, staff_id)
);

CREATE INDEX IF NOT EXISTS sga_goal_idx ON public.staff_goal_assignments (goal_id);
CREATE INDEX IF NOT EXISTS sga_staff_idx ON public.staff_goal_assignments (staff_id);

GRANT SELECT, INSERT, DELETE ON public.staff_goal_assignments TO authenticated;
GRANT ALL ON public.staff_goal_assignments TO service_role;

ALTER TABLE public.staff_goal_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sga_owner_manage ON public.staff_goal_assignments;
CREATE POLICY sga_owner_manage ON public.staff_goal_assignments
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.staff_goals g WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.staff_goals g WHERE g.id = staff_goal_assignments.goal_id AND g.owner_id = auth.uid()));

DROP POLICY IF EXISTS sga_staff_select_self ON public.staff_goal_assignments;
CREATE POLICY sga_staff_select_self ON public.staff_goal_assignments
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid());

-- ---------- staff_goal_completions ----------
CREATE TABLE IF NOT EXISTS public.staff_goal_completions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES public.staff_goals(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  period_key text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, staff_id, period_key)
);

CREATE INDEX IF NOT EXISTS sgc_owner_idx ON public.staff_goal_completions (owner_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS sgc_staff_idx ON public.staff_goal_completions (staff_id, completed_at DESC);

GRANT SELECT, INSERT ON public.staff_goal_completions TO authenticated;
GRANT ALL ON public.staff_goal_completions TO service_role;

ALTER TABLE public.staff_goal_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sgc_select_own_or_owner ON public.staff_goal_completions;
CREATE POLICY sgc_select_own_or_owner ON public.staff_goal_completions
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR owner_id = auth.uid());

DROP POLICY IF EXISTS sgc_insert_self ON public.staff_goal_completions;
CREATE POLICY sgc_insert_self ON public.staff_goal_completions
  FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid());

-- ---------- helper: resolve_owner_id ----------
CREATE OR REPLACE FUNCTION public.resolve_owner_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN p.role = 'owner' THEN p.id
    ELSE (SELECT b.pharmacy_owner_id FROM public.pharmacy_branches b WHERE b.id = p.branch_id)
  END
  FROM public.profiles p
  WHERE p.id = _user_id
$$;

-- ---------- RPC: log_activity ----------
CREATE OR REPLACE FUNCTION public.log_activity(
  p_activity_type text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_previous jsonb DEFAULT NULL,
  p_new jsonb DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_branch uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT branch_id INTO v_branch FROM public.profiles WHERE id = v_user;
  v_owner := public.resolve_owner_id(v_user);
  IF v_owner IS NULL THEN v_owner := v_user; END IF;

  INSERT INTO public.activity_log (user_id, owner_id, branch_id, activity_type, entity_type, entity_id, previous_value, new_value, metadata)
  VALUES (v_user, v_owner, v_branch, p_activity_type, p_entity_type, p_entity_id, p_previous, p_new, p_metadata)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_activity(text, text, text, jsonb, jsonb, jsonb) TO authenticated;

-- ---------- RPC: record_goal_completion ----------
CREATE OR REPLACE FUNCTION public.record_goal_completion(p_goal_id uuid, p_period_key text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
BEGIN
  IF v_user IS NULL THEN RETURN NULL; END IF;
  SELECT owner_id INTO v_owner FROM public.staff_goals WHERE id = p_goal_id;
  IF v_owner IS NULL THEN RETURN NULL; END IF;

  INSERT INTO public.staff_goal_completions (goal_id, staff_id, owner_id, period_key)
  VALUES (p_goal_id, v_user, v_owner, p_period_key)
  ON CONFLICT (goal_id, staff_id, period_key) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_goal_completion(uuid, text) TO authenticated;

-- ---------- realtime ----------
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_log;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_goal_completions;
