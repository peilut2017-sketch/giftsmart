import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../utils/helpers'
import { sendExpiryReminderEmail } from '../lib/emailService'
import { getNotifChannels, saveNotifChannels, type NotifChannels } from '../hooks/useNotifications'
import toast from 'react-hot-toast'
import ActivityLog from '../components/ActivityLog'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../lib/passkey'
import { useE2EE } from '../contexts/E2EEContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLocale, useT } from '../lib/i18n'
import { useDiscounts } from '../contexts/DiscountsContext'
import { usePageView } from '../hooks/usePageView'
import Icon from '../components/ui/Icon'
import { getNavGlassOpacity, setNavGlassOpacity } from '../lib/navGlass'

interface SupportMessageReply {
  id: string
  message_id: string
  sender: 'user' | 'admin'
  body: string
  created_at: string
}

interface SupportMessage {
  id: string
  subject: string
  body: string
  category: string
  status: 'unread' | 'read' | 'replied'
  admin_reply: string | null
  replied_at: string | null
  created_at: string
  replies?: SupportMessageReply[]
}

interface AdminBroadcast {
  id: string
  subject: string
  body: string
  created_at: string
}

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

interface PasswordStrength { score: number; label: string; color: string; checks: { label: string; ok: boolean }[] }
function getPasswordStrength(password: string, t: (k: string) => string): PasswordStrength {
  const checks = [
    { label: t('auth.check.length'),  ok: password.length >= 8 },
    { label: t('auth.check.upper'),   ok: /[A-Z]/.test(password) },
    { label: t('auth.check.lower'),   ok: /[a-z]/.test(password) },
    { label: t('auth.check.digit'),   ok: /\d/.test(password) },
    { label: t('auth.check.special'), ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
  ]
  const score = checks.filter(c => c.ok).length
  const labels = [t('auth.strength.very.weak'), t('auth.strength.weak'), t('auth.strength.medium'), t('auth.strength.strong'), t('auth.strength.very.strong')]
  const colors = ['bg-error', 'bg-warning', 'bg-warning', 'bg-primary-mid', 'bg-primary']
  return { score, label: labels[Math.min(score, 4)], color: colors[Math.min(score, 4)], checks }
}

function MenuItem({ icon, label, desc, onClick, danger = false, right }: { icon: string; label: string; desc?: string; onClick?: () => void; danger?: boolean; right?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 transition-colors rounded-2xl text-right hover:bg-bg"
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-error/10' : 'bg-bg'}`}>
        <Icon name={icon} size={20} color={danger ? 'var(--c-error)' : 'var(--c-text2)'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${danger ? 'text-error' : 'text-text'}`}>{label}</p>
        {desc && <p className="text-xs text-text3">{desc}</p>}
      </div>
      {right || <Icon name="chevron_left" size={16} color="var(--c-text3)" />}
    </button>
  )
}

function SL({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-bold text-text3 uppercase tracking-wider px-5 pt-4 pb-1.5">{children}</div>
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface rounded-card shadow-card overflow-hidden mb-1">{children}</div>
}

function Spinner({ color = 'var(--c-primary)', size = 20 }: { color?: string; size?: number }) {
  return <Icon name="progress_activity" size={size} color={color} className="animate-spin" />
}

interface WalletMemberRow {
  user_id: string
  email: string
  role: string
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, signOut, updateProfile, isAdmin } = useAuth()
  const { isPro, proExpiryDate, openUpgradeSheet } = useSubscription()
  const { syncToCloud, isOnline, refreshVouchers, vouchers, archivedVouchers, walletId, walletName, inviteMember, removeMember, logAction, updateVoucher } = useVouchers()
  const { hasVault, hint, isVaultUnlocked, isUnifiedVault, unlockVault, unlockVaultFromRecovery, encrypt, resetVault, changePassphrase, disableVault, migrateVault, regenerateRecoveryKey, enableBiometricVaultUnlock, reDeriveVaultKeyFromPassword } = useE2EE()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const { t } = useT()
  const { clubs, userClubIds, fetchClubs, setUserClubs } = useDiscounts()
  usePageView('settings')

  const [a11yWidgetEnabled, setA11yWidgetEnabled] = useState(
    () => localStorage.getItem('a11y_widget_enabled') !== 'false'
  )
  const [navGlassOpacity, setNavGlassOpacityState] = useState(getNavGlassOpacity)
  function handleNavGlassChange(value: number) {
    setNavGlassOpacityState(value)
    setNavGlassOpacity(value)
  }

  // Clubs selector state
  const [localClubIds, setLocalClubIds] = useState<string[]>([])
  const [savingClubs, setSavingClubs] = useState(false)
  const [clubsOpen, setClubsOpen] = useState(false)
  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [phone, setPhone] = useState(profile?.phone || '')

  const [editPass, setEditPass] = useState(false)
  const [currentPass, setCurrentPass] = useState('')
  const [showCurrentPass, setShowCurrentPass] = useState(false)
  const [showNewPass, setShowNewPass] = useState(false)
  const [showNewPass2, setShowNewPass2] = useState(false)
  const [showPassStrength, setShowPassStrength] = useState(false)
  const [passwordChanging, setPasswordChanging] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)
  const [sendingReminder, setSendingReminder] = useState(false)
  const [biometricEnabled, setBiometricEnabled] = useState(isBiometricEnabled)
  const [biometricLoading, setBiometricLoading] = useState(false)

  // Wallet sharing
  const [members, setMembers] = useState<WalletMemberRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [pendingInviteEmail, setPendingInviteEmail] = useState<string | null>(null)

  // Support messages
  const [supportSubject, setSupportSubject] = useState('')
  const [supportBody, setSupportBody] = useState('')
  const [supportCategory, setSupportCategory] = useState('general')
  const [sendingSupport, setSendingSupport] = useState(false)
  const [myMessages, setMyMessages] = useState<SupportMessage[]>([])
  const [showMyMessages, setShowMyMessages] = useState(false)
  const [supportSent, setSupportSent] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [sendingUserReply, setSendingUserReply] = useState<string | null>(null)

  // Deal suggestions

  // Admin broadcasts
  const [adminBroadcasts, setAdminBroadcasts] = useState<AdminBroadcast[]>([])
  const [seenBroadcastIds, setSeenBroadcastIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('seen_broadcast_ids') || '[]'))
  )

  // Vault (E2EE passphrase management)
  const [showVaultSection, setShowVaultSection] = useState(false)
  const [showMigrateSection, setShowMigrateSection] = useState(false)
  const [migrateVaultPass, setMigrateVaultPass] = useState('')
  const [migrateLoginPass, setMigrateLoginPass] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [vaultOldPass, setVaultOldPass] = useState('')
  const [vaultNewPass, setVaultNewPass] = useState('')
  const [vaultNewPass2, setVaultNewPass2] = useState('')
  const [vaultNewHint, setVaultNewHint] = useState('')
  const [vaultChanging, setVaultChanging] = useState(false)
  const [vaultResetConfirm, setVaultResetConfirm] = useState(false)
  const [vaultDisablePass, setVaultDisablePass] = useState('')
  const [vaultDisabling, setVaultDisabling] = useState(false)
  const [vaultDisableConfirm, setVaultDisableConfirm] = useState(false)
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false)
  const [recoveryPhrase, setRecoveryPhrase] = useState('')
  const [recoveryUnlocking, setRecoveryUnlocking] = useState(false)

  // Encrypt-all feature
  const [e2eeDefaultNew, setE2eeDefaultNew] = useState(() => localStorage.getItem('gs_e2ee_default') !== 'false')
  const [encryptAllConfirm, setEncryptAllConfirm] = useState(false)
  const [encryptAllPass, setEncryptAllPass] = useState('')
  const [encryptingAll, setEncryptingAll] = useState(false)

  async function handleMigrateVault() {
    if (!migrateVaultPass) return toast.error('הזן את סיסמת הכספת הנוכחית')
    if (!migrateLoginPass) return toast.error('הזן את סיסמת הכניסה שלך')
    setMigrating(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await migrateVault(migrateVaultPass, migrateLoginPass, e2eeVouchers)
      if (!ok) { toast.error('אחת הסיסמאות שגויה — נסה שוב'); return }
      // Save re-encrypted voucher codes to DB
      await Promise.all(entries.map(({ id, code, cvv }) =>
        updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
      ))
      toast.success(`הכספת אוחדה! ${entries.length} שוברים הוצפנו מחדש`)
      setMigrateVaultPass('')
      setMigrateLoginPass('')
      setShowMigrateSection(false)
    } finally {
      setMigrating(false)
    }
  }

  async function handleRecoveryUnlock() {
    if (!recoveryPhrase.trim()) return
    setRecoveryUnlocking(true)
    try {
      const ok = await unlockVaultFromRecovery(recoveryPhrase.trim())
      if (!ok) { toast.error('מפתח שחזור שגוי — בדוק את הטקסט ונסה שוב'); return }
      toast.success('הכספת נפתחה עם מפתח השחזור!')
      setShowRecoveryUnlock(false)
      setRecoveryPhrase('')
    } finally {
      setRecoveryUnlocking(false)
    }
  }

  async function handleChangeVaultPassphrase() {
    if (!vaultOldPass) return toast.error('הזן סיסמה נוכחית')
    if (vaultNewPass.length < 8) return toast.error('סיסמה חדשה: לפחות 8 תווים')
    if (vaultNewPass !== vaultNewPass2) return toast.error('הסיסמאות אינן תואמות')
    setVaultChanging(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await changePassphrase(vaultOldPass, vaultNewPass, e2eeVouchers, vaultNewHint)
      if (!ok) { toast.error('סיסמה נוכחית שגויה'); return }
      // Update all re-encrypted vouchers in DB
      await Promise.all(entries.map(({ id, code, cvv }) =>
        updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
      ))
      toast.success(`סיסמת כספת שונתה — ${entries.length} שוברים הוצפנו מחדש`)
      setVaultOldPass(''); setVaultNewPass(''); setVaultNewPass2(''); setVaultNewHint('')
      setShowVaultSection(false)
    } finally {
      setVaultChanging(false)
    }
  }

  async function handleDisableVault() {
    if (!vaultDisablePass) return toast.error('הזן סיסמה נוכחית')
    setVaultDisabling(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await disableVault(vaultDisablePass, e2eeVouchers)
      if (!ok) { toast.error('סיסמה שגויה'); return }
      await Promise.all(entries.map(({ id, code, cvv }) =>
        updateVoucher(id, { code, is_e2ee: false, ...(cvv != null ? { cvv } : {}) })
      ))
      toast.success(`ההצפנה הוסרה — ${entries.length} שוברים פוענחו ונשמרו`)
      setVaultDisablePass('')
      setVaultDisableConfirm(false)
      setShowVaultSection(false)
    } finally {
      setVaultDisabling(false)
    }
  }

  async function handleEncryptAll() {
    if (!encryptAllPass) return toast.error('הזן סיסמת כספת')
    setEncryptingAll(true)
    try {
      const ok = await unlockVault(encryptAllPass)
      if (!ok) { toast.error('סיסמת כספת שגויה'); return }
      const unencrypted = [...vouchers, ...archivedVouchers].filter(v => !v.is_e2ee)
      if (unencrypted.length === 0) { toast('כל השוברים כבר מוצפנים'); setEncryptAllConfirm(false); setEncryptAllPass(''); return }
      let count = 0
      for (const v of unencrypted) {
        try {
          const encCode = await encrypt(v.code)
          const encCvv = v.cvv ? await encrypt(v.cvv) : undefined
          await updateVoucher(v.id, { code: encCode, is_e2ee: true, ...(encCvv != null ? { cvv: encCvv } : {}) })
          count++
        } catch { /* skip individual failures */ }
      }
      toast.success(`${count} שוברים הוצפנו בהצלחה`)
      setEncryptAllConfirm(false)
      setEncryptAllPass('')
    } finally {
      setEncryptingAll(false)
    }
  }

  // Telegram
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null)
  const [telegramCode, setTelegramCode] = useState<string | null>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)

  const reminderKey = `reminder_days_${user?.id}`
  const [reminderDays, setReminderDays] = useState(() =>
    parseInt(localStorage.getItem(`reminder_days_${user?.id}`) || '14')
  )
  const [calendarReminderEnabled, setCalendarReminderEnabled] = useState(
    () => localStorage.getItem(`calendar_reminder_enabled_${user?.id}`) !== 'false'
  )
  const [notifChannels, setNotifChannels] = useState<NotifChannels>(() => getNotifChannels(user?.id))

  // Refs hold latest values so the debounced save always uses current state
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

  // Load settings from Supabase on mount (cross-device sync)
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

  async function saveProfile() {
    await updateProfile({ name, phone })
    setEditName(false)
    toast.success('פרופיל עודכן')
  }

  async function changePassword() {
    if (!currentPass) return toast.error('הזן את הסיסמה הנוכחית')
    if (newPass !== newPass2) return toast.error('הסיסמאות אינן תואמות')
    if (newPass.length < 8) return toast.error('סיסמה חדשה: לפחות 8 תווים')
    setPasswordChanging(true)
    try {
      // Verify current password before touching anything
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user!.email!, password: currentPass })
      if (authErr) return toast.error('סיסמה נוכחית שגויה')

      let vaultEntries: Array<{id: string; code: string; cvv: string|null}> = []

      // For unified vaults, re-derive and re-encrypt under the new password first.
      // Doing this before updateUser means a Supabase failure won't leave the vault
      // keyed to a password Supabase no longer knows.
      if (isUnifiedVault) {
        if (!isVaultUnlocked) return toast.error('יש לפתוח את הכספת לפני שינוי הסיסמה')
        const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
        const { ok, entries } = await reDeriveVaultKeyFromPassword(newPass, e2eeVouchers)
        if (!ok) return toast.error('שגיאה בעדכון הכספת')
        vaultEntries = entries
      }

      // Change the Supabase login password
      const { error } = await supabase.auth.updateUser({ password: newPass })
      if (error) { toast.error('שגיאה בשינוי סיסמה: ' + error.message); return }

      // Save re-encrypted vouchers
      if (vaultEntries.length > 0) {
        await Promise.all(vaultEntries.map(({ id, code, cvv }) =>
          updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
        ))
      }

      toast.success(isUnifiedVault ? `סיסמה שונתה — ${vaultEntries.length} שוברים הוצפנו מחדש` : 'סיסמה שונתה!')
      setEditPass(false)
      setCurrentPass(''); setNewPass(''); setNewPass2('')
      setShowCurrentPass(false); setShowNewPass(false); setShowNewPass2(false); setShowPassStrength(false)
      logAction('system_password_change', 'מערכת')
    } finally {
      setPasswordChanging(false)
    }
  }

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
      await sendExpiryReminderEmail({
        to_email: user.email,
        to_name: profile?.name || user.email,
        count: expiring.length,
        vouchers_list,
      })
      toast.success(`תזכורת נשלחה ל-${user.email}`)
    } catch (err: any) {
      const msg = err?.message || ''
      if (msg.includes('Failed to send') || msg.includes('FunctionsFetchError')) {
        toast.error('Edge Function לא פרוסה — הרץ: npx supabase functions deploy send-email')
      } else {
        toast.error('שגיאה בשליחת התזכורת' + (msg ? ': ' + msg : ''))
      }
    } finally {
      setSendingReminder(false)
    }
  }

  async function handleEnableBiometric() {
    setBiometricLoading(true)
    // When the vault is unlocked, register with vault key wrapping (PRF) so
    // subsequent biometric unlocks can also open the vault automatically.
    const ok = isVaultUnlocked
      ? await enableBiometricVaultUnlock(user?.id || '', profile?.name || user?.email || '', user?.email)
      : await registerBiometric(user?.id || '', profile?.name || user?.email || '', user?.email)
    setBiometricLoading(false)
    if (ok) {
      setBiometricEnabled(true)
      toast.success('נעילה ביומטרית הופעלה!')
      logAction('system_biometric_link', 'מערכת', undefined, { type: 'enabled' })
    } else toast.error('לא ניתן לרשום אימות ביומטרי')
  }

  function handleDisableBiometric() {
    disableBiometric()
    setBiometricEnabled(false)
    toast.success('נעילה ביומטרית בוטלה')
    logAction('system_biometric_link', 'מערכת', undefined, { type: 'disabled' })
  }

  // Load clubs on mount and sync local selection when context updates
  useEffect(() => {
    fetchClubs()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLocalClubIds(userClubIds)
  }, [userClubIds])

  async function handleSaveClubs() {
    setSavingClubs(true)
    try {
      await setUserClubs(localClubIds)
      toast.success(t('settings.clubs.saved'))
    } catch {
      toast.error(t('app.error'))
    } finally {
      setSavingClubs(false)
    }
  }

  // Load wallet members
  useEffect(() => {
    if (!walletId) return
    supabase.from('wallet_members').select('user_id, email, role').eq('wallet_id', walletId)
      .then(({ data }) => { if (data) setMembers(data) })
  }, [walletId])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviteLoading(true)
    try {
      const result = await inviteMember(inviteEmail.trim())
      if (result === 'not_found') {
        setPendingInviteEmail(inviteEmail.trim())
      } else {
        toast.success('החבר נוסף לארנק!')
        logAction('system_wallet_share', 'ארנק', undefined, { email: inviteEmail.trim() })
        setInviteEmail('')
        // Reload members
        if (walletId) {
          const { data } = await supabase.from('wallet_members').select('user_id, email, role').eq('wallet_id', walletId)
          if (data) setMembers(data)
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'שגיאה בהוספת חבר')
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleSendNotFoundInvite() {
    if (!pendingInviteEmail) return
    try {
      await supabase.rpc('send_wallet_invite_to_new_user', {
        p_to_email: pendingInviteEmail,
        p_from_name: profile?.name || user?.email || 'מישהו',
        p_wallet_name: walletName,
        p_app_url: APP_URL,
      })
      toast.success(`הזמנה נשלחה ל-${pendingInviteEmail}`)
    } catch {
      toast.error('שגיאה בשליחת הזמנה')
    } finally {
      setPendingInviteEmail(null)
      setInviteEmail('')
    }
  }

  async function sendSupportMessage() {
    if (!supportSubject.trim() || !supportBody.trim()) return toast.error('נושא וגוף ההודעה הם שדות חובה')
    setSendingSupport(true)
    const { error } = await supabase.from('support_messages').insert({
      user_id: user!.id,
      user_email: user!.email,
      user_name: profile?.name || null,
      subject: supportSubject.trim(),
      body: supportBody.trim(),
      category: supportCategory,
    })
    setSendingSupport(false)
    if (error) return toast.error('שגיאה בשליחה: ' + error.message)
    setSupportSubject(''); setSupportBody(''); setSupportCategory('general')
    setSupportSent(true)
    toast.success('ההודעה נשלחה!')
    // Reload my messages list
    const { data } = await supabase.from('support_messages').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
    if (data) setMyMessages(data)
    setShowMyMessages(true)
  }

  const [deletingAccount, setDeletingAccount] = useState(false)
  async function handleDeleteAccount() {
    // Two-step confirmation for an irreversible action.
    if (!confirm(t('settings.delete.account.confirm1'))) return
    if (!confirm(t('settings.delete.account.confirm2'))) return
    setDeletingAccount(true)
    try {
      // No self-serve hard-delete RPC exists yet; file a deletion request through
      // the same support-message channel the Privacy Policy documents ("Settings →
      // Support, deleted within 30 days"). Keeps this honest without inventing a
      // backend path that can't be verified here.
      const { error } = await supabase.from('support_messages').insert({
        user_id: user!.id,
        user_email: user!.email,
        user_name: profile?.name || null,
        subject: t('settings.delete.account.subject'),
        body: t('settings.delete.account.body'),
        category: 'general',
      })
      if (error) throw error
      toast.success(t('settings.delete.account.sent'))
    } catch (e: any) {
      toast.error(e?.message || t('settings.delete.account.error'))
    } finally {
      setDeletingAccount(false)
    }
  }

  async function loadMyMessages() {
    const { data } = await supabase.from('support_messages').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
    if (!data) return
    // Load replies for each message
    const withReplies = await Promise.all(data.map(async msg => {
      const { data: replies } = await supabase.rpc('get_message_replies', { p_message_id: msg.id })
      return { ...msg, replies: replies || [] }
    }))
    setMyMessages(withReplies)
  }

  async function sendUserReply(messageId: string) {
    const body = replyTexts[messageId]?.trim()
    if (!body) return
    setSendingUserReply(messageId)
    const { error } = await supabase.rpc('user_reply_message', { p_id: messageId, p_body: body })
    setSendingUserReply(null)
    if (error) return toast.error('שגיאה בשליחה: ' + error.message)
    const newReply: SupportMessageReply = {
      id: crypto.randomUUID(),
      message_id: messageId,
      sender: 'user',
      body,
      created_at: new Date().toISOString(),
    }
    setMyMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, replies: [...(m.replies || []), newReply] } : m
    ))
    setReplyTexts(prev => ({ ...prev, [messageId]: '' }))
    toast.success('תשובה נשלחה')
  }

  async function handleRemoveMember(userId: string, email: string) {
    if (!confirm(`להסיר את ${email} מהארנק?`)) return
    await removeMember(userId)
    setMembers(prev => prev.filter(m => m.user_id !== userId))
    toast.success('חבר הוסר מהארנק')
  }

  // Check telegram link status on mount
  useEffect(() => {
    if (!user) return
    supabase
      .from('telegram_users')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setTelegramLinked(!!data))
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load admin broadcasts on mount
  useEffect(() => {
    if (!user) return
    supabase
      .from('admin_broadcasts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { if (data) setAdminBroadcasts(data) })
  }, [user])

  // Realtime: notify user when admin replies to their message
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`replies-${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'support_messages',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        const updated = payload.new as SupportMessage
        if (updated.status === 'replied' && updated.admin_reply) {
          setMyMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
          if (Notification.permission === 'granted') {
            new Notification('תשובה מהמנהל', { body: updated.admin_reply, icon: '/logo.png' })
          }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  async function handleGenerateTelegramCode() {
    if (!user) return
    setTelegramLoading(true)
    try {
      const code = Math.floor(100000 + Math.random() * 900000).toString()
      const { error } = await supabase.from('telegram_link_codes').insert({
        code,
        user_id: user.id,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      })
      if (error) throw error
      setTelegramCode(code)
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
    toast.success('טלגרם נותק')
    logAction('system_telegram_link', 'מערכת', undefined, { type: 'disconnected' })
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

  const pwStrength = useMemo(() => getPasswordStrength(newPass, t), [newPass]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex-1 bg-bg">

      <div className="pb-24 space-y-4">
        <h1 className="text-center text-lg font-extrabold text-text pt-5">{t('settings.title')}</h1>

        {/* Profile hero card */}
        <div
          className="px-5 pt-6 pb-5"
          style={{ background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 100%)' }}
        >
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-[20px] bg-white/20 flex items-center justify-center text-[26px] font-extrabold text-white shrink-0">
              {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              {!editName ? (
                <>
                  <div className="text-xl font-extrabold text-white">{profile?.name || 'ללא שם'}</div>
                  <div className="text-[13px] text-white/70 mt-0.5 truncate">{user?.email}</div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full text-white ${isPro ? 'bg-white/30' : 'bg-white/20'}`}>
                      {isPro ? 'Pro ★' : 'משתמש רגיל'}
                    </span>
                    {isPro && proExpiryDate && (
                      <span className="text-[10px] text-white/65 font-medium">
                        פעיל עד {new Date(proExpiryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2">
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" className="h-[38px] rounded-[10px] border-none bg-white/25 text-white text-base px-3 outline-none placeholder:text-white/60" />
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="טלפון" dir="ltr" className="h-[38px] rounded-[10px] border-none bg-white/25 text-white text-base px-3 outline-none placeholder:text-white/60" />
                  <div className="flex gap-2">
                    <button onClick={saveProfile} className="flex-1 h-9 rounded-[10px] bg-white/25 border-none text-white text-sm font-semibold">{t('app.save')}</button>
                    <button onClick={() => setEditName(false)} className="flex-1 h-9 rounded-[10px] bg-black/15 border-none text-white text-sm font-semibold">{t('app.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
            {!editName && (
              <button onClick={() => setEditName(true)} className="bg-white/15 border-none rounded-[10px] w-9 h-9 flex items-center justify-center shrink-0">
                <Icon name="edit" size={16} color="#fff" />
              </button>
            )}
          </div>
        </div>

        {/* Pro upgrade card */}
        {!isPro && (
          <div
            onClick={() => openUpgradeSheet('שדרג לחוויה מלאה')}
            className="gs-tap mx-4 mb-1 rounded-[18px] px-[18px] py-4 cursor-pointer relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)', boxShadow: '0 4px 24px rgba(0,0,0,0.2)' }}
          >
            <div className="flex items-center gap-3.5">
              <div className="w-[46px] h-[46px] rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg, var(--c-gold) 0%, #e8b422 100%)' }}>
                <Icon name="workspace_premium" size={20} filled color="#fff" />
              </div>
              <div className="flex-1">
                <div className="text-[15px] font-extrabold text-white">שדרג ל-GiftSmart Pro</div>
                <div className="text-xs text-white/60 mt-0.5">שוברים ללא הגבלה · ₪9 לחודש</div>
              </div>
              <Icon name="chevron_left" size={16} color="rgba(255,255,255,0.5)" />
            </div>
          </div>
        )}

        {/* ── אבטחה ── */}
        <SL>{t('settings.security')}</SL>
        <Card>
          {!editPass ? (
            <MenuItem icon="lock" label="שינוי סיסמה" desc="עדכן את סיסמת הכניסה" onClick={() => setEditPass(true)} />
          ) : (
            <div className="p-4 space-y-3">
              {/* Unified-vault notice */}
              {isUnifiedVault && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800 flex items-start gap-2">
                  <Icon name="shield" size={14} className="flex-shrink-0 mt-0.5" />
                  <p>הכספת מוגנת בסיסמת הכניסה — <strong>הסיסמה החדשה תהיה גם מפתח הכספת</strong> ותצפין מחדש את כל השוברים.</p>
                </div>
              )}

              {/* Current password */}
              <div className="relative">
                <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showCurrentPass ? 'text' : 'password'}
                  value={currentPass}
                  onChange={e => setCurrentPass(e.target.value)}
                  placeholder="סיסמה נוכחית"
                  className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  dir="ltr"
                  autoFocus
                />
                <button type="button" onClick={() => setShowCurrentPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                  <Icon name={showCurrentPass ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>

              {/* New password + strength meter */}
              <div>
                <div className="relative">
                  <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPass}
                    onChange={e => { setNewPass(e.target.value); setShowPassStrength(true) }}
                    placeholder="סיסמה חדשה (לפחות 8 תווים)"
                    className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                    <Icon name={showNewPass ? 'visibility_off' : 'visibility'} size={16} />
                  </button>
                </div>
                {showPassStrength && newPass.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className={`flex-1 h-1.5 rounded-full ${i < pwStrength.score ? pwStrength.color : 'bg-bg'}`} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${pwStrength.score >= 3 ? 'text-primary' : 'text-warning'}`}>{pwStrength.label}</span>
                      {pwStrength.score >= 3 && <Icon name="verified_user" size={16} color="var(--c-primary)" />}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {pwStrength.checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1 text-xs ${c.ok ? 'text-primary' : 'text-text3'}`}>
                          <Icon name="check" size={12} className="flex-shrink-0" color={c.ok ? 'var(--c-primary)' : 'var(--c-border)'} />
                          {c.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div className="relative">
                <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showNewPass2 ? 'text' : 'password'}
                  value={newPass2}
                  onChange={e => setNewPass2(e.target.value)}
                  placeholder="אימות סיסמה חדשה"
                  className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowNewPass2(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                  <Icon name={showNewPass2 ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={changePassword}
                  disabled={passwordChanging || !currentPass || !newPass || !newPass2}
                  className="flex-1 bg-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                >
                  {passwordChanging ? 'משנה...' : isUnifiedVault ? 'שנה סיסמה ועדכן כספת' : 'שנה סיסמה'}
                </button>
                <button
                  onClick={() => {
                    setEditPass(false)
                    setCurrentPass(''); setNewPass(''); setNewPass2('')
                    setShowCurrentPass(false); setShowNewPass(false); setShowNewPass2(false); setShowPassStrength(false)
                  }}
                  className="flex-1 bg-bg text-text2 py-2.5 rounded-xl text-sm font-medium"
                >
                  {t('app.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Biometric */}
          {isBiometricSupported() && (
            <div className="border-t border-border">
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
                  <Icon name="fingerprint" size={20} color="var(--c-text2)" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">נעילה ביומטרית</p>
                  <p className="text-xs text-text3">
                    {biometricEnabled ? 'פעיל — Face ID / טביעת אצבע' : 'כבוי'}
                  </p>
                </div>
                {biometricEnabled ? (
                  <button
                    onClick={handleDisableBiometric}
                    className="text-xs text-error font-medium px-3 py-1.5 bg-error/10 rounded-xl"
                  >
                    בטל
                  </button>
                ) : (
                  <button
                    onClick={handleEnableBiometric}
                    disabled={biometricLoading}
                    className="text-xs text-primary font-medium px-3 py-1.5 bg-primary-light rounded-xl disabled:opacity-50"
                  >
                    {biometricLoading ? '...' : 'הפעל'}
                  </button>
                )}
              </div>
            </div>
          )}
          {/* E2EE Vault */}
          {hasVault && (
            <div className="border-t border-border">
            <button
              onClick={() => setShowVaultSection(s => !s)}
              className="flex items-center gap-3 w-full p-4 text-right hover:bg-bg"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Icon name="shield" size={20} color="#6366f1" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text">{t('settings.vault')}</p>
                <p className="text-xs text-text3">{isVaultUnlocked ? 'פתוחה כעת' : 'נעולה'} · שנה סיסמה או אפס</p>
              </div>
              <Icon name={showVaultSection ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
            </button>

            {showVaultSection && (
              <div className="px-4 pb-4 space-y-3">

                {/* Single consolidated "must-read" notice */}
                <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-warning flex items-center gap-2">
                    <Icon name="shield" size={14} className="flex-shrink-0" /> חובה לקרוא — כדי לא לאבד את הנתונים שלך
                  </p>
                  {isUnifiedVault ? (
                    <>
                      <p className="text-xs text-warning leading-relaxed">
                        הכספת מוצפנת עם <strong>סיסמת הכניסה שלך</strong> — הסיסמה אינה נשמרת בשרתנו.
                      </p>
                      <ul className="text-xs text-warning space-y-1 list-disc pr-4">
                        <li><strong>שחזור סיסמה בדוא"ל לא ישחזר נתונים מוצפנים</strong> — שמור את מפתח השחזור במקום בטוח.</li>
                        <li>לשינוי סיסמה: השתמש בקטע "שינוי סיסמה" למעלה — הכספת תוצפן מחדש אוטומטית.</li>
                        <li>שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</li>
                      </ul>
                      {isVaultUnlocked && (
                        <button
                          onClick={() => regenerateRecoveryKey().catch(() => {})}
                          className="text-xs font-semibold text-warning flex items-center gap-1"
                        >
                          <Icon name="key" size={12} /> הצג / חדש מפתח שחזור
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-warning leading-relaxed">
                        <strong>הסיסמה אינה ניתנת לשחזור</strong> — שמור אותה במקום בטוח. איבוד הסיסמה יגרום לאיבוד הנתונים המוצפנים לצמיתות.
                      </p>
                      <p className="text-xs text-warning">שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</p>
                      <p className="text-xs text-warning">שינוי סיסמה יצפין מחדש אוטומטית את כל השוברים המוצפנים שלך.</p>
                    </>
                  )}
                </div>

                {/* Hint display */}
                {hint && (
                  <div className="bg-indigo-50 rounded-xl px-3 py-2 text-xs text-indigo-700">
                    רמז נוכחי: <span className="font-medium">{hint}</span>
                  </div>
                )}

                {/* Recovery key unlock — shown when vault is locked */}
                {!isVaultUnlocked && localStorage.getItem('gs_e2ee_recovery_wrapped') && (
                  <div className="bg-primary-light border border-primary/20 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-primary flex items-center gap-1">
                      <Icon name="key" size={14} /> פתח עם מפתח שחזור
                    </p>
                    <p className="text-xs text-primary">
                      שכחת סיסמה? הזן את מפתח השחזור שקיבלת בעת הגדרת הכספת.
                    </p>
                    {!showRecoveryUnlock ? (
                      <button
                        onClick={() => setShowRecoveryUnlock(true)}
                        className="text-xs font-semibold text-primary"
                      >
                        השתמש במפתח שחזור ←
                      </button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <input
                          type="text"
                          placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                          value={recoveryPhrase}
                          onChange={e => setRecoveryPhrase(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleRecoveryUnlock()}
                          className="w-full px-3 py-2 border border-primary/30 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono tracking-widest"
                          dir="ltr"
                          autoFocus
                          autoComplete="off"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleRecoveryUnlock}
                            disabled={recoveryUnlocking || !recoveryPhrase.trim()}
                            className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {recoveryUnlocking ? <Spinner size={14} color="#fff" /> : <Icon name="key" size={12} />}
                            {recoveryUnlocking ? 'פותח...' : 'פתח כספת'}
                          </button>
                          <button
                            onClick={() => { setShowRecoveryUnlock(false); setRecoveryPhrase('') }}
                            className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs"
                          >
                            {t('app.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Migration banner — shown only for old-format vaults */}
                {!isUnifiedVault && (
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-blue-800 flex items-center gap-1">
                      <Icon name="shield" size={14} /> שדרג לסיסמה אחת
                    </p>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      הכספת שלך עדיין דורשת סיסמה נפרדת מסיסמת הכניסה.
                      לאחד — הכספת תיפתח אוטומטית בכל כניסה.
                    </p>
                    {!showMigrateSection ? (
                      <button
                        onClick={() => setShowMigrateSection(true)}
                        className="text-xs font-semibold text-blue-600"
                      >
                        אחד עכשיו ←
                      </button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <input
                          type="password"
                          placeholder="סיסמת כספת נוכחית"
                          value={migrateVaultPass}
                          onChange={e => setMigrateVaultPass(e.target.value)}
                          className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-blue-300"
                          dir="ltr"
                          autoComplete="current-password"
                        />
                        <input
                          type="password"
                          placeholder="סיסמת כניסה לאתר"
                          value={migrateLoginPass}
                          onChange={e => setMigrateLoginPass(e.target.value)}
                          className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-blue-300"
                          dir="ltr"
                          autoComplete="current-password"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleMigrateVault}
                            disabled={migrating || !migrateVaultPass || !migrateLoginPass}
                            className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                          >
                            {migrating ? 'מאחד...' : 'אחד סיסמאות'}
                          </button>
                          <button
                            onClick={() => { setShowMigrateSection(false); setMigrateVaultPass(''); setMigrateLoginPass('') }}
                            className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs"
                          >
                            ביטול
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Vault passphrase change — only for non-unified vaults */}
                {!isUnifiedVault && (
                  <>
                    <input
                      type="password"
                      value={vaultOldPass}
                      onChange={e => setVaultOldPass(e.target.value)}
                      placeholder="סיסמה נוכחית"
                      className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="current-password"
                      name="vault-current-password"
                    />
                    <input
                      type="password"
                      value={vaultNewPass}
                      onChange={e => setVaultNewPass(e.target.value)}
                      placeholder="סיסמה חדשה (לפחות 8 תווים)"
                      className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="new-password"
                      name="vault-new-password"
                    />
                    <input
                      type="password"
                      value={vaultNewPass2}
                      onChange={e => setVaultNewPass2(e.target.value)}
                      placeholder="אימות סיסמה חדשה"
                      className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="new-password"
                      name="vault-new-password-confirm"
                    />
                    <input
                      type="text"
                      value={vaultNewHint}
                      onChange={e => setVaultNewHint(e.target.value)}
                      placeholder="רמז לסיסמה החדשה (אופציונלי)"
                      className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      autoComplete="off"
                      name="vault-new-hint"
                    />
                    <button
                      onClick={handleChangeVaultPassphrase}
                      disabled={vaultChanging || !vaultOldPass || !vaultNewPass || !vaultNewPass2}
                      className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                    >
                      {vaultChanging ? 'מצפין מחדש...' : t('e2ee.change')}
                    </button>
                  </>
                )}

                <div className="border-t border-border pt-3 space-y-3">
                  {/* Default encryption for new vouchers */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">הצפן שוברים חדשים כברירת מחדל</p>
                      <p className="text-xs text-text3 mt-0.5">כל שובר חדש שיתווסף יוצפן אוטומטית</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={e2eeDefaultNew}
                      onClick={() => {
                        const next = !e2eeDefaultNew
                        setE2eeDefaultNew(next)
                        localStorage.setItem('gs_e2ee_default', String(next))
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${e2eeDefaultNew ? 'bg-indigo-600' : 'bg-border'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${e2eeDefaultNew ? 'translate-x-0.5' : 'right-0.5'}`} />
                    </button>
                  </div>

                  {/* Encrypt all unencrypted vouchers */}
                  {!encryptAllConfirm ? (
                    <button
                      onClick={() => setEncryptAllConfirm(true)}
                      className="text-xs text-indigo-600 font-medium"
                    >
                      הצפן את כל השוברים שעדיין לא מוצפנים
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-warning flex items-center gap-1">
                        <Icon name="shield" size={14} /> שים לב — פעולה בלתי הפיכה
                      </p>
                      <p className="text-xs text-warning">
                        קודי השוברים יוצפנו עם סיסמת הכספת הנוכחית.
                        <strong> אם תשכח את הסיסמה — הנתונים יאבדו לצמיתות.</strong>
                        <br />ודא שהסיסמה שמורה במקום בטוח לפני המשך.
                      </p>
                      <input
                        type="password"
                        placeholder="אמת סיסמת כספת"
                        value={encryptAllPass}
                        onChange={e => setEncryptAllPass(e.target.value)}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                        dir="ltr"
                        autoComplete="current-password"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleEncryptAll}
                          disabled={encryptingAll || !encryptAllPass}
                          className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                        >
                          {encryptingAll ? 'מצפין...' : 'הצפן הכל'}
                        </button>
                        <button
                          onClick={() => { setEncryptAllConfirm(false); setEncryptAllPass('') }}
                          className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs"
                        >
                          ביטול
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Remove encryption (decrypt in place) */}
                  {!vaultDisableConfirm ? (
                    <button
                      onClick={() => setVaultDisableConfirm(true)}
                      className="text-xs text-warning"
                    >
                      הסר הצפנה (פענח שוברים ושמור בטקסט רגיל)
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-warning font-medium">
                        הקודים יפוענחו ויישמרו ב-DB ללא הצפנה. הנתונים לא ימחקו.
                      </p>
                      <input
                        type="password"
                        placeholder="סיסמת כספת נוכחית"
                        value={vaultDisablePass}
                        onChange={e => setVaultDisablePass(e.target.value)}
                        className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-warning/40"
                        autoComplete="current-password"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleDisableVault}
                          disabled={vaultDisabling || !vaultDisablePass}
                          className="flex-1 py-2 bg-warning text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                        >
                          {vaultDisabling ? 'מפענח...' : 'הסר הצפנה'}
                        </button>
                        <button
                          onClick={() => { setVaultDisableConfirm(false); setVaultDisablePass('') }}
                          className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs"
                        >
                          {t('app.cancel')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Hard reset (data stays encrypted, unreadable) */}
                  {!vaultResetConfirm ? (
                    <button
                      onClick={() => setVaultResetConfirm(true)}
                      className="text-xs text-error"
                    >
                      אפס כספת (מחק את כל ההצפנה)
                    </button>
                  ) : (
                    <div className="bg-error/10 border border-error/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-error font-medium">
                        אזהרה: איפוס הכספת ישאיר את קודי השוברים בDB מוצפנים ולא ניתן יהיה לקרוא אותם! יש לוודא תחילה שאין שוברי E2EE חשובים.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { resetVault(); toast.success('כספת אופסה'); setVaultResetConfirm(false); setShowVaultSection(false) }}
                          className="flex-1 py-2 bg-error text-white rounded-xl text-xs font-semibold"
                        >
                          {t('e2ee.reset')}
                        </button>
                        <button
                          onClick={() => setVaultResetConfirm(false)}
                          className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs"
                        >
                          {t('app.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          )}
        </Card>

        {/* ── התראות ואינטגרציות ── */}
        <SL>התראות ואינטגרציות</SL>
        <Card>
          {/* Reminder days */}
          <div className="p-4">
            {/* Google Calendar toggle */}
            <label className="flex items-center justify-between cursor-pointer mb-4">
              <div className="flex items-center gap-2">
                <Icon name="calendar_month" size={16} color="#3b82f6" />
                <span className="text-sm text-text2">{t('settings.calendar.enabled')}</span>
              </div>
              <button
                role="switch"
                aria-checked={calendarReminderEnabled}
                onClick={() => saveCalendarEnabled(!calendarReminderEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${calendarReminderEnabled ? 'bg-primary' : 'bg-border'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${calendarReminderEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <p className="text-sm text-text2 mb-3">שלח תזכורת <strong>{reminderDays}</strong> ימים לפני שהשובר יפוג</p>
            <div className="flex items-center gap-3">
              <input
                type="range" min={1} max={90} value={reminderDays}
                onChange={e => saveReminderDays(parseInt(e.target.value))}
                className="flex-1 accent-primary"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number" min={1} max={90} value={reminderDays}
                  onChange={e => saveReminderDays(parseInt(e.target.value) || 1)}
                  className="w-14 text-center px-2 py-1.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <span className="text-sm text-text3">ימים</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-text3 mt-1 px-0.5">
              <span>1 יום</span>
              <span>90 ימים</span>
            </div>
            {/* Notification channels */}
            <div className="mt-4 pt-3 border-t border-border">
              <p className="text-xs font-semibold text-text3 mb-2">{t('settings.notif.channels')}</p>
              <p className="text-xs text-text3 mb-3">{t('settings.notif.channels.note')}</p>
              <div className="space-y-2">
                {/* Push */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon name="notifications" size={16} color="var(--c-warning)" />
                    <span className="text-sm text-text2">{t('settings.notif.push')}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.push}
                    onClick={() => updateNotifChannel('push', !notifChannels.push)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.push ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.push ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
                {/* Email */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon name="mail" size={16} color="#3b82f6" />
                    <span className="text-sm text-text2">{t('settings.notif.email')}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.email}
                    onClick={() => updateNotifChannel('email', !notifChannels.email)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.email ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.email ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
                {/* Telegram */}
                <label className={`flex items-center justify-between ${!telegramLinked ? 'opacity-50' : 'cursor-pointer'}`}>
                  <div className="flex items-center gap-2">
                    <Icon name="send" size={16} color="#0ea5e9" />
                    <div>
                      <span className="text-sm text-text2">{t('settings.notif.telegram')}</span>
                      {!telegramLinked && <p className="text-[10px] text-text3">יש לקשר טלגרם תחילה</p>}
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.telegram}
                    onClick={() => telegramLinked && updateNotifChannel('telegram', !notifChannels.telegram)}
                    disabled={!telegramLinked}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.telegram && telegramLinked ? 'bg-primary' : 'bg-border'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.telegram && telegramLinked ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
              </div>
            </div>
          </div>
          {/* Telegram */}
          <div className="border-t border-border">
            {telegramLinked ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
                    <Icon name="send" size={20} color="#0ea5e9" />
                  </div>
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
                  <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
                    <Icon name="send" size={20} color="var(--c-text3)" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-text">קשר לטלגרם</p>
                    <p className="text-xs text-text3">קבל את כל ההתראות גם בטלגרם</p>
                  </div>
                  {!telegramCode && (
                    <button
                      onClick={handleGenerateTelegramCode}
                      disabled={telegramLoading}
                      className="text-xs font-medium px-3 py-1.5 bg-bg text-text2 rounded-xl flex items-center gap-1 disabled:opacity-50"
                    >
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

        {/* ── שיתוף וחברים ── */}
        <SL>שיתוף וחברים</SL>
        <Card>
          <div className="p-4 space-y-3">
            {members.length > 0 && (
              <div className="space-y-1 mb-2">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm text-text2">{m.email}</p>
                      <p className="text-xs text-text3">{m.role === 'owner' ? 'בעלים' : 'חבר'}</p>
                    </div>
                    {m.role !== 'owner' && (
                      <button onClick={() => handleRemoveMember(m.user_id, m.email)} className="p-1.5 text-error rounded-lg">
                        <Icon name="delete" size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pendingInviteEmail && (
              <div className="bg-warning/10 rounded-2xl p-3 space-y-2">
                <p className="text-sm text-warning">המשתמש <strong>{pendingInviteEmail}</strong> אינו רשום באפליקציה. לשלוח הזמנה להצטרף?</p>
                <div className="flex gap-2">
                  <button onClick={handleSendNotFoundInvite} className="flex-1 bg-warning text-white py-2 rounded-xl text-sm font-medium">שלח הזמנה</button>
                  <button onClick={() => { setPendingInviteEmail(null); setInviteEmail('') }} className="flex-1 bg-bg text-text2 py-2 rounded-xl text-sm font-medium">{t('app.cancel')}</button>
                </div>
              </div>
            )}
            {!pendingInviteEmail && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Icon name="person_add" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder="כתובת מייל לשיתוף"
                    className="w-full pr-9 pl-3 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                    dir="ltr"
                  />
                </div>
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail.trim()}
                  className="px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  {inviteLoading ? <Spinner size={16} color="#fff" /> : 'הוסף'}
                </button>
              </div>
            )}
            <p className="text-xs text-text3">חברים בארנק רואים את כל השוברים שלך ויכולים לעדכן יתרות.</p>
          </div>
        </Card>

        {/* ── מראה ושפה ── */}
        <SL>מראה ושפה</SL>
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
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: theme === 'dark' ? 'translateX(-24px)' : 'translateX(-4px)' }}
              />
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
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className={`px-3 py-1 text-xs font-semibold transition-colors ${locale === l ? 'bg-primary text-white' : 'bg-surface text-text2'}`}
                >
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

        {/* ── ניווט מהיר ── */}
        <SL>{t('settings.quick.nav')}</SL>
        <Card>
          <div className="divide-y divide-border">
            <MenuItem
              icon="archive"
              label={t('nav.archive')}
              desc={t('settings.quick.archive.desc')}
              onClick={() => navigate('/archive')}
              right={archivedVouchers.length > 0 ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-bg text-text3">{archivedVouchers.length}</span> : undefined}
            />
            <MenuItem
              icon="storefront"
              label={t('market.marketplace')}
              desc={t('settings.quick.market.desc')}
              onClick={() => navigate('/market')}
            />
            <MenuItem
              icon="percent"
              label={t('nav.discounts')}
              desc={t('settings.quick.discounts.desc')}
              onClick={() => navigate('/discounts')}
            />
          </div>
        </Card>

        {/* ── הכרטיסים והמועדונים שלי ── */}
        <SL>{t('settings.my_clubs')}</SL>
        <Card>
          <button
            onClick={() => setClubsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 text-right"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text">{t('settings.my_clubs')}</p>
              <p className="text-xs mt-0.5 text-text3">{t('settings.my_clubs.sub')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 mr-2">
              {localClubIds.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-white">
                  {localClubIds.length}
                </span>
              )}
              <Icon name={clubsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
            </div>
          </button>

          {clubsOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-border">
              {clubs.length === 0 ? (
                <p className="text-sm text-center py-4 text-text3">
                  {t('app.loading')}
                </p>
              ) : (
                <>
                  {/* Credit cards */}
                  {clubs.filter(c => c.type === 'credit_card').length > 0 && (
                    <div className="pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon name="credit_card" size={16} color="var(--c-primary)" />
                        <span className="text-xs font-bold uppercase tracking-wide text-text3">
                          {t('settings.clubs.credit_card')}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {clubs.filter(c => c.type === 'credit_card').map(club => {
                          const selected = localClubIds.includes(club.id)
                          return (
                            <button
                              key={club.id}
                              onClick={() => setLocalClubIds(prev =>
                                selected ? prev.filter(id => id !== club.id) : [...prev, club.id]
                              )}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                                selected
                                  ? 'border-primary bg-primary-light text-primary'
                                  : 'border-border bg-surface text-text2'
                              }`}
                            >
                              {selected && <Icon name="check" size={12} />}
                              {club.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Loyalty clubs */}
                  {clubs.filter(c => c.type === 'loyalty_club').length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon name="sell" size={16} color="var(--c-primary)" />
                        <span className="text-xs font-bold uppercase tracking-wide text-text3">
                          {t('settings.clubs.loyalty_club')}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {clubs.filter(c => c.type === 'loyalty_club').map(club => {
                          const selected = localClubIds.includes(club.id)
                          return (
                            <button
                              key={club.id}
                              onClick={() => setLocalClubIds(prev =>
                                selected ? prev.filter(id => id !== club.id) : [...prev, club.id]
                              )}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all ${
                                selected
                                  ? 'border-primary bg-primary-light text-primary'
                                  : 'border-border bg-surface text-text2'
                              }`}
                            >
                              {selected && <Icon name="check" size={12} />}
                              {club.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleSaveClubs}
                    disabled={savingClubs}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 bg-primary"
                  >
                    {savingClubs ? <Spinner size={16} color="#fff" /> : <Icon name="check" size={16} />}
                    {t('app.save')}
                  </button>
                </>
              )}
            </div>
          )}
        </Card>

        {/* ── פיצ'רים ── */}
        <SL>פיצ'רים</SL>
        <Card>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 ml-3">
              <p className="text-sm font-medium text-text">הצג ערך שוק של שוברים</p>
              <p className="text-xs text-text3 mt-0.5">מאפשר הזנת % ערך לכל שובר ומציג כמה % פחות הוא שווה מהנקוב</p>
            </div>
            <button
              onClick={() => updateProfile({ show_voucher_value: !profile?.show_voucher_value })}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${profile?.show_voucher_value ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${profile?.show_voucher_value ? 'translate-x-0.5' : 'right-0.5'}`} />
            </button>
          </div>
        </Card>

        {/* ── כלים ── */}
        <SL>כלים</SL>
        <Card>
          <div className="divide-y divide-border">
            <MenuItem icon="cloud_upload" label="סנכרן שוברים לענן" desc={isOnline ? 'העלה שוברים מ-cache לסופאבייס' : 'אין חיבור לאינטרנט'} onClick={handleSync} right={syncing ? <Spinner size={20} /> : undefined} />
            <MenuItem icon="notifications" label="שלח תזכורת תוקף" desc="מייל עם רשימת שוברים שפגי תוקף בקרוב" onClick={handleSendExpiryReminder} right={sendingReminder ? <Spinner size={20} color="var(--c-warning)" /> : undefined} />
            <MenuItem icon="wifi" label="בדוק חיבור" desc="בדיקת תקינות חיבור לבסיס הנתונים" onClick={handleCheckConnection} right={checking ? <Spinner size={20} color="#3b82f6" /> : undefined} />
          </div>
        </Card>

        {/* ── תמיכה (Pro) + הודעות מערכת + יומן פעילות ── */}
        {isPro && (
          <>
          <SL>תמיכה</SL>
          <Card>
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-end">
              <button onClick={() => { if (!showMyMessages) loadMyMessages(); setShowMyMessages(v => !v) }} className="text-xs text-primary flex items-center gap-1">
                ההודעות שלי
                <Icon name={showMyMessages ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={14} />
              </button>
            </div>
            {!supportSent ? (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input value={supportSubject} onChange={e => setSupportSubject(e.target.value)} placeholder="נושא" className="flex-1 min-w-0 px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  <select value={supportCategory} onChange={e => setSupportCategory(e.target.value)} className="shrink-0 w-28 px-2 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30">
                    <option value="general">כללי</option>
                    <option value="billing">חיוב</option>
                    <option value="bug">באג</option>
                    <option value="feature">פיצ'ר</option>
                  </select>
                </div>
                <textarea value={supportBody} onChange={e => setSupportBody(e.target.value)} placeholder="תאר את הבעיה או הבקשה שלך..." rows={3} className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                <button onClick={sendSupportMessage} disabled={sendingSupport} className="w-full bg-primary text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                  <Icon name="send" size={16} />
                  {sendingSupport ? 'שולח...' : 'שלח הודעה'}
                </button>
              </div>
            ) : (
              <div className="p-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 bg-primary-light rounded-2xl flex items-center justify-center"><Icon name="check" size={20} color="var(--c-primary)" /></div>
                <p className="text-sm font-medium text-text">ההודעה נשלחה!</p>
                <p className="text-xs text-text3">נחזור אליך בהקדם</p>
                <button onClick={() => setSupportSent(false)} className="text-xs text-primary mt-1">שלח הודעה נוספת</button>
              </div>
            )}
            {showMyMessages && (
              <div className="border-t border-border">
                {myMessages.length === 0 ? (
                  <p className="text-center text-xs text-text3 py-4">אין הודעות קודמות</p>
                ) : (
                  <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
                    {myMessages.map(m => {
                      const isExpanded = expandedMessageId === m.id
                      const hasReplies = (m.replies?.length ?? 0) > 0
                      const hasAdminReply = m.admin_reply || m.replies?.some(r => r.sender === 'admin')
                      return (
                        <div key={m.id} className="px-4 py-3">
                          <button className="w-full text-right" onClick={() => { setExpandedMessageId(isExpanded ? null : m.id); if (!isExpanded) { void supabase.rpc('user_mark_message_read', { p_message_id: m.id }) } }}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-text">{m.subject}</p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {hasAdminReply && <span className="text-[10px] bg-primary-light text-primary px-1.5 py-0.5 rounded-full font-medium">נענה</span>}
                                {!hasAdminReply && <span className="text-[10px] bg-bg text-text3 px-1.5 py-0.5 rounded-full">בטיפול</span>}
                                <span className="text-xs text-text3 flex items-center gap-0.5"><Icon name="schedule" size={12} />{formatDate(m.created_at)}</span>
                              </div>
                            </div>
                            {!isExpanded && <p className="text-xs text-text3 mt-0.5 line-clamp-1 text-right">{m.body}</p>}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 space-y-2">
                              <div className="flex justify-end">
                                <div className="bg-primary text-white rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                  <p className="text-xs">{m.body}</p>
                                  <p className="text-[10px] text-white/70 mt-0.5">{formatDate(m.created_at)}</p>
                                </div>
                              </div>
                              {hasReplies ? (
                                m.replies!.map(r => (
                                  <div key={r.id} className={`flex ${r.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`rounded-2xl px-3 py-2 max-w-[85%] ${r.sender === 'user' ? 'bg-primary text-white rounded-tl-sm' : 'bg-bg text-text rounded-tr-sm'}`}>
                                      {r.sender === 'admin' && <p className="text-[10px] font-semibold text-primary mb-0.5">תמיכה</p>}
                                      <p className="text-xs">{r.body}</p>
                                      <p className={`text-[10px] mt-0.5 ${r.sender === 'user' ? 'text-white/70' : 'text-text3'}`}>{formatDate(r.created_at)}</p>
                                    </div>
                                  </div>
                                ))
                              ) : m.admin_reply ? (
                                <div className="flex justify-start">
                                  <div className="bg-bg text-text rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                    <p className="text-[10px] font-semibold text-primary mb-0.5">תמיכה</p>
                                    <p className="text-xs">{m.admin_reply}</p>
                                    {m.replied_at && <p className="text-[10px] text-text3 mt-0.5">{formatDate(m.replied_at)}</p>}
                                  </div>
                                </div>
                              ) : null}
                              {hasAdminReply && (
                                <div className="flex gap-1.5 mt-1">
                                  <input value={replyTexts[m.id] || ''} onChange={e => setReplyTexts(prev => ({ ...prev, [m.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserReply(m.id) } }} placeholder="כתוב תשובה..." className="flex-1 px-3 py-2 border border-border rounded-xl text-xs bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" />
                                  <button onClick={() => sendUserReply(m.id)} disabled={sendingUserReply === m.id || !replyTexts[m.id]?.trim()} className="px-3 py-2 bg-primary text-white rounded-xl text-xs disabled:opacity-40 flex items-center gap-1"><Icon name="send" size={12} /></button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </Card>
          </>
        )}

        {adminBroadcasts.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text2 flex items-center gap-2">
                <Icon name="notifications" size={16} color="#3b82f6" />
                הודעות מערכת
              </h3>
              {adminBroadcasts.some(b => !seenBroadcastIds.has(b.id)) && (
                <span className="text-xs font-bold bg-primary text-white px-1.5 py-0.5 rounded-full">
                  {adminBroadcasts.filter(b => !seenBroadcastIds.has(b.id)).length}
                </span>
              )}
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {adminBroadcasts.map(b => {
                const isNew = !seenBroadcastIds.has(b.id)
                return (
                  <div key={b.id} className={`px-4 py-3 ${isNew ? 'bg-primary-light/40' : ''}`}
                    onMouseEnter={() => {
                      if (isNew) {
                        setSeenBroadcastIds(prev => { const next = new Set(prev); next.add(b.id); localStorage.setItem('seen_broadcast_ids', JSON.stringify([...next])); return next })
                        void supabase.rpc('record_broadcast_view', { p_broadcast_id: b.id })
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${isNew ? 'text-text' : 'text-text2'}`}>{b.subject}</p>
                      <span className="text-xs text-text3 flex-shrink-0">{formatDate(b.created_at)}</span>
                    </div>
                    <p className="text-xs text-text3 mt-0.5">{b.body}</p>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <ActivityLog />

        {/* ── נגישות ופרטיות ── */}
        <SL>נגישות ופרטיות</SL>
        <Card>
          <div className="flex items-center justify-between p-4 border-b border-border">
            <div className="flex-1">
              <p className="text-sm font-medium text-text">הצג כפתור נגישות</p>
              <p className="text-xs text-text3 mt-0.5">כפתור צף לשינוי גודל טקסט, ניגודיות ועוד</p>
            </div>
            <button
              role="switch"
              aria-checked={a11yWidgetEnabled}
              onClick={() => {
                const next = !a11yWidgetEnabled
                setA11yWidgetEnabled(next)
                localStorage.setItem('a11y_widget_enabled', String(next))
                window.dispatchEvent(new Event('a11y-widget-toggle'))
              }}
              aria-label="הצג כפתור נגישות"
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${a11yWidgetEnabled ? 'bg-primary' : 'bg-border'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${a11yWidgetEnabled ? 'translate-x-0.5' : 'right-0.5'}`} />
            </button>
          </div>
          <a href="/accessibility" className="block px-4 py-3 text-xs text-primary border-b border-border">
            הצהרת נגישות ←
          </a>
          <div className="divide-y divide-border">
            <MenuItem
              icon="menu_book"
              label={t('settings.onboarding')}
              desc="הצג מחדש את מדריך הפיצ׳רים"
              onClick={() => {
                localStorage.removeItem('onboarding_seen_v2')
                navigate('/')
                setTimeout(() => window.dispatchEvent(new Event('show-onboarding')), 120)
              }}
            />
            <MenuItem
              icon="description"
              label="תנאי שימוש"
              desc="הסכם השימוש בשירות GiftSmart"
              onClick={() => navigate('/terms')}
            />
            <MenuItem
              icon="shield"
              label="מדיניות פרטיות"
              desc="כיצד אנו מגינים על המידע שלך"
              onClick={() => navigate('/privacy')}
            />
            {isAdmin && (
              <MenuItem
                icon="verified_user"
                label={t('settings.admin.link')}
                desc={t('settings.admin.link.desc')}
                onClick={() => navigate('/admin')}
              />
            )}
            <MenuItem
              icon="delete"
              label={t('settings.delete.account')}
              desc={t('settings.delete.account.desc')}
              onClick={handleDeleteAccount}
              danger
              right={deletingAccount ? <Spinner size={20} color="var(--c-error)" /> : undefined}
            />
            <MenuItem
              icon="logout"
              label={t('settings.logout')}
              desc="יציאה מהחשבון"
              onClick={() => { if (confirm('להתנתק?')) signOut() }}
              danger
            />
          </div>
        </Card>

        <p className="text-center text-xs text-text3">GiftSmart v1.1.0</p>
      </div>
    </div>
  )
}
