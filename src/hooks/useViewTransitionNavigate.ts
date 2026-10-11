import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { findCard, findHero, runViewTransition } from '../lib/viewTransition'
import { preloadRoute } from '../lib/routePreload'

/**
 * Navigation that morphs the tapped card into the next page's hero (and back again).
 *
 *   const { goTo, goBack } = useViewTransitionNavigate()
 *   <button data-vt-id={`v:${v.id}`} onClick={() => goTo(`/checkout/${v.id}`, { id: `v:${v.id}` })}>
 *   …and on the detail page: <div data-vt-hero={`v:${id}`}> … <button onClick={goBack}>
 *
 * Without a matching element (or without View Transitions support) this degrades to a
 * plain navigate with the page-level crossfade, so it is always safe to use.
 */
export function useViewTransitionNavigate() {
  const navigate = useNavigate()

  const goTo = useCallback(async (to: string, opts?: { id?: string; state?: unknown }) => {
    await preloadRoute(to)
    runViewTransition(() => navigate(to, opts?.state !== undefined ? { state: opts.state } : undefined), {
      from: opts?.id ? findCard(opts.id) : null,
      findTo: findHero,
    })
  }, [navigate])

  const goBack = useCallback(() => {
    const hero = findHero()
    const id = hero?.getAttribute('data-vt-hero') ?? null
    runViewTransition(() => navigate(-1), {
      from: hero,
      findTo: () => (id ? findCard(id) : null),
    })
  }, [navigate])

  return { goTo, goBack }
}
