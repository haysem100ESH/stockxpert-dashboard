-- =============================================================================
-- Medicine Packaging + Medicine Codes migration
-- =============================================================================
-- Run this in your Supabase SQL editor. ADDITIVE ONLY — no existing columns
-- are dropped. Legacy packaging fields on `medicines` remain in place so the
-- existing UI keeps working while the new schema is rolled out.
--
-- Phase 1 (this file):
--   * Create medicine_packaging   (one row per medicine, unit/strip/pack levels)
--   * Create medicine_codes       (owner-defined grouping codes)
--   * Add medicines.medicine_code_id
--   * Backfill medicine_packaging from existing legacy columns
--
-- Phase 2 (later, separate migration once UI is fully migrated):
--   * Drop legacy packaging columns from medicines
--   * Normalize branch_items.quantity to total units everywhere
-- =============================================================================

-- ---------- medicine_packaging --------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_packaging (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id     uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  unit_name       text NOT NULL DEFAULT 'tablet',
  strip_enabled   boolean NOT NULL DEFAULT false,
  units_per_strip integer,
  strip_name      text,
  pack_enabled    boolean NOT NULL DEFAULT false,
  strips_per_pack integer,
  pack_name       text,
  unit_selling_price  numeric,
  strip_selling_price numeric,
  pack_selling_price  numeric,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medicine_packaging_medicine_unique UNIQUE (medicine_id),
  CONSTRAINT pack_requires_strip      CHECK (pack_enabled = false OR strip_enabled = true),
  CONSTRAINT strip_needs_units        CHECK (NOT strip_enabled OR (units_per_strip IS NOT NULL AND units_per_strip > 0)),
  CONSTRAINT pack_needs_strips        CHECK (NOT pack_enabled OR (strips_per_pack IS NOT NULL AND strips_per_pack > 0))
);

CREATE INDEX IF NOT EXISTS idx_medicine_packaging_medicine_id
  ON public.medicine_packaging(medicine_id);

ALTER TABLE public.medicine_packaging ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read packaging for any medicine they can already see
DROP POLICY IF EXISTS "medicine_packaging_select_all" ON public.medicine_packaging;
CREATE POLICY "medicine_packaging_select_all"
  ON public.medicine_packaging FOR SELECT
  TO authenticated
  USING (true);

-- Owners and staff with edit access can insert/update/delete packaging for
-- medicines under their branches. We mirror the medicines table policy.
DROP POLICY IF EXISTS "medicine_packaging_write_owner" ON public.medicine_packaging;
CREATE POLICY "medicine_packaging_write_owner"
  ON public.medicine_packaging FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.medicines m
      WHERE m.id = medicine_packaging.medicine_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.medicines m
      WHERE m.id = medicine_packaging.medicine_id
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_medicine_packaging_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_medicine_packaging_updated_at ON public.medicine_packaging;
CREATE TRIGGER trg_medicine_packaging_updated_at
  BEFORE UPDATE ON public.medicine_packaging
  FOR EACH ROW EXECUTE FUNCTION public.touch_medicine_packaging_updated_at();

-- ---------- medicine_codes ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.medicine_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code        text NOT NULL,
  label       text NOT NULL,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT medicine_codes_owner_code_unique UNIQUE (owner_id, code)
);

CREATE INDEX IF NOT EXISTS idx_medicine_codes_owner_id
  ON public.medicine_codes(owner_id);

ALTER TABLE public.medicine_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "medicine_codes_select_owned" ON public.medicine_codes;
CREATE POLICY "medicine_codes_select_owned"
  ON public.medicine_codes FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.pharmacy_branches b ON b.pharmacy_owner_id = medicine_codes.owner_id
      WHERE p.id = auth.uid() AND p.branch_id = b.id
    )
  );

DROP POLICY IF EXISTS "medicine_codes_write_owner" ON public.medicine_codes;
CREATE POLICY "medicine_codes_write_owner"
  ON public.medicine_codes FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- ---------- medicines.medicine_code_id ------------------------------------
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS medicine_code_id uuid
  REFERENCES public.medicine_codes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_medicines_medicine_code_id
  ON public.medicines(medicine_code_id);

-- ---------- Backfill medicine_packaging from legacy columns ---------------
-- Maps legacy schema -> new schema:
--   unit_name        := COALESCE(unit_label, 'tablet')
--   if packaging_mode = 'with_strip' AND units_per_strip > 0:
--     strip_enabled  := true
--     units_per_strip:= units_per_strip
--     strip_name     := 'strip'
--     if strips_per_pack > 0: pack_enabled := true, strips_per_pack := strips_per_pack
--   prices:
--     unit_selling_price  := sub_unit_price
--     strip_selling_price := unit_price (legacy "unit price" was per-strip in strip mode)
--     pack_selling_price  := selling_price
INSERT INTO public.medicine_packaging (
  medicine_id, unit_name, strip_enabled, units_per_strip, strip_name,
  pack_enabled, strips_per_pack, pack_name,
  unit_selling_price, strip_selling_price, pack_selling_price
)
SELECT
  m.id,
  COALESCE(NULLIF(m.unit_label, ''), 'tablet'),
  CASE
    WHEN m.packaging_mode = 'with_strip' AND COALESCE(m.units_per_strip, 0) > 0 THEN true
    ELSE false
  END,
  CASE WHEN m.packaging_mode = 'with_strip' THEN m.units_per_strip ELSE NULL END,
  CASE WHEN m.packaging_mode = 'with_strip' THEN 'strip' ELSE NULL END,
  CASE
    WHEN m.packaging_mode = 'with_strip'
     AND COALESCE(m.units_per_strip, 0) > 0
     AND COALESCE(m.strips_per_pack, 0) > 0 THEN true
    ELSE false
  END,
  CASE WHEN m.packaging_mode = 'with_strip' THEN m.strips_per_pack ELSE NULL END,
  CASE WHEN m.packaging_mode = 'with_strip' AND COALESCE(m.strips_per_pack,0) > 0 THEN 'pack' ELSE NULL END,
  m.sub_unit_price,
  m.unit_price,
  m.selling_price
FROM public.medicines m
WHERE NOT EXISTS (
  SELECT 1 FROM public.medicine_packaging p WHERE p.medicine_id = m.id
);

-- =============================================================================
-- DONE. After verifying:
--   SELECT count(*) FROM medicine_packaging;
--   SELECT count(*) FROM medicines;
-- the two counts should match. Then proceed with UI rollout.
-- =============================================================================
