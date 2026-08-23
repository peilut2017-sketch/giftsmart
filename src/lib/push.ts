import { supabase } from './supabase'

// Web Push subscription management. The server side lives in
// supabase-web-push.sql + supabase/functions/{send-push,push-expiry}.
// Without VITE_VAPID_PUBLIC_KEY configured, subscribeToPush reports
// 'unconfigured' and the app falls back to tab-open local notifications.

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window
}

export type PushSubscribeResult = 'subscribed' | 'unsupported' | 'unconfigured' | 'error'

/** Subscribe this device and register the subscription server-side. */
export async function subscribeToPush(): Promise<PushSubscribeResult> {
  if (!isPushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'unconfigured'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
    })
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'error'
    const { error } = await supabase.rpc('upsert_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 255),
    })
    if (error) return 'error'
    return 'subscribed'
  } catch {
    return 'error'
  }
}

/** Unsubscribe this device and remove it server-side. */
export async function unsubscribeFromPush(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const endpoint = sub.endpoint
    await sub.unsubscribe()
    await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint })
  } catch {
    // Best effort — a dead subscription is also pruned server-side on next send
  }
}

/**
 * Re-register the current subscription if one exists (keeps last_seen_at fresh
 * and heals a changed endpoint). Call on app start for users with push on.
 */
export async function refreshPushSubscription(): Promise<void> {
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) return
  try {
    if (Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (!sub) return
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
    await supabase.rpc('upsert_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: json.keys.p256dh,
      p_auth: json.keys.auth,
      p_user_agent: navigator.userAgent.slice(0, 255),
    })
  } catch {
    // Non-critical
  }
}
