import { useState, useEffect } from 'react'

const DISMISSED_KEY = 'pwa_install_dismissed_until'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// iPadOS 13+ masquerades as macOS but is the only "Mac" with multi-touch.
function detectIOS(): boolean {
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export function usePWAInstall() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(
    // Chrome fires beforeinstallprompt before React mounts; main.tsx stashes it
    // at module scope so the banner still works on cold loads.
    () => ((window as any).__gsInstallPrompt as BeforeInstallPromptEvent | undefined) ?? null,
  )
  const [isInstallable, setIsInstallable] = useState(() => Boolean((window as any).__gsInstallPrompt))
  const [isIOS] = useState(detectIOS)

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true

  const dismissedUntil = localStorage.getItem(DISMISSED_KEY)
  const snoozed = Boolean(dismissedUntil && Date.now() < parseInt(dismissedUntil))

  useEffect(() => {
    if (isStandalone || snoozed) return

    const pickUp = () => {
      const stashed = (window as any).__gsInstallPrompt as BeforeInstallPromptEvent | undefined
      if (stashed) {
        setPromptEvent(stashed)
        setIsInstallable(true)
      }
    }
    const direct = (e: Event) => {
      e.preventDefault()
      setPromptEvent(e as BeforeInstallPromptEvent)
      setIsInstallable(true)
    }

    pickUp()
    window.addEventListener('gs-install-ready', pickUp)
    window.addEventListener('beforeinstallprompt', direct)
    return () => {
      window.removeEventListener('gs-install-ready', pickUp)
      window.removeEventListener('beforeinstallprompt', direct)
    }
  }, [isStandalone, snoozed])

  async function triggerInstall() {
    if (!promptEvent) return
    await promptEvent.prompt()
    const { outcome } = await promptEvent.userChoice
    if (outcome === 'accepted') {
      setIsInstallable(false)
      setPromptEvent(null)
      ;(window as any).__gsInstallPrompt = undefined
    }
  }

  function dismiss() {
    // Snooze for 30 days
    localStorage.setItem(DISMISSED_KEY, String(Date.now() + 30 * 86400000))
    setIsInstallable(false)
    setPromptEvent(null)
  }

  return {
    // Chromium path: a real install prompt is in hand.
    isInstallable: isInstallable && !isStandalone && !snoozed,
    // iOS path: no install API exists — the banner shows "Add to Home Screen" steps.
    isIOSInstallable: isIOS && !isStandalone && !snoozed && !isInstallable,
    triggerInstall,
    dismiss,
  }
}
