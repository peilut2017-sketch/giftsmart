import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../utils/helpers'
import { sendExpiryReminderEmail } from '../lib/emailService'
import { Lock, CloudUpload, Wifi, LogOut, ChevronRight, Check, Bell, Fingerprint, Send, Link, Link2Off, Trash2, UserPlus, Crown, ChevronDown, ChevronUp, Clock, Pencil, BookOpen, Shield, Moon, Sun, Globe } from 'lucide-react'
import toast from 'react-hot-toast'
import ActivityLog from '../components/ActivityLog'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../lib/passkey'
import { useE2EE } from '../contexts/E2EEContext'
import { useTheme } from '../contexts/ThemeContext'
import { useLocale, useT } from '../lib/i18n'

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
  const { hasVault, hint, isVaultUnlocked, resetVault, changePassphrase, disableVault } = useE2EE()
  const { theme, setTheme } = useTheme()
  const { locale, setLocale } = useLocale()
  const { t } = useT()

  const [a11yWidgetEnabled, setA11yWidgetEnabled] = useState(
    () => localStorage.getItem('a11y_widget_enabled') !== 'false'
  )
  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [phone, setPhone] = useState(profile?.phone || '')

  const [editPass, setEditPass] = useState(false)
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

  // Admin broadcasts
  const [adminBroadcasts, setAdminBroadcasts] = useState<AdminBroadcast[]>([])
  const [seenBroadcastIds, setSeenBroadcastIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('seen_broadcast_ids') || '[]'))
  )

  // Vault (E2EE passphrase management)
  const [showVaultSection, setShowVaultSection] = useState(false)
  const [vaultOldPass, setVaultOldPass] = useState('')
  const [vaultNewPass, setVaultNewPass] = useState('')
  const [vaultNewPass2, setVaultNewPass2] = useState('')
  const [vaultChanging, setVaultChanging] = useState(false)
  const [vaultResetConfirm, setVaultResetConfirm] = useState(false)
  const [vaultDisablePass, setVaultDisablePass] = useState('')
  const [vaultDisabling, setVaultDisabling] = useState(false)
  const [vaultDisableConfirm, setVaultDisableConfirm] = useState(false)

  async function handleChangeVaultPassphrase() {
    if (!vaultOldPass) return toast.error('הזן סיסמה נוכחית')
    if (vaultNewPass.length < 8) return toast.error('סיסמה חדשה: לפחות 8 תווים')
    if (vaultNewPass !== vaultNewPass2) return toast.error('הסיסמאות אינן תואמות')
    setVaultChanging(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await changePassphrase(vaultOldPass, vaultNewPass, e2eeVouchers)
      if (!ok) { toast.error('סיסמה נוכחית שגויה'); return }
      // Update all re-encrypted vouchers in DB
      await Promise.all(entries.map(({ id, code, cvv }) =>
        updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
      ))
      toast.success(`סיסמת כספת שונתה — ${entries.length} שוברים הוצפנו מחדש`)
      setVaultOldPass(''); setVaultNewPass(''); setVaultNewPass2('')
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

  // Telegram
  const [telegramLinked, setTelegramLinked] = useState<boolean | null>(null)
  const [telegramCode, setTelegramCode] = useState<string | null>(null)
  const [telegramLoading, setTelegramLoading] = useState(false)

  const reminderKey = `reminder_days_${user?.id}`
  const [reminderDays, setReminderDays] = useState(() =>
    parseInt(localStorage.getItem(`reminder_days_${user?.id}`) || '14')
  )
  function saveReminderDays(days: number) {
    const val = Math.max(1, Math.min(90, days))
    setReminderDays(val)
    localStorage.setItem(reminderKey, String(val))
  }

  async function saveProfile() {
    await updateProfile({ name, phone })
    setEditName(false)
    toast.success('פרופיל עודכן')
  }

  async function changePassword() {
    if (newPass !== newPass2) return toast.error('הסיסמאות אינן תואמות')
    if (newPass.length < 6) return toast.error('סיסמה קצרה מדי')
    const { error } = await supabase.auth.updateUser({ password: newPass })
    if (error) toast.error('שגיאה בשינוי סיסמה')
    else {
      toast.success('סיסמה שונתה!')
      setEditPass(false); setNewPass(''); setNewPass2('')
      logAction('system_password_change', 'מערכת')
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
    const ok = await registerBiometric(user?.id || '', profile?.name || user?.email || '', user?.email)
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
  useState(() => {
    if (!user) return
    supabase
      .from('telegram_users')
      .select('id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => setTelegramLinked(!!data))
  })

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

  const MenuItem = ({ icon: Icon, label, desc, onClick, danger = false, right }: any) => (
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
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" style={{ height: 38, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 15, padding: '0 12px', fontFamily: 'Heebo, sans-serif', outline: 'none' }} />
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="טלפון" dir="ltr" style={{ height: 38, borderRadius: 10, border: 'none', background: 'rgba(255,255,255,0.25)', color: '#fff', fontSize: 15, padding: '0 12px', fontFamily: 'Heebo, sans-serif', outline: 'none' }} />
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

        {/* Password */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>{t('settings.security')}</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>

          {!editPass ? (
            <MenuItem icon={Lock} label="שינוי סיסמה" desc="עדכן את סיסמת הכניסה" onClick={() => setEditPass(true)} />
          ) : (
            <div className="p-4 space-y-3">
              <input
                type="password"
                value={newPass}
                onChange={e => setNewPass(e.target.value)}
                placeholder="סיסמה חדשה"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
              <input
                type="password"
                value={newPass2}
                onChange={e => setNewPass2(e.target.value)}
                placeholder="אימות סיסמה"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
              <div className="flex gap-2">
                <button onClick={changePassword} className="flex-1 bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium">
                  שנה סיסמה
                </button>
                <button onClick={() => setEditPass(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium">
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
        </div>

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
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1">
                  <p className="font-bold flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> חשוב:</p>
                  <p>• עליך לזכור את הסיסמה. שמור אותה במקום בטוח. <strong>הסיסמה אינה ניתנת לשחזור</strong> ואיבוד הסיסמה יגרום לאיבוד הנתונים המוצפנים</p>
                  <p>• שיתוף שובר מוצפן חושף את הקוד בשרת לצורך שיתוף</p>
                </div>
                {hint && (
                  <div className="bg-indigo-50 rounded-xl px-3 py-2 text-xs text-indigo-700">
                    רמז נוכחי: <span className="font-medium">{hint}</span>
                  </div>
                )}
                <p className="text-xs text-indigo-600 bg-indigo-50 rounded-xl p-3">
                  שינוי סיסמה יצפין מחדש אוטומטית את כל השוברים המוצפנים שלך.
                </p>

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
                <button
                  onClick={handleChangeVaultPassphrase}
                  disabled={vaultChanging || !vaultOldPass || !vaultNewPass || !vaultNewPass2}
                  className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50"
                >
                  {vaultChanging ? 'מצפין מחדש...' : t('e2ee.change')}
                </button>

                <div className="border-t pt-3 space-y-3">
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

        {/* Reminder days */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>תזכורת תוקף</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px', padding: '16px' }}>
          <p className="text-sm text-gray-700 mb-3">שלח תזכורת <strong>{reminderDays}</strong> ימים לפני שהשובר יפוג</p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={90}
              value={reminderDays}
              onChange={e => saveReminderDays(parseInt(e.target.value))}
              className="flex-1 accent-green-500"
            />
            <div className="flex items-center gap-1">
              <input
                type="number"
                min={1}
                max={90}
                value={reminderDays}
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
        </div>

        {/* Accessibility widget toggle */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>{t('settings.accessibility')}</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px', padding: '16px' }}>
          <div className="flex items-center justify-between gap-3">
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
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                a11yWidgetEnabled ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                a11yWidgetEnabled ? 'translate-x-0.5' : 'right-0.5'
              }`} />
            </button>
          </div>
          <a href="/accessibility" className="block mt-3 text-xs text-blue-600 hover:underline">
            הצהרת נגישות ←
          </a>
        </div>

        {/* Voucher value feature */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>תצוגת ערך שובר</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px', padding: '16px' }}>
          <div className="flex items-center justify-between">
            <div className="flex-1 ml-3">
              <p className="text-sm font-medium text-gray-800">הצג ערך שוק של שוברים</p>
              <p className="text-xs text-gray-400 mt-0.5">מאפשר הזנת % ערך לכל שובר ומציג כמה % פחות הוא שווה מהנקוב</p>
            </div>
            <button
              onClick={() => updateProfile({ show_voucher_value: !profile?.show_voucher_value })}
              className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                profile?.show_voucher_value ? 'bg-green-500' : 'bg-gray-200'
              }`}
            >
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                profile?.show_voucher_value ? 'translate-x-0.5' : 'right-0.5'
              }`} />
            </button>
          </div>
        </div>

        {/* Tools */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>כלים</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
          <div className="divide-y divide-gray-50">
            <MenuItem
              icon={CloudUpload}
              label="סנכרן שוברים לענן"
              desc={isOnline ? 'העלה שוברים מ-cache לסופאבייס' : 'אין חיבור לאינטרנט'}
              onClick={handleSync}
              right={syncing ? <div className="w-5 h-5 border-2 border-green-500 border-t-transparent rounded-full animate-spin" /> : undefined}
            />
            <MenuItem
              icon={Bell}
              label="שלח תזכורת תוקף"
              desc="מייל עם רשימת שוברים שפגי תוקף בקרוב"
              onClick={handleSendExpiryReminder}
              right={sendingReminder ? <div className="w-5 h-5 border-2 border-orange-400 border-t-transparent rounded-full animate-spin" /> : undefined}
            />
            <MenuItem
              icon={Wifi}
              label="בדוק חיבור"
              desc="בדיקת תקינות חיבור לבסיס הנתונים"
              onClick={handleCheckConnection}
              right={checking ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : undefined}
            />
          </div>
        </div>

        {/* Telegram */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>טלגרם</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>

          {telegramLinked ? (
            <div className="p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center">
                  <Send className="w-5 h-5 text-sky-500" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-800">מחובר לבוט טלגרם</p>
                  <p className="text-xs text-gray-400">מקבל התראות ויכול לנהל שוברים</p>
                </div>
                <button
                  onClick={handleDisconnectTelegram}
                  className="text-xs text-red-500 font-medium px-3 py-1.5 bg-red-50 rounded-xl flex items-center gap-1"
                >
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
                  <p className="text-xs text-gray-400">ניהול שוברים והתראות ישירות בטלגרם</p>
                </div>
                {!telegramCode && (
                  <button
                    onClick={handleGenerateTelegramCode}
                    disabled={telegramLoading}
                    className="text-xs text-sky-600 font-medium px-3 py-1.5 bg-sky-50 rounded-xl flex items-center gap-1 disabled:opacity-50"
                  >
                    {telegramLoading
                      ? <div className="w-3.5 h-3.5 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                      : <Link className="w-3.5 h-3.5" />
                    }
                    קשר
                  </button>
                )}
              </div>

              {telegramCode && (
                <div className="bg-sky-50 rounded-2xl p-4 space-y-2">
                  <p className="text-xs text-sky-700 font-medium">שלב 1 — פתח את הבוט בטלגרם:</p>
                  <a
                    href={`https://t.me/Vouchermanagementbot?start=${telegramCode}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-center bg-sky-500 text-white py-2.5 rounded-xl text-sm font-medium"
                  >
                    פתח בוט טלגרם
                  </a>
                  <p className="text-xs text-sky-600 text-center">או שלח ידנית לבוט:</p>
                  <div className="bg-white rounded-xl px-4 py-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">הפקודה לשליחה:</p>
                    <p className="font-mono text-lg font-bold tracking-widest text-gray-800 select-all">
                      /start {telegramCode}
                    </p>
                  </div>
                  <p className="text-xs text-gray-400 text-center">הקוד תקף ל-10 דקות</p>
                  <button
                    onClick={handleGenerateTelegramCode}
                    className="w-full text-xs text-sky-600 py-1.5"
                  >
                    צור קוד חדש
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Wallet sharing */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>שיתוף הארנק שלי</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>

          <div className="p-4 space-y-3">
            {/* Member list */}
            {members.length > 0 && (
              <div className="space-y-1 mb-2">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <p className="text-sm text-gray-700">{m.email}</p>
                      <p className="text-xs text-gray-400">{m.role === 'owner' ? 'בעלים' : 'חבר'}</p>
                    </div>
                    {m.role !== 'owner' && (
                      <button
                        onClick={() => handleRemoveMember(m.user_id, m.email)}
                        className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* "User not found" confirm */}
            {pendingInviteEmail && (
              <div className="bg-orange-50 rounded-2xl p-3 space-y-2">
                <p className="text-sm text-orange-700">
                  המשתמש <strong>{pendingInviteEmail}</strong> אינו רשום באפליקציה.
                  לשלוח הזמנה להצטרף?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={handleSendNotFoundInvite}
                    className="flex-1 bg-orange-500 text-white py-2 rounded-xl text-sm font-medium"
                  >
                    שלח הזמנה
                  </button>
                  <button
                    onClick={() => { setPendingInviteEmail(null); setInviteEmail('') }}
                    className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm font-medium"
                  >
                    {t('app.cancel')}
                  </button>
                </div>
              </div>
            )}

            {/* Invite input */}
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
                  {inviteLoading
                    ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    : 'הוסף'}
                </button>
              </div>
            )}

            <p className="text-xs text-gray-400">
              חברים בארנק רואים את כל השוברים שלך ויכולים לעדכן יתרות.
            </p>
          </div>
        </div>

        {/* Support messages — Pro only */}
        {isPro && (
          <>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>תמיכה</div>
          <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--c-border, rgba(0,0,0,0.06))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                onClick={() => { if (!showMyMessages) loadMyMessages(); setShowMyMessages(v => !v) }}
                className="text-xs text-teal-600 flex items-center gap-1"
              >
                ההודעות שלי
                {showMyMessages ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {/* Send form */}
            {!supportSent ? (
              <div className="p-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    value={supportSubject}
                    onChange={e => setSupportSubject(e.target.value)}
                    placeholder="נושא"
                    className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                  <select
                    value={supportCategory}
                    onChange={e => setSupportCategory(e.target.value)}
                    className="shrink-0 w-28 px-2 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 bg-white"
                  >
                    <option value="general">כללי</option>
                    <option value="billing">חיוב</option>
                    <option value="bug">באג</option>
                    <option value="feature">פיצ'ר</option>
                  </select>
                </div>
                <textarea
                  value={supportBody}
                  onChange={e => setSupportBody(e.target.value)}
                  placeholder="תאר את הבעיה או הבקשה שלך..."
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
                />
                <button
                  onClick={sendSupportMessage}
                  disabled={sendingSupport}
                  className="w-full bg-teal-500 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  {sendingSupport ? 'שולח...' : 'שלח הודעה'}
                </button>
              </div>
            ) : (
              <div className="p-4 flex flex-col items-center gap-2 text-center">
                <div className="w-10 h-10 bg-teal-50 rounded-2xl flex items-center justify-center">
                  <Check className="w-5 h-5 text-teal-500" />
                </div>
                <p className="text-sm font-medium text-gray-800">ההודעה נשלחה!</p>
                <p className="text-xs text-gray-500">נחזור אליך בהקדם</p>
                <button onClick={() => setSupportSent(false)} className="text-xs text-teal-600 mt-1">שלח הודעה נוספת</button>
              </div>
            )}

            {/* My messages history — thread view */}
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
                          {/* Message header — click to expand/collapse thread */}
                          <button
                            className="w-full text-right"
                            onClick={() => {
                              setExpandedMessageId(isExpanded ? null : m.id)
                              if (!isExpanded) {
                                void supabase.rpc('user_mark_message_read', { p_message_id: m.id })
                              }
                            }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-gray-800">{m.subject}</p>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {hasAdminReply && (
                                  <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">נענה</span>
                                )}
                                {!hasAdminReply && (
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">בטיפול</span>
                                )}
                                <span className="text-xs text-gray-400 flex items-center gap-0.5">
                                  <Clock className="w-3 h-3" />{formatDate(m.created_at)}
                                </span>
                              </div>
                            </div>
                            {!isExpanded && (
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-1 text-right">{m.body}</p>
                            )}
                          </button>

                          {/* Expanded thread */}
                          {isExpanded && (
                            <div className="mt-2 space-y-2">
                              {/* Original message bubble */}
                              <div className="flex justify-end">
                                <div className="bg-teal-500 text-white rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                  <p className="text-xs">{m.body}</p>
                                  <p className="text-[10px] text-teal-200 mt-0.5">{formatDate(m.created_at)}</p>
                                </div>
                              </div>

                              {/* Thread replies */}
                              {hasReplies ? (
                                m.replies!.map(r => (
                                  <div key={r.id} className={`flex ${r.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                    <div className={`rounded-2xl px-3 py-2 max-w-[85%] ${
                                      r.sender === 'user'
                                        ? 'bg-teal-500 text-white rounded-tl-sm'
                                        : 'bg-gray-100 text-gray-800 rounded-tr-sm'
                                    }`}>
                                      {r.sender === 'admin' && (
                                        <p className="text-[10px] font-semibold text-teal-600 mb-0.5">תמיכה</p>
                                      )}
                                      <p className="text-xs">{r.body}</p>
                                      <p className={`text-[10px] mt-0.5 ${r.sender === 'user' ? 'text-teal-200' : 'text-gray-400'}`}>
                                        {formatDate(r.created_at)}
                                      </p>
                                    </div>
                                  </div>
                                ))
                              ) : m.admin_reply ? (
                                /* Backward compat: show legacy admin_reply if no thread replies yet */
                                <div className="flex justify-start">
                                  <div className="bg-gray-100 text-gray-800 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                    <p className="text-[10px] font-semibold text-teal-600 mb-0.5">תמיכה</p>
                                    <p className="text-xs">{m.admin_reply}</p>
                                    {m.replied_at && <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(m.replied_at)}</p>}
                                  </div>
                                </div>
                              ) : null}

                              {/* User reply input (shown when admin has replied) */}
                              {(hasAdminReply) && (
                                <div className="flex gap-1.5 mt-1">
                                  <input
                                    value={replyTexts[m.id] || ''}
                                    onChange={e => setReplyTexts(prev => ({ ...prev, [m.id]: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserReply(m.id) } }}
                                    placeholder="כתוב תשובה..."
                                    className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-teal-300"
                                  />
                                  <button
                                    onClick={() => sendUserReply(m.id)}
                                    disabled={sendingUserReply === m.id || !replyTexts[m.id]?.trim()}
                                    className="px-3 py-2 bg-teal-500 text-white rounded-xl text-xs disabled:opacity-40 flex items-center gap-1"
                                  >
                                    <Send className="w-3 h-3" />
                                  </button>
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
          </div>
        </>
        )}

        {/* Admin broadcasts */}
        {adminBroadcasts.length > 0 && (
          <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
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
                  <div
                    key={b.id}
                    className={`px-4 py-3 ${isNew ? 'bg-blue-50/50' : ''}`}
                    onMouseEnter={() => {
                      if (isNew) {
                        setSeenBroadcastIds(prev => {
                          const next = new Set(prev)
                          next.add(b.id)
                          localStorage.setItem('seen_broadcast_ids', JSON.stringify([...next]))
                          return next
                        })
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
          </div>
        )}

        {/* Activity log */}
        <ActivityLog />

        {/* Appearance: Dark mode + Language */}
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--c-text3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '16px 20px 6px' }}>מראה ושפה</div>
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
          {/* Dark mode toggle */}
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
          {/* Language switcher */}
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
        </div>

        {/* Onboarding guide */}
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
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
        </div>

        {/* Privacy & Sign out */}
        <div style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', overflow: 'hidden', margin: '0 0 4px' }}>
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

        <p className="text-center text-xs text-gray-400">GiftSmart v1.1.0</p>
      </div>
    </div>
  )
}
