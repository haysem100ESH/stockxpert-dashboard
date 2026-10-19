-- =============================================================================
-- Fix: allow staff to create / update / delete medicine_codes for their owner
-- =============================================================================
-- Problem: the existing write policy on public.medicine_codes only allows
--   owner_id = auth.uid()
-- so staff (whose auth.uid() != owner_id) get an RLS error when creating codes
-- from the staff portal.
--
-- Fix: split the ALL policy into per-command policies that also accept staff
-- whose profile.branch_id belongs to one of the owner's branches.
-- =============================================================================

-- Drop the old combined write policy
DROP POLICY IF EXISTS "medicine_codes_write_owner" ON public.medicine_codes;

-- Helper predicate (inline): staff of this owner OR the owner themselves
-- We re-use it across INSERT/UPDATE/DELETE.

-- INSERT
CREATE POLICY "medicine_codes_insert_owner_or_staff"
  ON public.medicine_codes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.pharmacy_branches b
        ON b.pharmacy_owner_id = medicine_codes.owner_id
      WHERE p.id = auth.uid()
        AND p.branch_id = b.id
    )
  );

-- UPDATE
CREATE POLICY "medicine_codes_update_owner_or_staff"
  ON public.medicine_codes
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.pharmacy_branches b
        ON b.pharmacy_owner_id = medicine_codes.owner_id
      WHERE p.id = auth.uid()
        AND p.branch_id = b.id
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.pharmacy_branches b
        ON b.pharmacy_owner_id = medicine_codes.owner_id
      WHERE p.id = auth.uid()
        AND p.branch_id = b.id
    )
  );

-- DELETE
CREATE POLICY "medicine_codes_delete_owner_or_staff"
  ON public.medicine_codes
  FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.pharmacy_branches b
        ON b.pharmacy_owner_id = medicine_codes.owner_id
      WHERE p.id = auth.uid()
        AND p.branch_id = b.id
    )
  );

-- Ensure grants are present (no-op if already granted)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medicine_codes TO authenticated;
GRANT ALL ON public.medicine_codes TO service_role;
