import { useState } from 'react'
import { useVouchers } from '../../contexts/VoucherContext'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { SettingsSubHeader, Card, Spinner } from '../../components/settings/SettingsUI'
import Icon from '../../components/ui/Icon'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsBackupPage() {
  usePageView('settings_backup')
  const { syncToCloud, isOnline, refreshVouchers } = useVouchers()
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)

  async function handleSync() {
    if (!isOnline) return toast.error('אין חיבור לאינטרנט')
    setSyncing(true)
    try {
      await syncToCloud()
      await refreshVouchers()
      toast.success('שוברים סונכרנו לענן!')
    } catch {
      toast.error('שגיאה בסנכרון')
    } finally {
      setSyncing(false)
    }
  }

  async function handleCheckConnection() {
    setChecking(true)
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (error) throw error
      toast.success('חיבור לבסיס הנתונים תקין')
    } catch (err: any) {
      const msg = err?.message || 'שגיאה לא ידועה'
      if (msg.includes('JWT')) toast.error('בעיית אימות — נסה להתחבר מחדש')
      else if (msg.includes('network')) toast.error('בעיית רשת — בדוק את החיבור שלך לאינטרנט')
      else toast.error(`שגיאה: ${msg}`)
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title="גיבוי" />
      <div className="p-4 space-y-4 pb-10">
        <div className="flex items-center gap-2 px-1 text-xs text-text3">
          <Icon name={isOnline ? 'cloud' : 'cloud_off'} size={14} color={isOnline ? 'var(--c-primary)' : 'var(--c-text3)'} />
          {isOnline ? 'מקוון — הנתונים נשמרים בענן' : 'לא מקוון — שינויים יסונכרנו כשהחיבור יחזור'}
        </div>
        <Card>
          <div className="divide-y divide-border">
            <button onClick={handleSync} className="w-full flex items-center gap-3 p-4 text-right hover:bg-bg">
              <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center shrink-0">
                <Icon name="cloud_upload" size={20} color="var(--c-text2)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">סנכרן שוברים לענן</p>
                <p className="text-xs text-text3">{isOnline ? 'העלה שוברים מ-cache לסופאבייס' : 'אין חיבור לאינטרנט'}</p>
              </div>
              {syncing && <Spinner size={20} />}
            </button>
            <button onClick={handleCheckConnection} className="w-full flex items-center gap-3 p-4 text-right hover:bg-bg">
              <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center shrink-0">
                <Icon name="wifi" size={20} color="var(--c-text2)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">בדוק חיבור</p>
                <p className="text-xs text-text3">בדיקת תקינות חיבור לבסיס הנתונים</p>
              </div>
              {checking && <Spinner size={20} color="#3b82f6" />}
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
