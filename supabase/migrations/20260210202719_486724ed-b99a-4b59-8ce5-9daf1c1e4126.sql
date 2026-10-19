
-- Add branch_type to pharmacy_branches (default 'pharmacy' for backward compatibility)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'pharmacy_branches' AND column_name = 'branch_type') THEN
    ALTER TABLE public.pharmacy_branches ADD COLUMN branch_type text NOT NULL DEFAULT 'pharmacy';
  END IF;
END $$;

-- Add constraint for valid branch types
ALTER TABLE public.pharmacy_branches DROP CONSTRAINT IF EXISTS pharmacy_branches_branch_type_check;
ALTER TABLE public.pharmacy_branches ADD CONSTRAINT pharmacy_branches_branch_type_check CHECK (branch_type IN ('pharmacy', 'general'));

-- Rename stripes_per_pack to units_per_pack on medicines
ALTER TABLE public.medicines RENAME COLUMN stripes_per_pack TO units_per_pack;

-- Rename open_pack_stripes to open_pack_units on medicines
ALTER TABLE public.medicines RENAME COLUMN open_pack_stripes TO open_pack_units;

-- Add unit_label column (default 'strip' for backward compatibility)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'medicines' AND column_name = 'unit_label') THEN
    ALTER TABLE public.medicines ADD COLUMN unit_label text NOT NULL DEFAULT 'strip';
  END IF;
END $$;
