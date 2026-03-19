import { supabase } from './supabase'

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

/**
 * Send a wallet invitation email via the send_invite_email Postgres function.
 * Requires pg_net extension and Resend API key in app_settings table.
 */
export async function sendInviteEmail(params: {
  to_email: string
  to_name: string
  from_name: string
  wallet_name: string
}) {
  const { error } = await supabase.rpc('send_invite_email', {
    p_to_email:    params.to_email,
    p_to_name:     params.to_name,
    p_from_name:   params.from_name,
    p_wallet_name: params.wallet_name,
    p_app_url:     APP_URL,
  })
  if (error) throw error
}

/**
 * Send an expiry reminder email via the send_expiry_reminder_email Postgres function.
 * Requires pg_net extension and Resend API key in app_settings table.
 */
export async function sendExpiryReminderEmail(params: {
  to_email: string
  to_name: string
  count: number
  vouchers_list: string
}) {
  const { error } = await supabase.rpc('send_expiry_reminder_email', {
    p_to_email:      params.to_email,
    p_to_name:       params.to_name,
    p_count:         params.count,
    p_vouchers_list: params.vouchers_list,
    p_app_url:       APP_URL,
  })
  if (error) throw error
}
