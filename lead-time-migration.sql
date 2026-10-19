-- Adds configurable per-item lead time (in days) used by the Smart Inventory
-- reorder-point (ROP) calculation. Default 3 days.
ALTER TABLE public.medicines
  ADD COLUMN IF NOT EXISTS lead_time_days integer NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.medicines.lead_time_days IS
  'Typical supplier lead time in days for this item. Used to compute reorder point: ROP = ADC*leadTime + safetyStock.';
