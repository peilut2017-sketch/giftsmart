import { useEffect, useState } from 'react'

/**
 * Height (px) of the on-screen keyboard overlapping the layout viewport,
 * measured via visualViewport. 0 when the keyboard is closed or the API is
 * unavailable. Apply as bottom padding / translate on fixed composers so they
 * ride above the keyboard instead of being buried under it (iOS Safari doesn't
 * resize the layout viewport for fixed elements).
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      const overlap = Math.round(window.innerHeight - vv.height - vv.offsetTop)
      setInset(overlap > 40 ? overlap : 0)
    }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    update()
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
