-- =============================================================================
-- Pharmacy Active Ingredients Migration
-- Adds composition support: a medicine (e.g. "Snip") can have many active
-- ingredients (paracetamol, pseudoephedrine, chlorophenaramine ...).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.medicine_active_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  ingredient_name text NOT NULL,
  strength text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mai_medicine_id
  ON public.medicine_active_ingredients(medicine_id);

CREATE INDEX IF NOT EXISTS idx_mai_ingredient_name
  ON public.medicine_active_ingredients(lower(ingredient_name));

ALTER TABLE public.medicine_active_ingredients ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read (catalog metadata, like medicines table)
DROP POLICY IF EXISTS "mai_select_authenticated" ON public.medicine_active_ingredients;
CREATE POLICY "mai_select_authenticated"
  ON public.medicine_active_ingredients
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can insert/update/delete (mirrors medicines table policy)
DROP POLICY IF EXISTS "mai_write_authenticated" ON public.medicine_active_ingredients;
CREATE POLICY "mai_write_authenticated"
  ON public.medicine_active_ingredients
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
