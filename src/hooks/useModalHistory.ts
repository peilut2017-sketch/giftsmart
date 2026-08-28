import { useEffect, useRef } from 'react'

const MODAL_STATE_KEY = '__gsModal'

/**
 * Makes the hardware/browser Back button close an open modal instead of
 * leaving the flow — the single biggest "website vs. app" tell on Android.
 *
 * While `open` is true, one history entry (tagged with this instance's id)
 * sits on top of the stack:
 * - Back pops it → ONE shared popstate listener closes only the TOPMOST open
 *   modal. (Per-instance listeners used to fire for every pop, so closing an
 *   inner sheet — e.g. vault setup inside the add-voucher form — also told the
 *   outer form "the user pressed Back" and popped its discard confirm.)
 * - Closing through the UI → cleanup consumes this instance's entry with
 *   history.back(), suppressing the resulting popstate so no other open modal
 *   mistakes it for a user Back press.
 */

type StackEntry = { id: number; onClose: () => void }

let stack: StackEntry[] = []
let nextId = 1
// Counter (not boolean): two modals closing programmatically in the same frame
// queue two pops — each must consume exactly one suppression.
let suppressPops = 0
let listenerAttached = false

function ensureListener() {
  if (listenerAttached || typeof window === 'undefined') return
  listenerAttached = true
  window.addEventListener('popstate', () => {
    if (suppressPops > 0) {
      suppressPops--
      return
    }
    // A real Back press consumes the topmost modal entry — only it closes.
    const top = stack.pop()
    top?.onClose()
  })
}

export function useModalHistory(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose })

  useEffect(() => {
    if (!open) return
    ensureListener()
    const id = nextId++
    const entry: StackEntry = { id, onClose: () => onCloseRef.current() }
    stack.push(entry)
    // Minimal state object — copying the router's state (usr/key/idx) into a
    // duplicate entry would confuse React Router's position tracking
    window.history.pushState({ [MODAL_STATE_KEY]: id }, '')

    return () => {
      const idx = stack.indexOf(entry)
      // Not in the stack anymore → Back already consumed this entry (onClose
      // came from the pop itself); nothing to clean up.
      if (idx === -1) return
      stack.splice(idx, 1)
      // Consume our history entry ONLY if it is still the top one — if the app
      // navigated (or an inner modal is still open above us), popping would
      // undo the wrong entry.
      if (window.history.state?.[MODAL_STATE_KEY] === id) {
        suppressPops++
        window.history.back()
      }
    }
  }, [open])
}
