-- Add payment_method and discount columns to sales table
ALTER TABLE public.sales ADD COLUMN payment_method TEXT;
ALTER TABLE public.sales ADD COLUMN discount_amount NUMERIC DEFAULT 0;