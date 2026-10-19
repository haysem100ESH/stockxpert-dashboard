-- Add stripe-related columns to medicines table
ALTER TABLE medicines 
ADD COLUMN stripes_per_pack INTEGER,
ADD COLUMN open_pack_stripes INTEGER DEFAULT 0;

COMMENT ON COLUMN medicines.stripes_per_pack IS 'Number of stripes (smaller units) in one full pack. NULL means medicine is not sold by stripe.';
COMMENT ON COLUMN medicines.open_pack_stripes IS 'Number of stripes remaining in the currently opened pack. 0 means no open pack.';

-- Add sale type tracking columns to sale_items table
ALTER TABLE sale_items
ADD COLUMN sale_type TEXT DEFAULT 'full_pack' CHECK (sale_type IN ('full_pack', 'by_stripe')),
ADD COLUMN stripes_sold INTEGER;

COMMENT ON COLUMN sale_items.sale_type IS 'Type of sale: full_pack or by_stripe';
COMMENT ON COLUMN sale_items.stripes_sold IS 'Number of stripes sold (only used when sale_type is by_stripe)';