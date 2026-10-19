-- Allow confirmed branch inventory deletion to remove linked sale history safely.
-- The app already shows a destructive confirmation before deleting branch_items with sales.

DO $$
DECLARE
  existing_constraint_name text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_items'
      AND column_name = 'branch_item_id'
  ) THEN
    SELECT c.conname INTO existing_constraint_name
    FROM pg_constraint c
    JOIN pg_class child ON child.oid = c.conrelid
    JOIN pg_namespace child_ns ON child_ns.oid = child.relnamespace
    JOIN pg_attribute a ON a.attrelid = child.oid AND a.attnum = ANY(c.conkey)
    WHERE c.contype = 'f'
      AND child_ns.nspname = 'public'
      AND child.relname = 'sale_items'
      AND a.attname = 'branch_item_id'
      AND c.confrelid = 'public.branch_items'::regclass
    LIMIT 1;

    IF existing_constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.sale_items DROP CONSTRAINT %I', existing_constraint_name);
    END IF;

    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_branch_item_id_fkey
      FOREIGN KEY (branch_item_id)
      REFERENCES public.branch_items(id)
      ON DELETE CASCADE;
  END IF;
END $$;

DROP POLICY IF EXISTS "Owners can delete sale_items in their branches" ON public.sale_items;
DROP POLICY IF EXISTS "Staff can delete sale_items in own branch" ON public.sale_items;

CREATE POLICY "Owners can delete sale_items in their branches"
ON public.sale_items
FOR DELETE
USING (
  EXISTS (
    SELECT 1
    FROM public.sales s
    WHERE s.id = sale_items.sale_id
      AND public.user_owns_branch(s.branch_id)
  )
);
