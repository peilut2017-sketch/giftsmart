import { useState, useEffect, useRef } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { useVouchers } from '../../contexts/VoucherContext'
import { supabase } from '../../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../../utils/helpers'
import { sendExpiryReminderEmail } from '../../lib/emailService'
import { getNotifChannels, saveNotifChannels, type NotifChannels } from '../../hooks/useNotifications'
import { subscribeToPush, unsubscribeFromPush } from '../../lib/push'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import ConfirmDialog from '../../components/ConfirmDialog'
import { SettingsSubHeader, Card, SL, Spinner, Switch } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsNotificationsPage() {
  usePageView('settings_notifications')
  const { t } = useT()
  const { user, profile } = useAuth()
  const { vouchers, logAction } = useVouchers()

  const reminderKey = `reminder_days_${user?.id}`
  const [reminderDays, setReminderDays] = useState(() => parseInt(localStorage.getItem(`reminder_days_${user?.id}`) || '14'))
  const [calendarReminderEnabled, setCalendarReminderEnabled] = useState(
    () => localStorage.getItem(`calendar_reminder_enabled_${user?.id}`) !== 'false'
  )
  const [notifChannels, setNotifChannels] = useState<NotifChannels>(() => getNotifChannels(user?.id))
  const [sendingReminder, setSendingReminder] = useState(false)

  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null)
  const [telegramCode, setTelegramCode] = useState<string | null>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)
  const [codeSecondsLeft, setCodeSecondsLeft] = useState(0)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [daysInput, setDaysInput] = useState(String(reminderDays))
  const pushPermission = typeof Notification !== 'undefined' ? Notification.permission : 'denied'

  const reminderDaysRef = useRef(reminderDays)
  const calendarEnabledRef = useRef(calendarReminderEnabled)
  const notifChannelsRef = useRef(notifChannels)
  useEffect(() => { reminderDaysRef.current = reminderDays }, [reminderDays])
  useEffect(() => { calendarEnabledRef.current = calendarReminderEnabled }, [calendarReminderEnabled])
  useEffect(() => { notifChannelsRef.current = notifChannels }, [notifChannels])

  const supabaseSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleSupabaseSave() {
    if (supabaseSaveTimer.current) clearTimeout(supabaseSaveTimer.current)
    setSaveState('saving')
    supabaseSaveTimer.current = setTimeout(async () => {
      try {
        const { error } = await supabase.rpc('upsert_user_settings', {
          p_reminder_days: reminderDaysRef.current,
          p_notif_channels: notifChannelsRef.current,
          p_calendar_reminder_enabled: calendarEnabledRef.current,
        })
        if (error) throw error
        setSaveState('saved')
        setTimeout(() => setSaveState(s => (s === 'saved' ? 'idle' : s)), 2000)
      } catch {
        // A rejected save is no longer swallowed silently — localStorage and the
        // server would quietly disagree with zero feedback
        setSaveState('error')
        toast.error(t('notifset.save.error'))
      }
    }, 800)
  }

  useEffect(() => {
    if (!user?.id) return
    ;(async () => {
      try {
        const { data } = await supabase.rpc('get_user_settings')
        const row = Array.isArray(data) ? data[0] : data
        if (!row) return
        if (row.reminder_days != null) {
          const d = Math.max(1, Math.min(90, row.reminder_days))
          setReminderDays(d)
          localStorage.setItem(reminderKey, String(d))
        }
        if (row.notif_channels) {
          const ch: NotifChannels = { push: true, email: false, telegram: true, ...row.notif_channels }
          setNotifChannels(ch)
          saveNotifChannels(user.id, ch)
        }
        if (row.calendar_reminder_enabled != null) {
          setCalendarReminderEnabled(row.calendar_reminder_enabled)
          localStorage.setItem(`calendar_reminder_enabled_${user.id}`, String(row.calendar_reminder_enabled))
        }
      } catch {}
    })()
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  function saveReminderDays(days: number) {
    const val = Math.max(1, Math.min(90, days))
    setReminderDays(val)
    setDaysInput(String(val))
    localStorage.setItem(reminderKey, String(val))
    scheduleSupabaseSave()
  }

  // The number field edits a local string and commits on blur — the old onChange
  // clamp snapped an emptied field to "1" mid-typing, so entering "30" gave 1→30
  // with a jarring flicker (and "0" was impossible to pass through)
  function handleDaysInputChange(raw: string) {
    setDaysInput(raw)
    const parsed = parseInt(raw)
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 90) {
      setReminderDays(parsed)
      localStorage.setItem(reminderKey, String(parsed))
      scheduleSupabaseSave()
    }
  }

  function saveCalendarEnabled(val: boolean) {
    setCalendarReminderEnabled(val)
    localStorage.setItem(`calendar_reminder_enabled_${user?.id}`, String(val))
    scheduleSupabaseSave()
  }

  function updateNotifChannel(key: keyof NotifChannels, value: boolean) {
    const next = { ...notifChannels, [key]: value }
    setNotifChannels(next)
    if (user?.id) saveNotifChannels(user.id, next)
    scheduleSupabaseSave()
  }

  // The push switch now drives the REAL browser permission — it used to flip a
  // preference bit while the OS permission stayed "default", so the switch showed
  // green and nothing ever arrived
  async function handleTogglePush(value: boolean) {
    if (!value) {
      updateNotifChannel('push', false)
      // Also drop this device's server-side push subscription
      unsubscribeFromPush()
      return
    }
    if (typeof Notification === 'undefined') {
      toast.error(t('notifset.push.unsupported'))
      return
    }
    if (Notification.permission === 'denied') {
      toast.error(t('notifset.push.blocked'), { duration: 6000 })
      return
    }
    if (Notification.permission === 'default') {
      const result = await Notification.requestPermission()
      if (result !== 'granted') {
        toast(t('notifset.push.denied'), { icon: 'ℹ️' })
        return
      }
    }
    updateNotifChannel('push', true)
    // Register this device for real server push (expiry reminders while the app
    // is closed). 'unconfigured' = no VAPID key set yet — local notifications
    // still work, so the toggle stays on.
    const result = await subscribeToPush()
    if (result === 'error') {
      toast.error(t('notifset.push.server.error'))
    }
  }

  useEffect(() => {
    if (!user) return
    supabase.from('telegram_users').select('id').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => setTelegramLinked(!!data))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // While a link code is displayed, poll until the bot confirms the link — the
  // user shouldn't have to leave and re-enter the page to see "connected".
  useEffect(() => {
    if (!telegramCode || telegramLinked || !user) return
    const timer = setInterval(async () => {
      const { data } = await supabase.from('telegram_users').select('id').eq('user_id', user.id).maybeSingle()
      if (data) {
        setTelegramLinked(true)
        setTelegramCode(null)
        logAction('system_telegram_link', 'מערכת', undefined, { type: 'enabled' })
        toast.success(t('notifset.telegram.connected'))
      }
    }, 4000)
    const stop = setTimeout(() => clearInterval(timer), 10 * 60 * 1000)
    return () => { clearInterval(timer); clearTimeout(stop) }
  }, [telegramCode, telegramLinked, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live countdown for the 10-minute code window — the old UI said "valid for 10
  // minutes" with no timer and silently stopped polling when it lapsed
  useEffect(() => {
    if (!telegramCode) { setCodeSecondsLeft(0); return }
    setCodeSecondsLeft(10 * 60)
    const timer = setInterval(() => {
      setCodeSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer)
          setTelegramCode(null)
          toast(t('notifset.telegram.code.expired'), { icon: '⏱️' })
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [telegramCode])

  async function handleGenerateTelegramCode() {
    if (!user) return
    setTelegramLoading(true)
    try {
      // Server-side CSPRNG code (the old client-side Math.random 6-digit code
      // was guessable and let attackers hijack the Telegram link).
      const { data, error } = await supabase.rpc('create_telegram_link_code')
      if (error || !data) throw error ?? new Error('no code')
      setTelegramCode(data as string)
    } catch {
      toast.error(t('notifset.code.error'))
    } finally {
      setTelegramLoading(false)
    }
  }

  async function doDisconnectTelegram() {
    if (!user) return
    await supabase.from('telegram_users').delete().eq('user_id', user.id)
    setTelegramLinked(false)
    setTelegramCode(null)
    logAction('system_telegram_link', 'מערכת', undefined, { type: 'disabled' })
    toast.success(t('notifset.telegram.disconnected'))
  }

  async function handleSendExpiryReminder() {
    if (!user?.email) return
    const expiring = vouchers.filter(v => {
      if (!v.expiry_date) return false
      const days = getDaysUntilExpiry(v.expiry_date)
      return days !== null && days >= 0 && days <= reminderDays
    })
    if (expiring.length === 0) return toast(t('notifset.no.expiring', { days: reminderDays }))
    setSendingReminder(true)
    try {
      const vouchers_list = expiring
        .map(v => `• ${v.store_name} — יתרה ₪${v.balance}${v.expiry_date ? `, תוקף: ${formatDate(v.expiry_date)}` : ''}`)
        .join('\n')
      await sendExpiryReminderEmail({ to_email: user.email, to_name: profile?.name || user.email, count: expiring.length, vouchers_list })
      toast.success(t('notifset.reminder.sent', { email: user.email }))
    } catch (err: any) {
      toast.error(t('notifset.reminder.error') + (err?.message ? ': ' + err.message : ''))
    } finally {
      setSendingReminder(false)
    }
  }

  const saveIndicator = saveState === 'saving' ? t('notifset.saving') : saveState === 'saved' ? t('notifset.saved') : saveState === 'error' ? t('notifset.save.failed') : ''

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('settings.notifications')} />
      <div className="p-4 space-y-4 pb-10">
        {saveIndicator && (
          <p className={`text-xs text-center ${saveState === 'error' ? 'text-error' : 'text-text3'}`} aria-live="polite">{saveIndicator}</p>
        )}
        <Card>
          <div className="p-4">
            <label className="flex items-center justify-between cursor-pointer mb-4">
              <div className="flex items-center gap-2">
                <Icon name="calendar_month" size={16} color="#3b82f6" />
                <span className="text-sm text-text2">{t('settings.calendar.enabled')}</span>
              </div>
              <Switch checked={calendarReminderEnabled} onChange={saveCalendarEnabled} size="sm" />
            </label>
            <p className="text-sm text-text2 mb-3">{t('notifset.reminder.before.a')} <strong>{reminderDays}</strong> {t('notifset.reminder.before.b')}</p>
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={90} value={reminderDays} onChange={e => saveReminderDays(parseInt(e.target.value))} className="flex-1 accent-primary" aria-label={t('notifset.reminder.days.aria')} />
              <div className="flex items-center gap-1">
                <input
                  type="number" inputMode="numeric" min={1} max={90}
                  value={daysInput}
                  onChange={e => handleDaysInputChange(e.target.value)}
                  onBlur={() => saveReminderDays(parseInt(daysInput) || reminderDays)}
                  aria-label={t('notifset.reminder.days.aria')}
                  className="w-16 text-center px-2 py-2 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-sm text-text3">{t('notifset.days')}</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-text3 mt-1 px-0.5">
              <span>{t('notifset.one.day')}</span>
              <span>{t('notifset.ninety.days')}</span>
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-text3 mb-2">{t('settings.notif.channels')}</p>
              <p className="text-xs text-text3 mb-3">{t('settings.notif.channels.note')}</p>
              <div className="space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon name="notifications" size={16} color="var(--c-warning)" />
                    <div>
                      <span className="text-sm text-text2">{t('settings.notif.push')}</span>
                      {pushPermission === 'denied' && (
                        <p className="text-[10px] text-error">{t('notifset.push.blocked.note')}</p>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={notifChannels.push && pushPermission === 'granted'}
                    onChange={handleTogglePush}
                    size="sm"
                    ariaLabel={t('settings.notif.push')}
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon name="mail" size={16} color="#3b82f6" />
                    <span className="text-sm text-text2">{t('settings.notif.email')}</span>
                  </div>
                  <Switch checked={notifChannels.email} onChange={v => updateNotifChannel('email', v)} size="sm" />
                </label>
                <label className={`flex items-center justify-between ${!telegramLinked ? 'opacity-50' : 'cursor-pointer'}`}>
                  <div className="flex items-center gap-2">
                    <Icon name="send" size={16} color="#0ea5e9" />
                    <div>
                      <span className="text-sm text-text2">{t('settings.notif.telegram')}</span>
                      {!telegramLinked && <p className="text-[10px] text-text3">{t('notifset.telegram.link.first')}</p>}
                    </div>
                  </div>
                  <Switch checked={notifChannels.telegram && !!telegramLinked} onChange={v => telegramLinked && updateNotifChannel('telegram', v)} size="sm" />
                </label>
              </div>
            </div>
          </div>

          <div className="border-t border-border">
            {telegramLinked ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center"><Icon name="send" size={20} color="#0ea5e9" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text">{t('notifset.telegram.linked.title')}</p>
                    <p className="text-xs text-text3">{t('notifset.telegram.linked.desc')}</p>
                  </div>
                  <button onClick={() => setConfirmDisconnect(true)} className="text-xs text-error font-medium px-3 py-2 bg-error/10 rounded-xl flex items-center gap-1">
                    <Icon name="link_off" size={14} /> {t('notifset.disconnect')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center"><Icon name="send" size={20} color="var(--c-text3)" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text">{t('notifset.telegram.link.title')}</p>
                    <p className="text-xs text-text3">{t('notifset.telegram.link.desc')}</p>
                  </div>
                  {!telegramCode && (
                    <button onClick={handleGenerateTelegramCode} disabled={telegramLoading} className="text-xs font-medium px-3 py-1.5 bg-bg text-text2 rounded-xl flex items-center gap-1 disabled:opacity-50">
                      {telegramLoading ? <Spinner size={14} color="var(--c-text3)" /> : <Icon name="link" size={14} />}
                      {t('notifset.link.button')}
                    </button>
                  )}
                </div>
                {telegramCode && (
                  <div className="bg-bg rounded-2xl p-4 space-y-2">
                    <p className="text-xs text-text2 font-medium">{t('notifset.telegram.step1')}</p>
                    <a href={`https://t.me/Vouchermanagementbot?start=${telegramCode}`} target="_blank" rel="noopener noreferrer" className="block text-center bg-primary text-white py-2.5 rounded-xl text-sm font-medium">{t('notifset.telegram.open.bot')}</a>
                    <p className="text-xs text-text3 text-center">{t('notifset.telegram.manual')}</p>
                    <div className="bg-surface rounded-xl px-4 py-3 text-center">
                      <p className="text-xs text-text3 mb-1">{t('notifset.telegram.command')}</p>
                      <p className="font-mono text-lg font-bold tracking-widest text-text select-all">/start {telegramCode}</p>
                    </div>
                    <p className="text-xs text-text3 text-center" aria-live="polite">
                      {t('notifset.code.valid.for', { time: `${Math.floor(codeSecondsLeft / 60)}:${String(codeSecondsLeft % 60).padStart(2, '0')}` })}
                    </p>
                    <button onClick={handleGenerateTelegramCode} className="w-full text-xs text-text2 py-2">{t('notifset.new.code')}</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <SL>{t('notifset.tools')}</SL>
        <Card>
          <MenuItemRow icon="notifications" label={t('notifset.send.reminder.now')} desc={t('notifset.send.reminder.desc')} onClick={handleSendExpiryReminder} loading={sendingReminder} />
        </Card>
      </div>

      <AnimatePresence>
        {confirmDisconnect && (
          <ConfirmDialog
            title={t('notifset.disconnect.confirm.title')}
            message={t('notifset.disconnect.confirm.message')}
            danger
            onConfirm={() => { setConfirmDisconnect(false); doDisconnectTelegram() }}
            onCancel={() => setConfirmDisconnect(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuItemRow({ icon, label, desc, onClick, loading }: { icon: string; label: string; desc?: string; onClick: () => void; loading?: boolean }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 p-4 text-right hover:bg-bg">
      <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center shrink-0">
        <Icon name={icon} size={20} color="var(--c-text2)" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        {desc && <p className="text-xs text-text3">{desc}</p>}
      </div>
      {loading && <Spinner size={20} color="var(--c-warning)" />}
    </button>
  )
}
