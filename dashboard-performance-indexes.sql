-- ============================================================================
-- Dashboard Performance Indexes
-- ============================================================================
-- Goal: bring the dashboard aggregation queries (sales totals per branch,
-- branch inventory lookups, sale-item rollups) under 100ms even on large
-- datasets.
--
-- All indexes use IF NOT EXISTS so this script is safe to re-run.
-- CONCURRENTLY is used so production traffic is NOT blocked while building.
-- (Run each statement individually in the Supabase SQL editor — CONCURRENTLY
--  cannot run inside a transaction block.)
-- ============================================================================

-- 1. branch_items: nearly every inventory query filters by branch_id.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_branch_items_branch_id
  ON public.branch_items (branch_id);

-- Helpful secondary: lookups by (branch_id, medicine_id) for joins/upserts.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_branch_items_branch_medicine
  ON public.branch_items (branch_id, medicine_id);

-- 2. sales: dashboard aggregates by branch within a date window.
--    A composite (branch_id, created_at DESC) index serves both the equality
--    filter and the range scan in a single index lookup.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_branch_created_at
  ON public.sales (branch_id, created_at DESC);

-- 3. sale_items: every rollup joins on sales_id; also queried by medicine_id
--    + created_at for seasonal / demand analytics.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_sales_id
  ON public.sale_items (sales_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sale_items_medicine_created_at
  ON public.sale_items (medicine_id, created_at DESC);

-- 4. pharmacy_branches: looked up by owner on every page load.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pharmacy_branches_owner
  ON public.pharmacy_branches (pharmacy_owner_id);

-- ============================================================================
-- Refresh planner stats so the new indexes are picked up immediately.
-- ============================================================================
ANALYZE public.branch_items;
ANALYZE public.sales;
ANALYZE public.sale_items;
ANALYZE public.pharmacy_branches;
