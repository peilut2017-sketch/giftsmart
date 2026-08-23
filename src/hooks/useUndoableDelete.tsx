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

interface UndoLabels {
  message: string
  undo: string
  failed?: string
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

  const { message, undo, failed } = labels

  const requestDelete = useCallback((id: string) => {
    pending.add(id)
    setHiddenIds(prev => new Set(prev).add(id))

    const finish = async () => {
      timers.delete(id)
      try {
        await onDelete(id)
      } catch {
        if (failed) toast.error(failed)
      } finally {
        pending.delete(id)
        setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
      }
    }
    timers.set(id, setTimeout(finish, UNDO_MS))

    toast(
      tst => (
        <span>
          {message}{' '}
          <button
            onClick={() => {
              const timer = timers.get(id)
              if (timer) clearTimeout(timer)
              timers.delete(id)
              pending.delete(id)
              setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
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
  }, [onDelete, message, undo, failed])

  return { hiddenIds, requestDelete }
}
