import { supabase } from './supabase'

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

async function invoke(type: string, params: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke('send-email', {
    body: { type, params: { ...params, app_url: APP_URL } },
  })
  if (error) throw error
}

/**
 * Send a wallet invitation email via the send-email Edge Function.
 */
export async function sendInviteEmail(params: {
  to_email: string
  to_name: string
  from_name: string
  wallet_name: string
}) {
  await invoke('invite', params)
}

/**
 * Send an expiry reminder email via the send-email Edge Function.
 */
export async function sendExpiryReminderEmail(params: {
  to_email: string
  to_name: string
  count: number
  vouchers_list: string
}) {
  await invoke('expiry', params)
}
