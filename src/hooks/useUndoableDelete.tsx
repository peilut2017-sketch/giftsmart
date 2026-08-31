import { useState, useCallback, useEffect } from 'react'
import toast from 'react-hot-toast'

const UNDO_MS = 5000

// Module-level registries: a pending delete must survive its component unmounting.
// Navigating away is not "undo" — the timer keeps running and the delete completes
// in the background. (SearchPage previously cleared these timers on unmount, which
// silently resurrected vouchers the user had deleted; ArchivePage never cleared
// them — two contradictory behaviors for the same interaction.)
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const pending = new Set<string>()
// Each pending id's "complete the delete now" thunk, so a page-hide can flush
// the delete before the tab is frozen/killed. Without this, closing the app
// inside the 5s window let the setTimeout die and the "deleted" voucher came
// back on next launch.
const finishers = new Map<string, () => void>()

function flushPending() {
  // Run every outstanding delete immediately. Mobile fires pagehide/visibility
  // hidden before suspending the tab, so this is the last safe moment.
  finishers.forEach(fn => fn())
}

if (typeof window !== 'undefined') {
  const onHide = () => { if (document.visibilityState === 'hidden') flushPending() }
  document.addEventListener('visibilitychange', onHide)
  window.addEventListener('pagehide', flushPending)
}

interface UndoLabels {
  message: string
  undo: string
  failed?: string
  /** Toast text for a bulk delete, given the item count. */
  manyMessage?: (count: number) => string
}

export function useUndoableDelete(
  onDelete: (id: string) => Promise<unknown> | void,
  labels: UndoLabels,
) {
  // Seed from the module registry so remounting mid-countdown keeps rows hidden.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set(pending))

  useEffect(() => {
    setHiddenIds(new Set(pending))
  }, [])

  const { message, undo, failed, manyMessage } = labels

  const scheduleIds = useCallback((ids: string[], toastText: string) => {
    ids.forEach(id => pending.add(id))
    setHiddenIds(prev => new Set([...prev, ...ids]))

    const finishOne = async (id: string) => {
      // Idempotent: a page-hide flush and the timer must not both delete.
      if (!pending.has(id)) return
      pending.delete(id)
      finishers.delete(id)
      const timer = timers.get(id)
      if (timer) { clearTimeout(timer); timers.delete(id) }
      try {
        await onDelete(id)
      } catch {
        if (failed) toast.error(failed)
      } finally {
        setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
    ids.forEach(id => {
      finishers.set(id, () => { void finishOne(id) })
      timers.set(id, setTimeout(() => finishOne(id), UNDO_MS))
    })

    toast(
      tst => (
        <span>
          {toastText}{' '}
          <button
            onClick={() => {
              ids.forEach(id => {
                const timer = timers.get(id)
                if (timer) clearTimeout(timer)
                timers.delete(id)
                pending.delete(id)
                finishers.delete(id)
              })
              setHiddenIds(prev => { const s = new Set(prev); ids.forEach(id => s.delete(id)); return s })
              toast.dismiss(tst.id)
            }}
            className="font-bold underline ms-1"
          >
            {undo}
          </button>
        </span>
      ),
      { duration: UNDO_MS },
    )
  }, [onDelete, undo, failed])

  const requestDelete = useCallback((id: string) => scheduleIds([id], message), [scheduleIds, message])

  const requestDeleteMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    scheduleIds(ids, manyMessage ? manyMessage(ids.length) : message)
  }, [scheduleIds, manyMessage, message])

  return { hiddenIds, requestDelete, requestDeleteMany }
}
