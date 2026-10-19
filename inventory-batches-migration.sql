-- Create inventory_batches table for batch-level inventory tracking
CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES public.pharmacy_branches(id) ON DELETE CASCADE,
  medicine_id uuid NOT NULL REFERENCES public.medicines(id) ON DELETE CASCADE,
  branch_item_id uuid REFERENCES public.branch_items(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  batch_number text,
  quantity numeric NOT NULL DEFAULT 0,
  remaining_quantity numeric NOT NULL DEFAULT 0,
  purchase_price numeric NOT NULL DEFAULT 0,
  selling_price numeric NOT NULL DEFAULT 0,
  expiry_date date,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Create sale_item_batches table for tracking which batches were used in a sale
CREATE TABLE IF NOT EXISTS public.sale_item_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  quantity numeric NOT NULL,
  purchase_price numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch ON public.inventory_batches(branch_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_medicine ON public.inventory_batches(medicine_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_branch_item ON public.inventory_batches(branch_item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_expiry ON public.inventory_batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_inventory_batches_remaining ON public.inventory_batches(remaining_quantity);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_sale_item ON public.sale_item_batches(sale_item_id);
CREATE INDEX IF NOT EXISTS idx_sale_item_batches_batch ON public.sale_item_batches(batch_id);

-- Enable RLS
ALTER TABLE public.inventory_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_item_batches ENABLE ROW LEVEL SECURITY;

-- RLS policies for inventory_batches
CREATE POLICY "Users can view inventory batches" ON public.inventory_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert inventory batches" ON public.inventory_batches
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update inventory batches" ON public.inventory_batches
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can delete inventory batches" ON public.inventory_batches
  FOR DELETE TO authenticated USING (true);

-- RLS policies for sale_item_batches
CREATE POLICY "Users can view sale item batches" ON public.sale_item_batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can insert sale item batches" ON public.sale_item_batches
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update sale item batches" ON public.sale_item_batches
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can delete sale item batches" ON public.sale_item_batches
  FOR DELETE TO authenticated USING (true);
