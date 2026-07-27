import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingsSubHeader, Card, MenuItem, Switch } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsAccessibilityPage() {
  usePageView('settings_accessibility')
  const navigate = useNavigate()
  const [a11yWidgetEnabled, setA11yWidgetEnabled] = useState(() => localStorage.getItem('a11y_widget_enabled') !== 'false')

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title="נגישות" />
      <div className="p-4 space-y-4 pb-10">
        <Card>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex-1">
              <p className="text-sm font-medium text-text">הצג כפתור נגישות</p>
              <p className="text-xs text-text3 mt-0.5">כפתור צף לשינוי גודל טקסט, ניגודיות ועוד</p>
            </div>
            <Switch
              checked={a11yWidgetEnabled}
              ariaLabel="הצג כפתור נגישות"
              onChange={next => {
                setA11yWidgetEnabled(next)
                localStorage.setItem('a11y_widget_enabled', String(next))
                window.dispatchEvent(new Event('a11y-widget-toggle'))
              }}
            />
          </div>
          <MenuItem icon="description" label="הצהרת נגישות" onClick={() => navigate('/accessibility')} />
        </Card>
      </div>
    </div>
  )
}
