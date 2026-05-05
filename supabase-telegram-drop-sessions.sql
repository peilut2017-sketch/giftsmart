-- Drop the telegram_sessions table — no longer needed after removing voucher management from the bot.
-- The bot now only sends notifications; multi-step conversation flows have been removed.
-- Apply in Supabase SQL Editor.

DROP TABLE IF EXISTS telegram_sessions;
