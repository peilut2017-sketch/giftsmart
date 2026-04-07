-- Add actual_cost to vouchers (how much the user paid for the voucher)
-- value_percent is now auto-calculated from actual_cost / amount * 100
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS actual_cost NUMERIC(10,2);
