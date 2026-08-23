import { useState } from 'react'
import { Download, X, Share, SquarePlus } from 'lucide-react'
import { usePWAInstall } from '../hooks/usePWAInstall'
import { useT } from '../lib/i18n'

export default function PWAInstallBanner() {
  const { t } = useT()
  const { isInstallable, isIOSInstallable, triggerInstall, dismiss } = usePWAInstall()
  const [showIOSGuide, setShowIOSGuide] = useState(false)

  if (!isInstallable && !isIOSInstallable) return null

  return (
    <>
      <div
        className="flex items-center gap-3 px-4 py-3 text-white text-sm"
        style={{ background: 'var(--c-primary, #16a34a)' }}
        dir="rtl"
      >
        <Download className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
        <span className="flex-1 font-medium">{t('pwa.banner.text')}</span>
        <button
          onClick={() => (isInstallable ? triggerInstall() : setShowIOSGuide(true))}
          className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-full text-xs font-semibold transition-colors border border-white/30"
        >
          {t('pwa.banner.install')}
        </button>
        <button
          onClick={dismiss}
          aria-label={t('app.close')}
          className="p-1 rounded-full hover:bg-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {showIOSGuide && (
        <div
          className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center"
          onClick={() => setShowIOSGuide(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('pwa.ios.title')}
            className="bg-surface rounded-t-3xl w-full max-w-md p-6 animate-slide-up"
            style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
            onClick={e => e.stopPropagation()}
            dir="rtl"
          >
            <div className="w-10 h-1 rounded-full bg-border mx-auto mb-5" />
            <h2 className="text-lg font-bold text-text mb-1">{t('pwa.ios.title')}</h2>
            <p className="text-sm text-text2 mb-5">{t('pwa.ios.subtitle')}</p>
            <ol className="space-y-4 mb-6">
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-primary-light text-primary text-sm font-bold flex items-center justify-center shrink-0">1</span>
                <span className="text-sm text-text flex-1">{t('pwa.ios.step1')}</span>
                <Share className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
              </li>
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-primary-light text-primary text-sm font-bold flex items-center justify-center shrink-0">2</span>
                <span className="text-sm text-text flex-1">{t('pwa.ios.step2')}</span>
                <SquarePlus className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
              </li>
              <li className="flex items-center gap-3">
                <span className="w-7 h-7 rounded-full bg-primary-light text-primary text-sm font-bold flex items-center justify-center shrink-0">3</span>
                <span className="text-sm text-text flex-1">{t('pwa.ios.step3')}</span>
              </li>
            </ol>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full py-3 rounded-2xl bg-primary text-white font-semibold text-sm"
            >
              {t('pwa.ios.done')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
