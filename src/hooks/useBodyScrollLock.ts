import { useEffect } from 'react'

/**
 * Locks body scroll while enabled=true (default).
 * Pass a boolean to conditionally lock (e.g. useBodyScrollLock(showModal)).
 * Restores original overflow on cleanup.
 */
export function useBodyScrollLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [enabled])
}
