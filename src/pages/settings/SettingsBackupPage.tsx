import { useState } from 'react'
import { useVouchers } from '../../contexts/VoucherContext'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { SettingsSubHeader, Card, Spinner } from '../../components/settings/SettingsUI'
import Icon from '../../components/ui/Icon'
import { usePageView } from '../../hooks/usePageView'
import { useT } from '../../lib/i18n'

const LAST_SYNC_KEY = 'gs_last_sync_at'

export default function SettingsBackupPage() {
  usePageView('settings_backup')
  const { t, locale } = useT()
  const { syncToCloud, isOnline, refreshVouchers } = useVouchers()
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() => {
    try { return localStorage.getItem(LAST_SYNC_KEY) } catch { return null }
  })

  async function handleSync() {
    if (!isOnline) return toast.error(t('backup.no.connection'))
    setSyncing(true)
    try {
      await syncToCloud()
      await refreshVouchers()
      const now = new Date().toISOString()
      try { localStorage.setItem(LAST_SYNC_KEY, now) } catch { /* storage unavailable */ }
      setLastSyncedAt(now)
      toast.success(t('backup.sync.success'))
    } catch {
      toast.error(t('backup.sync.error'))
    } finally {
      setSyncing(false)
    }
  }

  async function handleCheckConnection() {
    setChecking(true)
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (error) throw error
      toast.success(t('backup.check.ok'))
    } catch (err: any) {
      const msg = err?.message || t('backup.unknown.error')
      if (msg.includes('JWT')) toast.error(t('backup.auth.error'))
      else if (msg.includes('network')) toast.error(t('backup.network.error'))
      else toast.error(t('backup.error.msg', { msg }))
    } finally {
      setChecking(false)
    }
  }

  const lastSyncedLabel = lastSyncedAt
    ? t('settings.backup.last.synced', {
        time: new Date(lastSyncedAt).toLocaleString(locale === 'he' ? 'he-IL' : 'en-US', { dateStyle: 'short', timeStyle: 'short' }),
      })
    : null

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('backup.title')} />
      <div className="p-4 space-y-4 pb-10">
        <div className="flex items-center gap-2 px-1 text-xs text-text3">
          <Icon name={isOnline ? 'cloud' : 'cloud_off'} size={14} color={isOnline ? 'var(--c-primary)' : 'var(--c-text3)'} />
          {isOnline ? t('backup.online.status') : t('backup.offline.status')}
        </div>
        <Card>
          <div className="divide-y divide-border">
            <button
              onClick={handleSync}
              disabled={syncing || !isOnline}
              className="w-full flex items-center gap-3 p-4 text-right hover:bg-bg disabled:opacity-50 disabled:pointer-events-none"
            >
              <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center shrink-0">
                <Icon name="cloud_upload" size={20} color="var(--c-text2)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{t('settings.backup.sync.title')}</p>
                <p className="text-xs text-text3">
                  {isOnline ? t('settings.backup.sync.desc') : t('backup.no.connection')}
                </p>
                {lastSyncedLabel && <p className="text-xs text-text3 mt-0.5">{lastSyncedLabel}</p>}
              </div>
              {syncing && <Spinner size={20} />}
            </button>
            <button
              onClick={handleCheckConnection}
              disabled={checking}
              className="w-full flex items-center gap-3 p-4 text-right hover:bg-bg disabled:opacity-50 disabled:pointer-events-none"
            >
              <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center shrink-0">
                <Icon name="wifi" size={20} color="var(--c-text2)" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text">{t('settings.backup.check.title')}</p>
                <p className="text-xs text-text3">{t('settings.backup.check.desc')}</p>
              </div>
              {checking && <Spinner size={20} color="var(--c-primary)" />}
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
