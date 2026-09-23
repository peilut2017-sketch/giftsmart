// posthog-js is ~90 KB gzipped — a fifth of the app's initial JS, for analytics
// that has no business competing with first paint. The library is imported on
// demand after the app is interactive; anything captured before it lands is
// queued and replayed, so callers never have to care whether it is ready yet.
type PostHog = typeof import('posthog-js')['default']

const KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined
const HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined

let instance: PostHog | null = null
let loading: Promise<PostHog | null> | null = null
let queue: Array<(ph: PostHog) => void> = []

function load(): Promise<PostHog | null> {
  if (!KEY) return Promise.resolve(null)
  if (instance) return Promise.resolve(instance)
  if (loading) return loading
  loading = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST || 'https://app.posthog.com',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        session_recording: {
          // Gift-card codes and CVVs are bearer instruments: never let a session
          // replay ship them to a third party. Mask EVERY input by default (the old
          // opt-in via ph-no-capture covered only two fields), and mask displayed
          // secrets too — anything tagged ph-no-capture (code/CVV read-outs) or
          // rendered as monospace (all code displays in the app).
          maskAllInputs: true,
          maskTextSelector: '.ph-no-capture, .font-mono',
        },
      })
      instance = posthog
      queue.forEach(fn => { try { fn(posthog) } catch { /* analytics must never break a flow */ } })
      queue = []
      return posthog
    })
    .catch(() => null)   // blocked by an ad blocker / offline — not an app failure
  return loading
}

function withPostHog(fn: (ph: PostHog) => void) {
  if (!KEY) return
  if (instance) { try { fn(instance) } catch { /* ignore */ } return }
  if (queue.length < 50) queue.push(fn)   // bounded: never grow without a consumer
  void load()
}

export function initPostHog() {
  if (!KEY) return
  // Wait for idle so analytics loads behind the first interaction, not in front of it.
  const start = () => void load()
  if (typeof requestIdleCallback === 'function') requestIdleCallback(start, { timeout: 4000 })
  else setTimeout(start, 2000)
}

export function identifyUser(id: string, email?: string | null) {
  withPostHog(ph => ph.identify(id, { email: email ?? undefined }))
}

export function resetPostHog() {
  withPostHog(ph => ph.reset())
}

export function phCapture(event: string, props?: Record<string, unknown>) {
  withPostHog(ph => ph.capture(event, props))
}
