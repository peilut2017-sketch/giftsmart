-- Add item_name column to vouchers: stores the name of the item/service when
-- the voucher represents a product rather than a monetary value.
-- amount column stores the optional monetary value of the item (0 = not set).
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS item_name TEXT;
