-- ============================================================================
-- Smart Inventory: server-side aggregation RPC (v2 — WMA + Trend + ROP)
-- ----------------------------------------------------------------------------
-- Returns one row per branch_item with multi-window sales aggregates so the
-- client can compute a Weighted Moving Average, trend multiplier, and
-- expiry-adjusted reorder point without further round-trips.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_sales_smart_inventory_branch_created
  ON public.sales (branch_id, created_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_sale_items_smart_inventory_sale_medicine
  ON public.sale_items (sale_id, medicine_id);

CREATE INDEX IF NOT EXISTS idx_branch_items_branch
  ON public.branch_items (branch_id);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch_item_expiry
  ON public.inventory_batches (branch_item_id, expiry_date);

-- ============================================================================
CREATE OR REPLACE FUNCTION public.smart_inventory_summary(_branch_ids uuid[])
RETURNS TABLE (
  branch_item_id       uuid,
  medicine_id          uuid,
  name                 text,
  category             text,
  branch_id            uuid,
  stock_quantity       numeric,
  minimum_stock_level  numeric,
  lead_time_days       integer,
  expiry_date          date,
  selling_price        numeric,
  item_type            text,
  qty_7                numeric,
  qty_14               numeric,
  qty_21               numeric,
  qty_30               numeric,
  qty_60               numeric,
  last_sale_date       timestamptz,
  monthly_qty          int[],
  expiring_soon_qty    numeric   -- sum of batch remaining_qty expiring within lead time
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  accessible_branches AS (
    SELECT pb.id
    FROM public.pharmacy_branches pb
    WHERE pb.id = ANY(_branch_ids)
      AND (
        pb.pharmacy_owner_id = auth.uid()
        OR pb.id = (SELECT p.branch_id FROM public.profiles p WHERE p.id = auth.uid())
      )
  ),
  recent AS (
    SELECT
      s.branch_id,
      si.medicine_id,
      SUM( CASE WHEN s.created_at >= now() - interval '7 days'
                THEN COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0)
                ELSE 0 END ) AS qty_7,
      SUM( CASE WHEN s.created_at >= now() - interval '14 days'
                THEN COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0)
                ELSE 0 END ) AS qty_14,
      SUM( CASE WHEN s.created_at >= now() - interval '21 days'
                THEN COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0)
                ELSE 0 END ) AS qty_21,
      SUM( CASE WHEN s.created_at >= now() - interval '30 days'
                THEN COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0)
                ELSE 0 END ) AS qty_30,
      SUM( COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0) ) AS qty_60,
      MAX(s.created_at) AS last_sale_date
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN accessible_branches ab ON ab.id = s.branch_id
      AND s.created_at >= now() - interval '60 days'
    GROUP BY s.branch_id, si.medicine_id
  ),
  monthly AS (
    SELECT
      s.branch_id,
      si.medicine_id,
      EXTRACT(MONTH FROM s.created_at)::int - 1 AS m_idx,
      SUM( COALESCE(NULLIF(COALESCE(si.pack_quantity,0)+COALESCE(si.strip_quantity,0),0), si.quantity, 0) ) AS qty
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    JOIN accessible_branches ab ON ab.id = s.branch_id
      AND s.created_at >= now() - interval '365 days'
    GROUP BY s.branch_id, si.medicine_id, EXTRACT(MONTH FROM s.created_at)
  ),
  monthly_arr AS (
    SELECT
      branch_id,
      medicine_id,
      ( SELECT array_agg(COALESCE(q.qty, 0)::int ORDER BY g.m)
        FROM generate_series(0,11) g(m)
        LEFT JOIN monthly q
          ON q.branch_id = monthly.branch_id AND q.medicine_id = monthly.medicine_id AND q.m_idx = g.m
      ) AS monthly_qty
    FROM monthly
    GROUP BY branch_id, medicine_id
  ),
  expiring AS (
    -- Sum of batch remaining_quantity expiring within this item's lead-time window.
    SELECT
      ib.branch_item_id,
      SUM(ib.remaining_quantity) AS qty
    FROM public.inventory_batches ib
    JOIN public.branch_items bi ON bi.id = ib.branch_item_id
    JOIN public.medicines m ON m.id = bi.medicine_id
    JOIN accessible_branches ab ON ab.id = bi.branch_id
    WHERE ib.expiry_date IS NOT NULL
      AND ib.remaining_quantity > 0
      AND ib.expiry_date <= (CURRENT_DATE + (COALESCE(m.lead_time_days, 3) || ' days')::interval)::date
    GROUP BY ib.branch_item_id
  )
  SELECT
    bi.id                                  AS branch_item_id,
    bi.medicine_id,
    m.name,
    COALESCE(m.category, 'Uncategorized')  AS category,
    bi.branch_id,
    bi.quantity                            AS stock_quantity,
    COALESCE(m.minimum_stock_level, 0)     AS minimum_stock_level,
    COALESCE(m.lead_time_days, 3)          AS lead_time_days,
    bi.expiry_date,
    bi.selling_price,
    m.item_type,
    COALESCE(r.qty_7,  0) AS qty_7,
    COALESCE(r.qty_14, 0) AS qty_14,
    COALESCE(r.qty_21, 0) AS qty_21,
    COALESCE(r.qty_30, 0) AS qty_30,
    COALESCE(r.qty_60, 0) AS qty_60,
    r.last_sale_date,
    COALESCE(ma.monthly_qty, ARRAY[0,0,0,0,0,0,0,0,0,0,0,0]) AS monthly_qty,
    COALESCE(e.qty, 0)                     AS expiring_soon_qty
  FROM public.branch_items bi
  JOIN public.medicines m ON m.id = bi.medicine_id
  LEFT JOIN recent      r  ON r.branch_id = bi.branch_id AND r.medicine_id  = bi.medicine_id
  LEFT JOIN monthly_arr ma ON ma.branch_id = bi.branch_id AND ma.medicine_id = bi.medicine_id
  LEFT JOIN expiring    e  ON e.branch_item_id = bi.id
  JOIN accessible_branches ab ON ab.id = bi.branch_id;
$$;

GRANT EXECUTE ON FUNCTION public.smart_inventory_summary(uuid[])
  TO anon, authenticated;
