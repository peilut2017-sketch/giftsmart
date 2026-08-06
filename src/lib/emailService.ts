import { supabase } from './supabase'

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://giftsmart.site')

async function invoke(type: string, params: Record<string, unknown>) {
  const { error } = await supabase.functions.invoke('send-email', {
    body: { type, params: { ...params, app_url: APP_URL } },
  })
  if (error) throw error
}

export async function sendWelcomeEmail(params: {
  to_email: string
  to_name: string
}) {
  await invoke('welcome', params)
}

export async function sendInviteEmail(params: {
  to_email: string
  to_name: string
  from_name: string
  wallet_name: string
}) {
  await invoke('invite', params)
}

export async function sendExpiryReminderEmail(params: {
  to_email: string
  to_name: string
  count: number
  vouchers_list: string
}) {
  await invoke('expiry', params)
}

export async function sendVoucherSharedEmail(params: {
  to_email: string
  to_name: string
  from_name: string
  store_name: string
}) {
  await invoke('share', params)
}

export async function sendVoucherShareInviteEmail(params: {
  to_email: string
  from_name: string
  store_name: string
}) {
  await invoke('share_invite', params)
}

export async function sendGiftEmail(params: {
  to_email: string
  sender_name: string
  message?: string
  store_name: string
  balance: number
  gift_link: string
}) {
  await invoke('gift', params)
}
