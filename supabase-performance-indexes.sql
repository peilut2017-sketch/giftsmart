-- Performance indexes for GiftSmart
-- Run these in Supabase SQL editor to improve query performance at scale
-- Existing index: activity_log_user_idx on activity_log(user_id)

-- wallet_members: RLS policies filter by user_id; joins use wallet_id
CREATE INDEX IF NOT EXISTS wallet_members_user_id_idx ON wallet_members (user_id);
CREATE INDEX IF NOT EXISTS wallet_members_wallet_id_idx ON wallet_members (wallet_id);

-- vouchers: primary access pattern is wallet_id + is_archived filter
CREATE INDEX IF NOT EXISTS vouchers_wallet_id_idx ON vouchers (wallet_id);
CREATE INDEX IF NOT EXISTS vouchers_wallet_id_archived_idx ON vouchers (wallet_id, is_archived);
CREATE INDEX IF NOT EXISTS vouchers_user_id_idx ON vouchers (user_id);
CREATE INDEX IF NOT EXISTS vouchers_expiry_date_idx ON vouchers (expiry_date) WHERE expiry_date IS NOT NULL;

-- super_vouchers: fetched per wallet
CREATE INDEX IF NOT EXISTS super_vouchers_wallet_id_idx ON super_vouchers (wallet_id);

-- categories: fetched per wallet
CREATE INDEX IF NOT EXISTS categories_wallet_id_idx ON categories (wallet_id) WHERE wallet_id IS NOT NULL;

-- voucher_shares: RLS filters by shared_with_user_id; lookups by voucher_id
CREATE INDEX IF NOT EXISTS voucher_shares_shared_with_user_id_idx ON voucher_shares (shared_with_user_id);
CREATE INDEX IF NOT EXISTS voucher_shares_voucher_id_idx ON voucher_shares (voucher_id);

-- shared_voucher_tokens: token lookup + expiry cleanup
CREATE INDEX IF NOT EXISTS shared_voucher_tokens_token_idx ON shared_voucher_tokens (token);
CREATE INDEX IF NOT EXISTS shared_voucher_tokens_expires_at_idx ON shared_voucher_tokens (expires_at);

-- activity_log: lookups by voucher_id (undo, detail view)
CREATE INDEX IF NOT EXISTS activity_log_voucher_id_idx ON activity_log (voucher_id) WHERE voucher_id IS NOT NULL;

-- telegram: user_id lookup on every message; chat_id lookup for sessions
CREATE INDEX IF NOT EXISTS telegram_users_user_id_idx ON telegram_users (user_id);
CREATE INDEX IF NOT EXISTS telegram_sessions_chat_id_idx ON telegram_sessions (chat_id);
