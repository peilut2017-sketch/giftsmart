import { useEffect } from 'react'

/**
 * Locks body scroll while enabled=true (default).
 * Uses position:fixed approach which works on iOS Safari
 * (overflow:hidden on body alone does NOT prevent scroll on iOS).
 * Saves and restores scroll position on unlock.
 */
export function useBodyScrollLock(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return

    const scrollY = window.scrollY
    const body = document.body

    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.overflow = 'hidden'

    return () => {
      body.style.position = ''
      body.style.top = ''
      body.style.left = ''
      body.style.right = ''
      body.style.overflow = ''
      window.scrollTo(0, scrollY)
    }
  }, [enabled])
}
