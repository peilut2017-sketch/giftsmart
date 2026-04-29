import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'pwa_install_dismissed_until'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePWAInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstallable, setIsInstallable] = useState(false)

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true

  useEffect(() => {
    if (isStandalone) return

    const dismissedUntil = localStorage.getItem(DISMISSED_KEY)
    if (dismissedUntil && Date.now() < parseInt(dismissedUntil)) return

    const handler = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [isStandalone])

  async function triggerInstall() {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    if (outcome === 'accepted') {
      setIsInstallable(false)
      setPromptEvent(null)
    }
  }

  function dismiss() {
    // Snooze for 30 days
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 30 * 86400000))
    setIsInstallable(false)
    setPromptEvent(null)
  }

  return { isInstallable: isInstallable && !isStandalone, triggerInstall, dismiss }
}
