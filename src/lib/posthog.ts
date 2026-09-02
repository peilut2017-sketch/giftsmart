import posthog from 'posthog-js'

const KEY  = import.meta.env.VITE_POSTHOG_KEY  as string | undefined
const HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined

export function initPostHog() {
  if (!KEY) return
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
}

export function identifyUser(id: string, email?: string | null) {
  if (!KEY) return
  posthog.identify(id, { email: email ?? undefined })
}

export function resetPostHog() {
  if (!KEY) return
  posthog.reset()
}

export function phCapture(event: string, props?: Record<string, unknown>) {
  if (!KEY) return
  posthog.capture(event, props)
}
