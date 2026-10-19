-- Smart item matching for transfer requests
-- Apply once via Supabase SQL editor.
--
-- Adds explicit destination mapping at request time so the fulfilling owner
-- knows which medicine row in the destination branch the transfer should
-- merge into, and whether to add into an existing batch or create a new one.

ALTER TABLE public.transfer_request_items
  ADD COLUMN IF NOT EXISTS target_medicine_id uuid REFERENCES public.medicines(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS target_batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS create_new_batch boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS new_batch_number text,
  ADD COLUMN IF NOT EXISTS new_batch_expiry date,
  ADD COLUMN IF NOT EXISTS new_batch_purchase_price numeric;

CREATE INDEX IF NOT EXISTS idx_transfer_request_items_target_medicine
  ON public.transfer_request_items(target_medicine_id);
