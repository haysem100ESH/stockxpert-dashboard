-- ============================================================================
-- Pharmacy Grouping & Strength migration
-- Run this once in your Supabase SQL editor.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

-- 1. New columns on medicines (pharmacy-only fields, nullable)
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS medicine_group text,
  ADD COLUMN IF NOT EXISTS strength       text;

CREATE INDEX IF NOT EXISTS idx_medicines_group ON public.medicines (medicine_group);

-- 2. Owner-scoped medicine groups (pharmacy classification)
CREATE TABLE IF NOT EXISTS public.medicine_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_default  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE INDEX IF NOT EXISTS idx_medicine_groups_owner ON public.medicine_groups (owner_id);

ALTER TABLE public.medicine_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read default groups + own owner groups" ON public.medicine_groups;
CREATE POLICY "Anyone can read default groups + own owner groups"
  ON public.medicine_groups FOR SELECT
  USING (
    is_default = true
    OR owner_id = auth.uid()
    OR owner_id IN (
      SELECT pharmacy_owner_id FROM public.pharmacy_branches
      WHERE id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can insert their own groups" ON public.medicine_groups;
CREATE POLICY "Owners can insert their own groups"
  ON public.medicine_groups FOR INSERT
  WITH CHECK (owner_id = auth.uid() OR owner_id IN (
    SELECT pharmacy_owner_id FROM public.pharmacy_branches
    WHERE id = (SELECT branch_id FROM public.profiles WHERE id = auth.uid())
  ));

DROP POLICY IF EXISTS "Owners can delete their own groups" ON public.medicine_groups;
CREATE POLICY "Owners can delete their own groups"
  ON public.medicine_groups FOR DELETE
  USING (owner_id = auth.uid());

-- 3. Seed default pharmacy groups (visible to everyone)
INSERT INTO public.medicine_groups (owner_id, name, is_default) VALUES
  (NULL, 'NSAIDS and anti-pain', true),
  (NULL, 'Antibiotics',          true),
  (NULL, 'Antifungal',           true),
  (NULL, 'Antiviral',            true),
  (NULL, 'Antihistamines',       true),
  (NULL, 'Cardiovascular',       true),
  (NULL, 'Gastrointestinal',     true),
  (NULL, 'Respiratory',          true),
  (NULL, 'Dermatology (DERMA)',  true),
  (NULL, 'Diabetes',             true),
  (NULL, 'Vitamins & Supplements', true),
  (NULL, 'Hormones & Endocrine', true),
  (NULL, 'Ophthalmic',           true),
  (NULL, 'ENT',                  true),
  (NULL, 'Syrups',               true),
  (NULL, 'Injectables',          true),
  (NULL, 'Other',                true)
ON CONFLICT (owner_id, name) DO NOTHING;
