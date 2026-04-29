import { Download, X } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'

export default function PWAInstallBanner() {
  const { isInstallable, triggerInstall, dismiss } = usePWAInstall()

  if (!isInstallable) return null

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 text-white text-sm"
      style={{ background: 'var(--c-primary, #16a34a)' }}
      dir="rtl"
    >
      <Download className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
      <span className="flex-1 font-medium">התקן כאפליקציה לניסיון טוב יותר</span>
      <button
        onClick={triggerInstall}
        className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full text-xs font-semibold transition-colors border border-white/30"
      >
        התקן
      </button>
      <button
        onClick={dismiss}
        aria-label="סגור"
        className="p-1 rounded-full hover:bg-white/20 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
