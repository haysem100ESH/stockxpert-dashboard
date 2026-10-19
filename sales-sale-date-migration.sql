-- ============================================================================
-- Add `sale_date` to public.sales — business/accounting date for a sale
-- ============================================================================
-- Goal: let cashier pick the official accounting date for a sale transaction
-- while preserving the real system timestamps in created_at / updated_at.
--
-- SAFE FOR PRODUCTION:
--   * Column is added NULLable first
--   * Existing rows are backfilled to created_at::date
--   * Then DEFAULT + NOT NULL are applied
--   * No data loss, no schema-breaking change
--
-- Run statements one-by-one in the Supabase SQL editor.
-- ============================================================================

-- 1. Add column (nullable so existing rows are valid)
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS sale_date DATE;

-- 2. Backfill existing rows from created_at (date portion in UTC)
UPDATE public.sales
SET    sale_date = (created_at AT TIME ZONE 'UTC')::date
WHERE  sale_date IS NULL;

-- 3. Lock the contract: default = CURRENT_DATE, NOT NULL
ALTER TABLE public.sales
  ALTER COLUMN sale_date SET DEFAULT CURRENT_DATE;

ALTER TABLE public.sales
  ALTER COLUMN sale_date SET NOT NULL;

-- 4. Indexes for finance / dashboard / analytics filters
CREATE INDEX IF NOT EXISTS idx_sales_sale_date
  ON public.sales (sale_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_branch_sale_date
  ON public.sales (branch_id, sale_date DESC);

ANALYZE public.sales;
