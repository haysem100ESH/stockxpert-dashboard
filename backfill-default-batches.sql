-- Backfill: for every branch_item with stock but no batches, create a default batch.
-- Safe to re-run: only inserts where no batch exists for the branch_item.
INSERT INTO public.inventory_batches (
  branch_id, medicine_id, branch_item_id,
  batch_number, quantity, remaining_quantity,
  purchase_price, selling_price, expiry_date, created_at
)
SELECT
  bi.branch_id,
  bi.medicine_id,
  bi.id,
  COALESCE(m.batch_number, 'DEFAULT'),
  bi.quantity,
  bi.quantity,
  COALESCE(bi.purchase_price, 0),
  COALESCE(bi.selling_price, 0),
  bi.expiry_date,
  now()
FROM public.branch_items bi
LEFT JOIN public.medicines m ON m.id = bi.medicine_id
WHERE bi.quantity > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_batches ib WHERE ib.branch_item_id = bi.id
  );
