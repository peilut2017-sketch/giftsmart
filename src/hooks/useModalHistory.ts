import { useEffect, useRef } from 'react'

const MODAL_STATE_KEY = '__gsModal'

/**
 * Makes the hardware/browser Back button close an open modal instead of
 * leaving the flow — the single biggest "website vs. app" tell on Android.
 *
 * While `open` is true, one history entry (tagged) sits on top of the stack:
 * - Back pops it → we call onClose. The entry is consumed by the pop itself.
 * - Closing through the UI → cleanup consumes our entry with history.back(),
 *   but ONLY if it is still the top entry (checked via the state tag) — if the
 *   app navigated while the modal was open, the router owns the top entry and
 *   popping it would undo that navigation.
 */
export function useModalHistory(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    let closedByPop = false
    // Minimal state object — copying the router's state (usr/key/idx) into a
    // duplicate entry would confuse React Router's position tracking
    window.history.pushState({ [MODAL_STATE_KEY]: true }, '')

    const onPop = () => {
      closedByPop = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPop)

    return () => {
      window.removeEventListener('popstate', onPop)
      if (!closedByPop && window.history.state?.[MODAL_STATE_KEY]) {
        window.history.back()
      }
    }
  }, [open])
}
