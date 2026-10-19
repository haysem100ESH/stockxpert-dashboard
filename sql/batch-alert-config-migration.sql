-- ============================================================================
-- Per-batch alert configuration
-- ----------------------------------------------------------------------------
-- Adds optional, per-batch overrides for:
--   * min_stock_level     → triggers a low-stock alert when
--                           remaining_quantity <= min_stock_level
--   * expiry_alert_days   → triggers an expiry alert when the batch is within
--                           this many days of its expiry_date
--
-- Both are nullable. NULL = fall back to the medicine-level / global default.
-- Safe to run multiple times.
-- ============================================================================

ALTER TABLE public.inventory_batches
  ADD COLUMN IF NOT EXISTS min_stock_level   numeric,
  ADD COLUMN IF NOT EXISTS expiry_alert_days integer;

COMMENT ON COLUMN public.inventory_batches.min_stock_level IS
  'Per-batch low-stock threshold. NULL = no per-batch low-stock alert (falls back to medicine.minimum_stock_level at item level).';

COMMENT ON COLUMN public.inventory_batches.expiry_alert_days IS
  'Per-batch expiry alert window in days. NULL = use global expiry_alert_days setting.';

-- Optional partial index to speed up alert queries
CREATE INDEX IF NOT EXISTS idx_inventory_batches_min_stock
  ON public.inventory_batches (branch_id)
  WHERE min_stock_level IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_batches_alert_days
  ON public.inventory_batches (branch_id)
  WHERE expiry_alert_days IS NOT NULL;
