import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useVouchers } from '../../contexts/VoucherContext'
import { supabase } from '../../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../../utils/helpers'
import { sendExpiryReminderEmail } from '../../lib/emailService'
import { getNotifChannels, saveNotifChannels, type NotifChannels } from '../../hooks/useNotifications'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
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

  const reminderDaysRef = useRef(reminderDays)
  const calendarEnabledRef = useRef(calendarReminderEnabled)
  const notifChannelsRef = useRef(notifChannels)
  useEffect(() => { reminderDaysRef.current = reminderDays }, [reminderDays])
  useEffect(() => { calendarEnabledRef.current = calendarReminderEnabled }, [calendarReminderEnabled])
  useEffect(() => { notifChannelsRef.current = notifChannels }, [notifChannels])

  const supabaseSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function scheduleSupabaseSave() {
    if (supabaseSaveTimer.current) clearTimeout(supabaseSaveTimer.current)
    supabaseSaveTimer.current = setTimeout(async () => {
      try {
        await supabase.rpc('upsert_user_settings', {
          p_reminder_days: reminderDaysRef.current,
          p_notif_channels: notifChannelsRef.current,
          p_calendar_reminder_enabled: calendarEnabledRef.current,
        })
      } catch {}
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
    localStorage.setItem(reminderKey, String(val))
    scheduleSupabaseSave()
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
        toast.success('טלגרם חובר בהצלחה!')
      }
    }, 4000)
    const stop = setTimeout(() => clearInterval(timer), 10 * 60 * 1000)
    return () => { clearInterval(timer); clearTimeout(stop) }
  }, [telegramCode, telegramLinked, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      toast.error('שגיאה ביצירת קוד')
    } finally {
      setTelegramLoading(false)
    }
  }

  async function handleDisconnectTelegram() {
    if (!user) return
    if (!confirm('לנתק את חיבור הטלגרם?')) return
    await supabase.from('telegram_users').delete().eq('user_id', user.id)
    setTelegramLinked(false)
    setTelegramCode(null)
    logAction('system_telegram_link', 'מערכת', undefined, { type: 'disabled' })
    toast.success('טלגרם נותק')
  }

  async function handleSendExpiryReminder() {
    if (!user?.email) return
    const expiring = vouchers.filter(v => {
      if (!v.expiry_date) return false
      const days = getDaysUntilExpiry(v.expiry_date)
      return days !== null && days >= 0 && days <= reminderDays
    })
    if (expiring.length === 0) return toast(`אין שוברים שפגים ב-${reminderDays} הימים הקרובים`)
    setSendingReminder(true)
    try {
      const vouchers_list = expiring
        .map(v => `• ${v.store_name} — יתרה ₪${v.balance}${v.expiry_date ? `, תוקף: ${formatDate(v.expiry_date)}` : ''}`)
        .join('\n')
      await sendExpiryReminderEmail({ to_email: user.email, to_name: profile?.name || user.email, count: expiring.length, vouchers_list })
      toast.success(`תזכורת נשלחה ל-${user.email}`)
    } catch (err: any) {
      toast.error('שגיאה בשליחת התזכורת' + (err?.message ? ': ' + err.message : ''))
    } finally {
      setSendingReminder(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title="התראות" />
      <div className="p-4 space-y-4 pb-10">
        <Card>
          <div className="p-4">
            <label className="flex items-center justify-between cursor-pointer mb-4">
              <div className="flex items-center gap-2">
                <Icon name="calendar_month" size={16} color="#3b82f6" />
                <span className="text-sm text-text2">{t('settings.calendar.enabled')}</span>
              </div>
              <Switch checked={calendarReminderEnabled} onChange={saveCalendarEnabled} size="sm" />
            </label>
            <p className="text-sm text-text2 mb-3">שלח תזכורת <strong>{reminderDays}</strong> ימים לפני שהשובר יפוג</p>
            <div className="flex items-center gap-3">
              <input type="range" min={1} max={90} value={reminderDays} onChange={e => saveReminderDays(parseInt(e.target.value))} className="flex-1 accent-primary" />
              <div className="flex items-center gap-1">
                <input type="number" inputMode="numeric" min={1} max={90} value={reminderDays} onChange={e => saveReminderDays(parseInt(e.target.value) || 1)} className="w-14 text-center px-2 py-1.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <span className="text-sm text-text3">ימים</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-text3 mt-1 px-0.5">
              <span>1 יום</span>
              <span>90 ימים</span>
            </div>

            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-text3 mb-2">{t('settings.notif.channels')}</p>
              <p className="text-xs text-text3 mb-3">{t('settings.notif.channels.note')}</p>
              <div className="space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon name="notifications" size={16} color="var(--c-warning)" />
                    <span className="text-sm text-text2">{t('settings.notif.push')}</span>
                  </div>
                  <Switch checked={notifChannels.push} onChange={v => updateNotifChannel('push', v)} size="sm" />
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
                      {!telegramLinked && <p className="text-[10px] text-text3">יש לקשר טלגרם תחילה</p>}
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
                    <p className="text-sm font-medium text-text">מחובר לבוט טלגרם</p>
                    <p className="text-xs text-text3">מקבל את כל ההתראות גם בטלגרם</p>
                  </div>
                  <button onClick={handleDisconnectTelegram} className="text-xs text-error font-medium px-3 py-1.5 bg-error/10 rounded-xl flex items-center gap-1">
                    <Icon name="link_off" size={14} /> נתק
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center"><Icon name="send" size={20} color="var(--c-text3)" /></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text">קשר לטלגרם</p>
                    <p className="text-xs text-text3">קבל את כל ההתראות גם בטלגרם</p>
                  </div>
                  {!telegramCode && (
                    <button onClick={handleGenerateTelegramCode} disabled={telegramLoading} className="text-xs font-medium px-3 py-1.5 bg-bg text-text2 rounded-xl flex items-center gap-1 disabled:opacity-50">
                      {telegramLoading ? <Spinner size={14} color="var(--c-text3)" /> : <Icon name="link" size={14} />}
                      קשר
                    </button>
                  )}
                </div>
                {telegramCode && (
                  <div className="bg-bg rounded-2xl p-4 space-y-2">
                    <p className="text-xs text-text2 font-medium">שלב 1 — פתח את הבוט בטלגרם:</p>
                    <a href={`https://t.me/Vouchermanagementbot?start=${telegramCode}`} target="_blank" rel="noopener noreferrer" className="block text-center bg-primary text-white py-2.5 rounded-xl text-sm font-medium">פתח בוט טלגרם</a>
                    <p className="text-xs text-text3 text-center">או שלח ידנית לבוט:</p>
                    <div className="bg-surface rounded-xl px-4 py-3 text-center">
                      <p className="text-xs text-text3 mb-1">הפקודה לשליחה:</p>
                      <p className="font-mono text-lg font-bold tracking-widest text-text select-all">/start {telegramCode}</p>
                    </div>
                    <p className="text-xs text-text3 text-center">הקוד תקף ל-10 דקות</p>
                    <button onClick={handleGenerateTelegramCode} className="w-full text-xs text-text2 py-1.5">צור קוד חדש</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        <SL>כלים</SL>
        <Card>
          <MenuItemRow icon="notifications" label="שלח תזכורת תוקף עכשיו" desc="מייל עם רשימת שוברים שפגי תוקף בקרוב" onClick={handleSendExpiryReminder} loading={sendingReminder} />
        </Card>
      </div>
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
