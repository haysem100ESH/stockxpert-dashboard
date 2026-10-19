-- Create view for low stock medicines to avoid column comparison issues
CREATE OR REPLACE VIEW low_stock_medicines AS
SELECT *
FROM medicines
WHERE stock_quantity > 0
AND stock_quantity <= minimum_stock_level;