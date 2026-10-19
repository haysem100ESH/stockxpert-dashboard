-- Fix the security issue by recreating the view without SECURITY DEFINER
DROP VIEW IF EXISTS low_stock_medicines;

-- Create view for low stock medicines without SECURITY DEFINER
CREATE VIEW low_stock_medicines AS
SELECT *
FROM medicines
WHERE stock_quantity > 0
AND stock_quantity <= minimum_stock_level;

-- Enable RLS on the view since it inherits from medicines table
ALTER VIEW low_stock_medicines SET (security_invoker = true);