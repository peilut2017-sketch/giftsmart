import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../utils/helpers'
import { sendExpiryReminderEmail } from '../lib/emailService'
import { Lock, CloudUpload, Wifi, LogOut, ChevronRight, Check, Bell, Fingerprint, Send, Link, Link2Off, Trash2, UserPlus, Crown, ChevronDown, ChevronUp, Clock, Pencil, BookOpen, Shield, ShieldCheck, Moon, Sun, Globe, CreditCard, Tag, FileText, Key, Eye, EyeOff, Mail, CalendarDays } from 'lucide-react'
import { getNotifChannels, saveNotifChannels, type NotifChannels } from '../hooks/useNotifications'
import toast from 'react-hot-toast'
import ActivityLog from '../components/ActivityLog'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../lib/passkey'
import { useE2EE } from '../contexts/E2EEContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLocale, useT } from '../lib/i18n'
import { useDiscounts } from '../contexts/DiscountsContext'

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
  const colors = ['bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-green-400', 'bg-green-600']
  return { score, label: labels[Math.min(score, 4)], color: colors[Math.min(score, 4)], checks }
}

function MenuItem({ icon: Icon, label, desc, onClick, danger = false, right }: { icon: React.ElementType; label: string; desc?: string; onClick?: () => void; danger?: boolean; right?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition-colors rounded-2xl text-right ${danger ? 'text-red-600' : ''}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${danger ? 'bg-red-50' : 'bg-gray-100'}`}>
        <Icon className={`w-5 h-5 ${danger ? 'text-red-500' : 'text-gray-600'}`} />
      </div>
      <div className="flex-1">
        <p className={`text-sm font-medium ${danger ? 'text-red-600' : 'text-gray-800'}`}>{label}</p>
        {desc && <p className="text-xs text-gray-400">{desc}</p>}
      </div>
      {right || <ChevronRight className="w-4 h-4 text-gray-300 rotate-180" />}
    </button>
  )
}

function SL({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>{children}</div>
}

function Card({ children, noPad = false }: { children: React.ReactNode; noPad?: boolean }) {
  return <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px', ...(noPad ? {} : {}) }}>{children}</div>
}

interface WalletMemberRow {
  user_id: string
  email: string
  role: string
}

export default function SettingsPage() {
  const navigate = useNavigate()
  const { user, profile, signOut, updateProfile } = useAuth()
  const { isPro, proExpiryDate, openUpgradeSheet } = useSubscription()
  const { syncToCloud, isOnline, refreshVouchers, vouchers, archivedVouchers, walletId, walletName, inviteMember, removeMember, logAction, updateVoucher } = useVouchers()
  const { hasVault, hint, isVaultUnlocked, isUnifiedVault, unlockVault, unlockVaultFromRecovery, encrypt, resetVault, changePassphrase, disableVault, migrateVault, regenerateRecoveryKey, enableBiometricVaultUnlock, reDeriveVaultKeyFromPassword } = useE2EE()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const { t } = useT()
  const { clubs, userClubIds, fetchClubs, setUserClubs } = useDiscounts()

  const [a11yWidgetEnabled, setA11yWidgetEnabled] = useState(
    () => localStorage.getItem('a11y_widget_enabled') !== 'false'
  )

  // Clubs selector state
  const [localClubIds, setLocalClubIds] = useState<string[]>([])
  const [savingClubs, setSavingClubs] = useState(false)
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
    <div className="flex-1" style={{ background: 'var(--c-bg)' }}>

      <div className="pb-24 space-y-4">
        {/* Profile hero card */}
        <div style={{
          background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 100%)',
          padding: '24px 20px 20px',
          marginBottom: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 64, height: 64, borderRadius: 20, background: 'rgba(255,255,255,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: '#fff', flexShrink: 0 }}>
              {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              {!editName ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>{profile?.name || 'ללא שם'}</div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)', marginTop: 2 }}>{user?.email}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, background: isPro ? 'rgba(251,191,36,0.3)' : 'rgba(255,255,255,0.2)', color: '#fff', padding: '3px 10px', borderRadius: 100 }}>
                      {isPro ? 'Pro ★' : 'משתמש רגיל'}
                    </span>
                    {isPro && proExpiryDate && (
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>
                        פעיל עד {new Date(proExpiryDate).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" style={{ height: 38, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 16, padding: '0 12px', fontFamily: 'Heebo, sans-serif', outline: 'none' }} />
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="טלפון" dir="ltr" style={{ height: 38, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 16, padding: '0 12px', fontFamily: 'Heebo, sans-serif', outline: 'none' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={saveProfile} style={{ flex: 1, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.25)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo, sans-serif' }}>{t('app.save')}</button>
                    <button onClick={() => setEditName(false)} style={{ flex: 1, height: 36, borderRadius: 10, background: 'rgba(0,0,0,0.15)', border: 'none', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', fontFamily: 'Heebo, sans-serif' }}>{t('app.cancel')}</button>
                  </div>
                </div>
              )}
            </div>
            {!editName && (
              <button onClick={() => setEditName(true)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10, width: 36, height: 36, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Pencil className="w-4 h-4" style={{ color: '#fff' }} />
              </button>
            )}
          </div>
        </div>

        {/* Pro upgrade card */}
        {!isPro && (
          <div onClick={() => openUpgradeSheet('שדרג לחוויה מלאה')} className="gs-tap" style={{
            margin: '0 16px 4px',
            background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
            borderRadius: 18, padding: '16px 18px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            cursor: 'pointer', position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 46, height: 46, borderRadius: 14, background: 'linear-gradient(135deg, var(--c-gold) 0%, #e8b422 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Crown className="w-5 h-5" style={{ color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>שדרג ל-GiftSmart Pro</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>שוברים ללא הגבלה · ₪9 לחודש</div>
              </div>
              <ChevronRight className="w-4 h-4 rotate-180" style={{ color: 'rgba(255,255,255,0.5)' }} />
            </div>
          </div>
        )}

        {/* ── מראה ושפה ── */}
        <SL>מראה ושפה</SL>
        <Card>
          <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <div className="flex items-center gap-3">
              {theme === 'dark' ? <Moon className="w-5 h-5" style={{ color: 'var(--c-primary)' }} /> : <Sun className="w-5 h-5" style={{ color: 'var(--c-primary)' }} />}
              <div>
                <div className="font-medium text-sm" style={{ color: 'var(--c-text)' }}>{t('settings.dark.mode')}</div>
                <div className="text-xs" style={{ color: 'var(--c-text3)' }}>{theme === 'dark' ? 'פעיל' : 'כבוי'}</div>
              </div>
            </div>
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors"
              style={{ background: theme === 'dark' ? 'var(--c-primary)' : 'var(--c-border)' }}
            >
              <span
                className="inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
                style={{ transform: theme === 'dark' ? 'translateX(-24px)' : 'translateX(-4px)' }}
              />
            </button>
          </div>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5" style={{ color: 'var(--c-primary)' }} />
              <div>
                <div className="font-medium text-sm" style={{ color: 'var(--c-text)' }}>שפה / Language</div>
                <div className="text-xs" style={{ color: 'var(--c-text3)' }}>{locale === 'he' ? 'עברית' : 'English'}</div>
              </div>
            </div>
            <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: 'var(--c-border)' }}>
              {(['he', 'en'] as const).map(l => (
                <button
                  key={l}
                  onClick={() => setLocale(l)}
                  className="px-3 py-1 text-xs font-semibold transition-colors"
                  style={{
                    background: locale === l ? 'var(--c-primary)' : 'var(--c-surface)',
                    color: locale === l ? '#fff' : 'var(--c-text2)',
                  }}
                >
                  {l === 'he' ? 'עב' : 'EN'}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* ── שיתוף וחברים ── */}
        <SL>שיתוף וחברים</SL>
        <Card>
          <div className="p-4 space-y-3">
            {members.length > 0 && (
              <div className="space-y-1 mb-2">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm text-gray-700">{m.email}</p>
                      <p className="text-xs text-gray-400">{m.role === 'owner' ? 'בעלים' : 'חבר'}</p>
                    </div>
                    {m.role !== 'owner' && (
                      <button onClick={() => handleRemoveMember(m.user_id, m.email)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pendingInviteEmail && (
              <div className="bg-orange-50 rounded-2xl p-3 space-y-2">
                <p className="text-sm text-orange-700">המשתמש <strong>{pendingInviteEmail}</strong> אינו רשום באפליקציה. לשלוח הזמנה להצטרף?</p>
                <div className="flex gap-2">
                  <button onClick={handleSendNotFoundInvite} className="flex-1 bg-orange-500 text-white py-2 rounded-xl text-sm font-medium">שלח הזמנה</button>
                  <button onClick={() => { setPendingInviteEmail(null); setInviteEmail('') }} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm font-medium">{t('app.cancel')}</button>
                </div>
              </div>
            )}
            {!pendingInviteEmail && (
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <UserPlus className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder="כתובת מייל לשיתוף"
                    className="w-full pr-9 pl-3 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    dir="ltr"
                  />
                </div>
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail.trim()}
                  className="px-4 py-2.5 bg-green-500 text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  {inviteLoading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'הוסף'}
                </button>
              </div>
            )}
            <p className="text-xs text-gray-400">חברים בארנק רואים את כל השוברים שלך ויכולים לעדכן יתרות.</p>
          </div>
        </Card>

        {/* ── התראות ואינטגרציות ── */}
        <SL>התראות ואינטגרציות</SL>
        <Card>
          {/* Reminder days */}
          <div className="p-4">
            {/* Google Calendar toggle */}
            <label className="flex items-center justify-between cursor-pointer mb-4">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-gray-700">{t('settings.calendar.enabled')}</span>
              </div>
              <button
                role="switch"
                aria-checked={calendarReminderEnabled}
                onClick={() => saveCalendarEnabled(!calendarReminderEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${calendarReminderEnabled ? 'bg-green-500' : 'bg-gray-200'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${calendarReminderEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </label>
            <p className="text-sm text-gray-700 mb-3">שלח תזכורת <strong>{reminderDays}</strong> ימים לפני שהשובר יפוג</p>
            <div className="flex items-center gap-3">
              <input
                type="range" min={1} max={90} value={reminderDays}
                onChange={e => saveReminderDays(parseInt(e.target.value))}
                className="flex-1 accent-green-500"
              />
              <div className="flex items-center gap-1">
                <input
                  type="number" min={1} max={90} value={reminderDays}
                  onChange={e => saveReminderDays(parseInt(e.target.value) || 1)}
                  className="w-14 text-center px-2 py-1.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                <span className="text-sm text-gray-500">ימים</span>
              </div>
            </div>
            <div className="flex justify-between text-xs text-gray-400 mt-1 px-0.5">
              <span>1 יום</span>
              <span>90 ימים</span>
            </div>
            {/* Notification channels */}
            <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--c-border)' }}>
              <p className="text-xs font-semibold text-gray-500 mb-2">{t('settings.notif.channels')}</p>
              <p className="text-xs text-gray-400 mb-3">{t('settings.notif.channels.note')}</p>
              <div className="space-y-2">
                {/* Push */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-orange-500" />
                    <span className="text-sm text-gray-700">{t('settings.notif.push')}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.push}
                    onClick={() => updateNotifChannel('push', !notifChannels.push)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.push ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.push ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
                {/* Email */}
                <label className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-blue-500" />
                    <span className="text-sm text-gray-700">{t('settings.notif.email')}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.email}
                    onClick={() => updateNotifChannel('email', !notifChannels.email)}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.email ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.email ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
                {/* Telegram */}
                <label className={`flex items-center justify-between ${!telegramLinked ? 'opacity-50' : 'cursor-pointer'}`}>
                  <div className="flex items-center gap-2">
                    <Send className="w-4 h-4 text-sky-500" />
                    <div>
                      <span className="text-sm text-gray-700">{t('settings.notif.telegram')}</span>
                      {!telegramLinked && <p className="text-[10px] text-gray-400">יש לקשר טלגרם תחילה</p>}
                    </div>
                  </div>
                  <button
                    role="switch"
                    aria-checked={notifChannels.telegram}
                    onClick={() => telegramLinked && updateNotifChannel('telegram', !notifChannels.telegram)}
                    disabled={!telegramLinked}
                    className={`relative w-10 h-5 rounded-full transition-colors ${notifChannels.telegram && telegramLinked ? 'bg-green-500' : 'bg-gray-200'}`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${notifChannels.telegram && telegramLinked ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
              </div>
            </div>
          </div>
          {/* Telegram */}
          <div className="border-t" style={{ borderColor: 'var(--c-border)' }}>
            {telegramLinked ? (
              <div className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                    <Send className="w-5 h-5 text-sky-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">מחובר לבוט טלגרם</p>
                    <p className="text-xs text-gray-400">מקבל את כל ההתראות גם בטלגרם</p>
                  </div>
                  <button onClick={handleDisconnectTelegram} className="text-xs text-red-500 font-medium px-3 py-1.5 bg-red-50 rounded-xl flex items-center gap-1">
                    <Link2Off className="w-3.5 h-3.5" /> נתק
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                    <Send className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">קשר לטלגרם</p>
                    <p className="text-xs text-gray-400">קבל את כל ההתראות גם בטלגרם</p>
                  </div>
                  {!telegramCode && (
                    <button
                      onClick={handleGenerateTelegramCode}
                      disabled={telegramLoading}
                      className="text-xs text-sky-600 font-medium px-3 py-1.5 bg-sky-50 rounded-xl flex items-center gap-1 disabled:opacity-50"
                    >
                      {telegramLoading ? <div className="w-3.5 h-3.5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" /> : <Link className="w-3.5 h-3.5" />}
                      קשר
                    </button>
                  )}
                </div>
                {telegramCode && (
                  <div className="bg-sky-50 rounded-2xl p-4 space-y-2">
                    <p className="text-xs text-sky-700 font-medium">שלב 1 — פתח את הבוט בטלגרם:</p>
                    <a href={`https://t.me/Vouchermanagementbot?start=${telegramCode}`} target="_blank" rel="noopener noreferrer" className="block text-center bg-sky-500 text-white py-2.5 rounded-xl text-sm font-medium">פתח בוט טלגרם</a>
                    <p className="text-xs text-sky-600 text-center">או שלח ידנית לבוט:</p>
                    <div className="bg-white rounded-xl px-4 py-3 text-center">
                      <p className="text-xs text-gray-400 mb-1">הפקודה לשליחה:</p>
                      <p className="font-mono text-lg font-bold tracking-widest text-gray-800 select-all">/start {telegramCode}</p>
                    </div>
                    <p className="text-xs text-gray-400 text-center">הקוד תקף ל-10 דקות</p>
                    <button onClick={handleGenerateTelegramCode} className="w-full text-xs text-sky-600 py-1.5">צור קוד חדש</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* ── פיצ'רים ── */}
        <SL>פיצ'רים</SL>
        <Card>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 ml-3">
              <p className="text-sm font-medium text-gray-800">הצג ערך שוק של שוברים</p>
              <p className="text-xs text-gray-400 mt-0.5">מאפשר הזנת % ערך לכל שובר ומציג כמה % פחות הוא שווה מהנקוב</p>
            </div>
            <button
              onClick={() => updateProfile({ show_voucher_value: !profile?.show_voucher_value })}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${profile?.show_voucher_value ? 'bg-green-500' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${profile?.show_voucher_value ? 'translate-x-0.5' : 'right-0.5'}`} />
            </button>
          </div>
        </Card>

        {/* ── הכרטיסים והמועדונים שלי ── */}
        <SL>{t('settings.my_clubs')}</SL>
        <Card>
          <div className="p-4 space-y-4">
            <p className="text-xs" style={{ color: 'var(--c-text3)' }}>{t('settings.my_clubs.sub')}</p>

            {clubs.length === 0 ? (
              <p className="text-sm text-center py-4" style={{ color: 'var(--c-text3)' }}>
                {t('app.loading')}
              </p>
            ) : (
              <>
                {/* Credit cards */}
                {clubs.filter(c => c.type === 'credit_card').length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <CreditCard className="w-4 h-4" style={{ color: 'var(--c-primary)' }} />
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--c-text3)' }}>
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
                                ? 'border-green-500 bg-green-50 text-green-700'
                                : 'border-gray-200 bg-white text-gray-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {selected && <Check className="w-3 h-3" />}
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
                      <Tag className="w-4 h-4" style={{ color: 'var(--c-primary)' }} />
                      <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--c-text3)' }}>
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
                                ? 'border-green-500 bg-green-50 text-green-700'
                                : 'border-gray-200 bg-white text-gray-600 dark:bg-gray-800 dark:border-gray-600 dark:text-gray-300'
                            }`}
                          >
                            {selected && <Check className="w-3 h-3" />}
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
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: 'var(--c-primary)' }}
                >
                  {savingClubs
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : <Check className="w-4 h-4" />
                  }
                  {t('app.save')}
                </button>
              </>
            )}
          </div>
        </Card>

        {/* ── כלים ── */}
        <SL>כלים</SL>
        <Card>
          <div className="divide-y divide-gray-50">
            <MenuItem icon={CloudUpload} label="סנכרן שוברים לענן" desc={isOnline ? 'העלה שוברים מ-cache לסופאבייס' : 'אין חיבור לאינטרנט'} onClick={handleSync} right={syncing ? <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> : undefined} />
            <MenuItem icon={Bell} label="שלח תזכורת תוקף" desc="מייל עם רשימת שוברים שפגי תוקף בקרוב" onClick={handleSendExpiryReminder} right={sendingReminder ? <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" /> : undefined} />
            <MenuItem icon={Wifi} label="בדוק חיבור" desc="בדיקת תקינות חיבור לבסיס הנתונים" onClick={handleCheckConnection} right={checking ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : undefined} />
          </div>
        </Card>

        {/* ── תמיכה (Pro) + הודעות מערכת + יומן פעילות ── */}
        {isPro && (
          <>
          <SL>תמיכה</SL>
          <Card>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--c-border, rgba(0,0,0,0.06))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button onClick={() => { if (!showMyMessages) loadMyMessages(); setShowMyMessages(v => !v) }} className="text-xs text-teal-600 flex items-center gap-1">
                ההודעות שלי
                {showMyMessages ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
            {!supportSent ? (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input value={supportSubject} onChange={e => setSupportSubject(e.target.value)} placeholder="נושא" className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
                  <select value={supportCategory} onChange={e => setSupportCategory(e.target.value)} className="shrink-0 w-28 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white">
                    <option value="general">כללי</option>
                    <option value="billing">חיוב</option>
                    <option value="bug">באג</option>
                    <option value="feature">פיצ'ר</option>
                  </select>
                </div>
                <textarea value={supportBody} onChange={e => setSupportBody(e.target.value)} placeholder="תאר את הבעיה או הבקשה שלך..." rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none" />
                <button onClick={sendSupportMessage} disabled={sendingSupport} className="w-full bg-teal-500 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                  <Send className="w-4 h-4" />
                  {sendingSupport ? 'שולח...' : 'שלח הודעה'}
                </button>
              </div>
            ) : (
              <div className="p-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 bg-teal-50 rounded-2xl flex items-center justify-center"><Check className="w-5 h-5 text-teal-500" /></div>
                <p className="text-sm font-medium text-gray-800">ההודעה נשלחה!</p>
                <p className="text-xs text-gray-500">נחזור אליך בהקדם</p>
                <button onClick={() => setSupportSent(false)} className="text-xs text-teal-600 mt-1">שלח הודעה נוספת</button>
              </div>
            )}
            {showMyMessages && (
              <div className="border-t">
                {myMessages.length === 0 ? (
                  <p className="text-center text-xs text-gray-400 py-4">אין הודעות קודמות</p>
                ) : (
                  <div className="divide-y divide-gray-50 max-h-[28rem] overflow-y-auto">
                    {myMessages.map(m => {
                      const isExpanded = expandedMessageId === m.id
                      const hasReplies = (m.replies?.length ?? 0) > 0
                      const hasAdminReply = m.admin_reply || m.replies?.some(r => r.sender === 'admin')
                      return (
                        <div key={m.id} className="px-4 py-3">
                          <button className="w-full text-right" onClick={() => { setExpandedMessageId(isExpanded ? null : m.id); if (!isExpanded) { void supabase.rpc('user_mark_message_read', { p_message_id: m.id }) } }}>
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800">{m.subject}</p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {hasAdminReply && <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">נענה</span>}
                                {!hasAdminReply && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">בטיפול</span>}
                                <span className="text-xs text-gray-400 flex items-center gap-0.5"><Clock className="w-3 h-3" />{formatDate(m.created_at)}</span>
                              </div>
                            </div>
                            {!isExpanded && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1 text-right">{m.body}</p>}
                          </button>
                          {isExpanded && (
                            <div className="mt-2 space-y-2">
                              <div className="flex justify-end">
                                <div className="bg-teal-500 text-white rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                  <p className="text-xs">{m.body}</p>
                                  <p className="text-[10px] text-teal-200 mt-0.5">{formatDate(m.created_at)}</p>
                                </div>
                              </div>
                              {hasReplies ? (
                                m.replies!.map(r => (
                                  <div key={r.id} className={`flex ${r.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`rounded-2xl px-3 py-2 max-w-[85%] ${r.sender === 'user' ? 'bg-teal-500 text-white rounded-tl-sm' : 'bg-gray-100 text-gray-800 rounded-tr-sm'}`}>
                                      {r.sender === 'admin' && <p className="text-[10px] font-semibold text-teal-600 mb-0.5">תמיכה</p>}
                                      <p className="text-xs">{r.body}</p>
                                      <p className={`text-[10px] mt-0.5 ${r.sender === 'user' ? 'text-teal-200' : 'text-gray-400'}`}>{formatDate(r.created_at)}</p>
                                    </div>
                                  </div>
                                ))
                              ) : m.admin_reply ? (
                                <div className="flex justify-start">
                                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                    <p className="text-[10px] font-semibold text-teal-600 mb-0.5">תמיכה</p>
                                    <p className="text-xs">{m.admin_reply}</p>
                                    {m.replied_at && <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(m.replied_at)}</p>}
                                  </div>
                                </div>
                              ) : null}
                              {hasAdminReply && (
                                <div className="flex gap-1.5 mt-1">
                                  <input value={replyTexts[m.id] || ''} onChange={e => setReplyTexts(prev => ({ ...prev, [m.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserReply(m.id) } }} placeholder="כתוב תשובה..." className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-300" />
                                  <button onClick={() => sendUserReply(m.id)} disabled={sendingUserReply === m.id || !replyTexts[m.id]?.trim()} className="px-3 py-2 bg-teal-500 text-white rounded-xl text-xs disabled:opacity-40 flex items-center gap-1"><Send className="w-3 h-3" /></button>
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
            <div className="px-4 py-3 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-500" />
                הודעות מערכת
              </h3>
              {adminBroadcasts.some(b => !seenBroadcastIds.has(b.id)) && (
                <span className="text-xs font-bold bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
                  {adminBroadcasts.filter(b => !seenBroadcastIds.has(b.id)).length}
                </span>
              )}
            </div>
            <div className="divide-y divide-gray-50 max-h-64 overflow-y-auto">
              {adminBroadcasts.map(b => {
                const isNew = !seenBroadcastIds.has(b.id)
                return (
                  <div key={b.id} className={`px-4 py-3 ${isNew ? 'bg-blue-50/50' : ''}`}
                    onMouseEnter={() => {
                      if (isNew) {
                        setSeenBroadcastIds(prev => { const next = new Set(prev); next.add(b.id); localStorage.setItem('seen_broadcast_ids', JSON.stringify([...next])); return next })
                        void supabase.rpc('record_broadcast_view', { p_broadcast_id: b.id })
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${isNew ? 'text-gray-900' : 'text-gray-700'}`}>{b.subject}</p>
                      <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(b.created_at)}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{b.body}</p>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <ActivityLog />

        {/* ── אבטחה ── */}
        <SL>{t('settings.security')}</SL>
        <Card>
          {!editPass ? (
            <MenuItem icon={Lock} label="שינוי סיסמה" desc="עדכן את סיסמת הכניסה" onClick={() => setEditPass(true)} />
          ) : (
            <div className="p-4 space-y-3">
              {/* Unified-vault notice */}
              {isUnifiedVault && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800 flex items-start gap-2">
                  <Shield className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <p>הכספת מוגנת בסיסמת הכניסה — <strong>הסיסמה החדשה תהיה גם מפתח הכספת</strong> ותצפין מחדש את כל השוברים.</p>
                </div>
              )}

              {/* Current password */}
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showCurrentPass ? 'text' : 'password'}
                  value={currentPass}
                  onChange={e => setCurrentPass(e.target.value)}
                  placeholder="סיסמה נוכחית"
                  className="w-full pr-10 pl-10 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  dir="ltr"
                  autoFocus
                />
                <button type="button" onClick={() => setShowCurrentPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showCurrentPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              {/* New password + strength meter */}
              <div>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPass}
                    onChange={e => { setNewPass(e.target.value); setShowPassStrength(true) }}
                    placeholder="סיסמה חדשה (לפחות 8 תווים)"
                    className="w-full pr-10 pl-10 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showNewPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {showPassStrength && newPass.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className={`flex-1 h-1.5 rounded-full ${i < pwStrength.score ? pwStrength.color : 'bg-gray-100'}`} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${pwStrength.score >= 3 ? 'text-green-600' : 'text-orange-500'}`}>{pwStrength.label}</span>
                      {pwStrength.score >= 3 && <ShieldCheck className="w-4 h-4 text-green-500" />}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {pwStrength.checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1 text-xs ${c.ok ? 'text-green-600' : 'text-gray-400'}`}>
                          <Check className={`w-3 h-3 flex-shrink-0 ${c.ok ? 'text-green-500' : 'text-gray-300'}`} />
                          {c.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Confirm */}
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showNewPass2 ? 'text' : 'password'}
                  value={newPass2}
                  onChange={e => setNewPass2(e.target.value)}
                  placeholder="אימות סיסמה חדשה"
                  className="w-full pr-10 pl-10 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowNewPass2(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showNewPass2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={changePassword}
                  disabled={passwordChanging || !currentPass || !newPass || !newPass2}
                  className="flex-1 bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50"
                >
                  {passwordChanging ? 'משנה...' : isUnifiedVault ? 'שנה סיסמה ועדכן כספת' : 'שנה סיסמה'}
                </button>
                <button
                  onClick={() => {
                    setEditPass(false)
                    setCurrentPass(''); setNewPass(''); setNewPass2('')
                    setShowCurrentPass(false); setShowNewPass(false); setShowNewPass2(false); setShowPassStrength(false)
                  }}
                  className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium"
                >
                  {t('app.cancel')}
                </button>
              </div>
            </div>
          )}

          {/* Biometric */}
          {isBiometricSupported() && (
            <div className="border-t">
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
                  <Fingerprint className="w-5 h-5 text-gray-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">נעילה ביומטרית</p>
                  <p className="text-xs text-gray-400">
                    {biometricEnabled ? 'פעיל — Face ID / טביעת אצבע' : 'כבוי'}
                  </p>
                </div>
                {biometricEnabled ? (
                  <button
                    onClick={handleDisableBiometric}
                    className="text-xs text-red-500 font-medium px-3 py-1.5 bg-red-50 rounded-xl"
                  >
                    בטל
                  </button>
                ) : (
                  <button
                    onClick={handleEnableBiometric}
                    disabled={biometricLoading}
                    className="text-xs text-green-600 font-medium px-3 py-1.5 bg-green-50 rounded-xl disabled:opacity-50"
                  >
                    {biometricLoading ? '...' : 'הפעל'}
                  </button>
                )}
              </div>
            </div>
          )}
          {/* E2EE Vault */}
          {hasVault && (
            <div className="border-t">
            <button
              onClick={() => setShowVaultSection(s => !s)}
              className="flex items-center gap-3 w-full p-4 text-right hover:bg-gray-50"
            >
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                <Shield className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">{t('settings.vault')}</p>
                <p className="text-xs text-gray-400">{isVaultUnlocked ? 'פתוחה כעת' : 'נעולה'} · שנה סיסמה או אפס</p>
              </div>
              {showVaultSection ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </button>

            {showVaultSection && (
              <div className="px-4 pb-4 space-y-3">

                {/* Single consolidated "must-read" notice */}
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-amber-800 flex items-center gap-2">
                    <Shield className="w-3.5 h-3.5 flex-shrink-0" /> חובה לקרוא — כדי לא לאבד את הנתונים שלך
                  </p>
                  {isUnifiedVault ? (
                    <>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        הכספת מוצפנת עם <strong>סיסמת הכניסה שלך</strong> — הסיסמה אינה נשמרת בשרתנו.
                      </p>
                      <ul className="text-xs text-amber-700 space-y-1 list-disc pr-4">
                        <li><strong>שחזור סיסמה בדוא"ל לא ישחזר נתונים מוצפנים</strong> — שמור את מפתח השחזור במקום בטוח.</li>
                        <li>לשינוי סיסמה: השתמש בקטע "שינוי סיסמה" למעלה — הכספת תוצפן מחדש אוטומטית.</li>
                        <li>שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</li>
                      </ul>
                      {isVaultUnlocked && (
                        <button
                          onClick={() => regenerateRecoveryKey().catch(() => {})}
                          className="text-xs font-semibold text-amber-700 hover:text-amber-900 flex items-center gap-1"
                        >
                          <Key className="w-3 h-3" /> הצג / חדש מפתח שחזור
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="text-xs text-amber-700 leading-relaxed">
                        <strong>הסיסמה אינה ניתנת לשחזור</strong> — שמור אותה במקום בטוח. איבוד הסיסמה יגרום לאיבוד הנתונים המוצפנים לצמיתות.
                      </p>
                      <p className="text-xs text-amber-700">שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</p>
                      <p className="text-xs text-amber-700">שינוי סיסמה יצפין מחדש אוטומטית את כל השוברים המוצפנים שלך.</p>
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
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-teal-800 flex items-center gap-1">
                      <Key className="w-3.5 h-3.5" /> פתח עם מפתח שחזור
                    </p>
                    <p className="text-xs text-teal-700">
                      שכחת סיסמה? הזן את מפתח השחזור שקיבלת בעת הגדרת הכספת.
                    </p>
                    {!showRecoveryUnlock ? (
                      <button
                        onClick={() => setShowRecoveryUnlock(true)}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-900"
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
                          className="w-full px-3 py-2 border border-teal-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 font-mono tracking-widest"
                          dir="ltr"
                          autoFocus
                          autoComplete="off"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={handleRecoveryUnlock}
                            disabled={recoveryUnlocking || !recoveryPhrase.trim()}
                            className="flex-1 py-2 bg-teal-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                          >
                            {recoveryUnlocking
                              ? <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              : <Key className="w-3 h-3" />
                            }
                            {recoveryUnlocking ? 'פותח...' : 'פתח כספת'}
                          </button>
                          <button
                            onClick={() => { setShowRecoveryUnlock(false); setRecoveryPhrase('') }}
                            className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs"
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
                      <Shield className="w-3.5 h-3.5" /> שדרג לסיסמה אחת
                    </p>
                    <p className="text-xs text-blue-700 leading-relaxed">
                      הכספת שלך עדיין דורשת סיסמה נפרדת מסיסמת הכניסה.
                      לאחד — הכספת תיפתח אוטומטית בכל כניסה.
                    </p>
                    {!showMigrateSection ? (
                      <button
                        onClick={() => setShowMigrateSection(true)}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800"
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
                          className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          dir="ltr"
                          autoComplete="current-password"
                        />
                        <input
                          type="password"
                          placeholder="סיסמת כניסה לאתר"
                          value={migrateLoginPass}
                          onChange={e => setMigrateLoginPass(e.target.value)}
                          className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
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
                            className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs"
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
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="current-password"
                      name="vault-current-password"
                    />
                    <input
                      type="password"
                      value={vaultNewPass}
                      onChange={e => setVaultNewPass(e.target.value)}
                      placeholder="סיסמה חדשה (לפחות 8 תווים)"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="new-password"
                      name="vault-new-password"
                    />
                    <input
                      type="password"
                      value={vaultNewPass2}
                      onChange={e => setVaultNewPass2(e.target.value)}
                      placeholder="אימות סיסמה חדשה"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"
                      dir="ltr"
                      autoComplete="new-password"
                      name="vault-new-password-confirm"
                    />
                    <input
                      type="text"
                      value={vaultNewHint}
                      onChange={e => setVaultNewHint(e.target.value)}
                      placeholder="רמז לסיסמה החדשה (אופציונלי)"
                      className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"
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

                <div className="border-t pt-3 space-y-3">
                  {/* Default encryption for new vouchers */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-800">הצפן שוברים חדשים כברירת מחדל</p>
                      <p className="text-xs text-gray-400 mt-0.5">כל שובר חדש שיתווסף יוצפן אוטומטית</p>
                    </div>
                    <button
                      role="switch"
                      aria-checked={e2eeDefaultNew}
                      onClick={() => {
                        const next = !e2eeDefaultNew
                        setE2eeDefaultNew(next)
                        localStorage.setItem('gs_e2ee_default', String(next))
                      }}
                      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${e2eeDefaultNew ? 'bg-indigo-600' : 'bg-gray-200'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${e2eeDefaultNew ? 'translate-x-0.5' : 'right-0.5'}`} />
                    </button>
                  </div>

                  {/* Encrypt all unencrypted vouchers */}
                  {!encryptAllConfirm ? (
                    <button
                      onClick={() => setEncryptAllConfirm(true)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                    >
                      הצפן את כל השוברים שעדיין לא מוצפנים
                    </button>
                  ) : (
                    <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-amber-900 flex items-center gap-1">
                        <Shield className="w-3.5 h-3.5" /> שים לב — פעולה בלתי הפיכה
                      </p>
                      <p className="text-xs text-amber-800">
                        קודי השוברים יוצפנו עם סיסמת הכספת הנוכחית.
                        <strong> אם תשכח את הסיסמה — הנתונים יאבדו לצמיתות.</strong>
                        <br />ודא שהסיסמה שמורה במקום בטוח לפני המשך.
                      </p>
                      <input
                        type="password"
                        placeholder="אמת סיסמת כספת"
                        value={encryptAllPass}
                        onChange={e => setEncryptAllPass(e.target.value)}
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
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
                          className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs"
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
                      className="text-xs text-orange-500 hover:text-orange-700"
                    >
                      הסר הצפנה (פענח שוברים ושמור בטקסט רגיל)
                    </button>
                  ) : (
                    <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-orange-800 font-medium">
                        הקודים יפוענחו ויישמרו ב-DB ללא הצפנה. הנתונים לא ימחקו.
                      </p>
                      <input
                        type="password"
                        placeholder="סיסמת כספת נוכחית"
                        value={vaultDisablePass}
                        onChange={e => setVaultDisablePass(e.target.value)}
                        className="w-full border rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                        autoComplete="current-password"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleDisableVault}
                          disabled={vaultDisabling || !vaultDisablePass}
                          className="flex-1 py-2 bg-orange-500 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                        >
                          {vaultDisabling ? 'מפענח...' : 'הסר הצפנה'}
                        </button>
                        <button
                          onClick={() => { setVaultDisableConfirm(false); setVaultDisablePass('') }}
                          className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs"
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
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      אפס כספת (מחק את כל ההצפנה)
                    </button>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-red-700 font-medium">
                        אזהרה: איפוס הכספת ישאיר את קודי השוברים בDB מוצפנים ולא ניתן יהיה לקרוא אותם! יש לוודא תחילה שאין שוברי E2EE חשובים.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { resetVault(); toast.success('כספת אופסה'); setVaultResetConfirm(false); setShowVaultSection(false) }}
                          className="flex-1 py-2 bg-red-500 text-white rounded-xl text-xs font-semibold"
                        >
                          {t('e2ee.reset')}
                        </button>
                        <button
                          onClick={() => setVaultResetConfirm(false)}
                          className="flex-1 py-2 bg-gray-100 text-gray-600 rounded-xl text-xs"
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

        {/* ── נגישות ופרטיות ── */}
        <SL>נגישות ופרטיות</SL>
        <Card>
          <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--c-border)' }}>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-800">הצג כפתור נגישות</p>
              <p className="text-xs text-gray-500 mt-0.5">כפתור צף לשינוי גודל טקסט, ניגודיות ועוד</p>
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
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${a11yWidgetEnabled ? 'bg-blue-600' : 'bg-gray-200'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${a11yWidgetEnabled ? 'translate-x-0.5' : 'right-0.5'}`} />
            </button>
          </div>
          <a href="/accessibility" className="block px-4 py-3 text-xs text-blue-600 hover:underline border-b" style={{ borderColor: 'var(--c-border)' }}>
            הצהרת נגישות ←
          </a>
          <div className="divide-y" style={{ borderColor: 'var(--c-border)' }}>
            <MenuItem
              icon={BookOpen}
              label={t('settings.onboarding')}
              desc="הצג מחדש את מדריך הפיצ׳רים"
              onClick={() => {
                localStorage.removeItem('onboarding_seen_v2')
                navigate('/')
                setTimeout(() => window.dispatchEvent(new Event('show-onboarding')), 120)
              }}
            />
            <MenuItem
              icon={FileText}
              label="תנאי שימוש"
              desc="הסכם השימוש בשירות GiftSmart"
              onClick={() => navigate('/terms')}
            />
            <MenuItem
              icon={Shield}
              label="מדיניות פרטיות"
              desc="כיצד אנו מגינים על המידע שלך"
              onClick={() => navigate('/privacy')}
            />
            <MenuItem
              icon={LogOut}
              label={t('settings.logout')}
              desc="יציאה מהחשבון"
              onClick={() => { if (confirm('להתנתק?')) signOut() }}
              danger
            />
          </div>
        </Card>

        <p className="text-center text-xs text-gray-400">GiftSmart v1.1.0</p>
      </div>
    </div>
  )
}
