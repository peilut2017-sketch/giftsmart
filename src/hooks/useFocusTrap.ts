import { useEffect } from 'react'
import type { RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Keeps Tab inside a modal and wires Escape to close it.
 *
 * The element list is re-queried on every Tab rather than snapshotted on open:
 * the add-voucher sheet is a wizard whose fields change between steps, so a
 * list captured at mount would wrap against controls that no longer exist.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement | null>,
  { active = true, onEscape }: { active?: boolean; onEscape?: () => void } = {},
) {
  useEffect(() => {
    if (!active) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = ref.current
      if (!el) return
      if (e.key === 'Escape') {
        // A nested confirm (discard guard, destructive action) owns Escape while it
        // is open — handling it here too would cancel that dialog and immediately
        // re-trigger the flow that opened it.
        if (!onEscape || el.querySelector('[role="dialog"], [role="alertdialog"]')) return
        e.preventDefault()
        onEscape()
        return
      }
      if (e.key !== 'Tab') return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(n => n.offsetParent !== null || n === document.activeElement)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement as HTMLElement | null
      // Focus sitting outside the dialog (or on the dialog itself) gets pulled back in.
      if (!current || !el.contains(current)) { e.preventDefault(); first.focus(); return }
      if (e.shiftKey && current === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [ref, active, onEscape])
}
