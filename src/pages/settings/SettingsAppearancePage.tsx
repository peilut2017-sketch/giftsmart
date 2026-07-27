import { useState } from 'react'
import { useTheme } from '../../contexts/ThemeContext'
import { useLocale, useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import { getNavGlassOpacity, setNavGlassOpacity } from '../../lib/navGlass'
import { SettingsSubHeader, Card } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsAppearancePage() {
  usePageView('settings_appearance')
  const { t } = useT()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const [navGlassOpacity, setNavGlassOpacityState] = useState(getNavGlassOpacity)

  function handleNavGlassChange(value: number) {
    setNavGlassOpacityState(value)
    setNavGlassOpacity(value)
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title="מראה" />
      <div className="p-4 space-y-4 pb-10">
        <Card>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <Icon name={theme === 'dark' ? 'dark_mode' : 'light_mode'} size={20} color="var(--c-primary)" />
              <div>
                <div className="font-medium text-sm text-text">{t('settings.dark.mode')}</div>
                <div className="text-xs text-text3">{theme === 'dark' ? 'פעיל' : 'כבוי'}</div>
              </div>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${theme === 'dark' ? 'bg-primary' : 'bg-border'}`}
            >
              <span className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform" style={{ transform: theme === 'dark' ? 'translateX(-24px)' : 'translateX(-4px)' }} />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Icon name="language" size={20} color="var(--c-primary)" />
              <div>
                <div className="font-medium text-sm text-text">שפה / Language</div>
                <div className="text-xs text-text3">{locale === 'he' ? 'עברית' : 'English'}</div>
              </div>
            </div>
            <div className="flex rounded-xl overflow-hidden border border-border">
              {(['he', 'en'] as const).map(l => (
                <button key={l} onClick={() => setLocale(l)} className={`px-3 py-1 text-xs font-semibold transition-colors ${locale === l ? 'bg-primary text-white' : 'bg-surface text-text2'}`}>
                  {l === 'he' ? 'עב' : 'EN'}
                </button>
              ))}
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border">
            <div className="flex items-center gap-3 mb-2">
              <Icon name="blur_on" size={20} color="var(--c-primary)" />
              <div className="flex-1">
                <div className="font-medium text-sm text-text">{t('settings.nav.glass')}</div>
                <div className="text-xs text-text3">{t('settings.nav.glass.desc')}</div>
              </div>
              <span className="text-xs font-bold text-text3 tabular-nums">{Math.round(navGlassOpacity * 100)}%</span>
            </div>
            <input
              type="range" min={0.15} max={1} step={0.05}
              value={navGlassOpacity}
              onChange={e => handleNavGlassChange(parseFloat(e.target.value))}
              className="w-full accent-primary"
              aria-label={t('settings.nav.glass')}
            />
          </div>
        </Card>
      </div>
    </div>
  )
}
