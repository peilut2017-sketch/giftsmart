import emailjs from '@emailjs/browser'

const SERVICE_ID = import.meta.env.VITE_EMAILJS_SERVICE_ID || ''
const PUBLIC_KEY = import.meta.env.VITE_EMAILJS_PUBLIC_KEY || ''
const TEMPLATE_INVITE = import.meta.env.VITE_EMAILJS_TEMPLATE_INVITE || ''
const TEMPLATE_EXPIRY = import.meta.env.VITE_EMAILJS_TEMPLATE_EXPIRY || ''
const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

function isConfigured(templateId: string) {
  return !!(SERVICE_ID && PUBLIC_KEY && templateId)
}

/**
 * Send a wallet invitation email.
 * EmailJS template variables: {{to_email}}, {{to_name}}, {{from_name}}, {{wallet_name}}, {{app_url}}
 */
export async function sendInviteEmail(params: {
  to_email: string
  to_name: string
  from_name: string
  wallet_name: string
}) {
  if (!isConfigured(TEMPLATE_INVITE)) return
  await emailjs.send(SERVICE_ID, TEMPLATE_INVITE, { ...params, app_url: APP_URL }, PUBLIC_KEY)
}

/**
 * Send an expiry reminder email.
 * EmailJS template variables: {{to_email}}, {{to_name}}, {{count}}, {{vouchers_list}}, {{app_url}}
 */
export async function sendExpiryReminderEmail(params: {
  to_email: string
  to_name: string
  count: number
  vouchers_list: string
}) {
  if (!isConfigured(TEMPLATE_EXPIRY)) return
  await emailjs.send(SERVICE_ID, TEMPLATE_EXPIRY, { ...params, app_url: APP_URL }, PUBLIC_KEY)
}
