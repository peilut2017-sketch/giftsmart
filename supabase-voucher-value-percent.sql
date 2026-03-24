-- Add value_percent to vouchers (how much % of face value it's worth)
-- NULL = not set, 90 = worth 90% → display "10% פחות"
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS value_percent NUMERIC(5,2);

-- Add show_voucher_value toggle to user profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS show_voucher_value BOOLEAN DEFAULT FALSE;
