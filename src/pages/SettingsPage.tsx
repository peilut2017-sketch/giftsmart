import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatDate, getDaysUntilExpiry } from '../utils/helpers'
import { sendExpiryReminderEmail } from '../lib/emailService'
import { Lock, CloudUpload, Wifi, LogOut, ChevronRight, Check, X, Bell, Fingerprint, Send, Link, Link2Off, Users, Trash2, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'
import ActivityLog from '../components/ActivityLog'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../lib/passkey'

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

interface WalletMemberRow {
  user_id: string
  email: string
  role: string
}

export default function SettingsPage() {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { syncToCloud, isOnline, refreshVouchers, vouchers, walletId, walletName, inviteMember, removeMember } = useVouchers()

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
    else { toast.success('סיסמה שונתה!'); setEditPass(false); setNewPass(''); setNewPass2('') }
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
    if (expiring.length === 0) return toast(`אין שוברים שפגים ב-${reminderDays} הימים הקרובים`, { icon: '✅' })
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
    const ok = await registerBiometric(user?.id || '', profile?.name || user?.email || '')
    setBiometricLoading(false)
    if (ok) { setBiometricEnabled(true); toast.success('נעילה ביומטרית הופעלה!') }
    else toast.error('לא ניתן לרשום אימות ביומטרי')
  }

  function handleDisableBiometric() {
    disableBiometric()
    setBiometricEnabled(false)
    toast.success('נעילה ביומטרית בוטלה')
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
  }

  async function handleCheckConnection() {
    setChecking(true)
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (error) throw error
      toast.success('חיבור לבסיס הנתונים תקין ✅')
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
    <div className="flex-1 bg-gray-50">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900">הגדרות</h1>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* Profile */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">פרופיל אישי</p>
          </div>

          {!editName ? (
            <div className="p-4 flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-500 rounded-2xl flex items-center justify-center text-white font-bold text-lg">
                {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800">{profile?.name || 'ללא שם'}</p>
                <p className="text-sm text-gray-500">{user?.email}</p>
                {profile?.phone && <p className="text-xs text-gray-400">{profile.phone}</p>}
              </div>
              <button
                onClick={() => setEditName(true)}
                className="text-sm text-green-600 font-medium px-3 py-1.5 bg-green-50 rounded-xl"
              >
                עריכה
              </button>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="שם מלא"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="מספר טלפון"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
              <div className="flex gap-2">
                <button onClick={saveProfile} className="flex-1 bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> שמור
                </button>
                <button onClick={() => setEditName(false)} className="flex-1 bg-gray-100 text-gray-600 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-1">
                  <X className="w-4 h-4" /> ביטול
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Password */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">אבטחה</p>
          </div>

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
                  ביטול
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

        {/* Reminder days */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <div className="px-0 pb-3 border-b mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תזכורת תוקף</p>
          </div>
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

        {/* Voucher value feature */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <div className="pb-3 border-b mb-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">תצוגת ערך שובר</p>
          </div>
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
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">כלים</p>
          </div>
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
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <Send className="w-3.5 h-3.5 text-sky-500" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">טלגרם</p>
          </div>

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
                    href={`https://t.me/${import.meta.env.VITE_TELEGRAM_BOT_USERNAME || 'YourBot'}?start=${telegramCode}`}
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
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center gap-2">
            <Users className="w-3.5 h-3.5 text-green-600" />
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">שיתוף הארנק שלי</p>
          </div>

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
                    ביטול
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

        {/* Activity log */}
        <ActivityLog />

        {/* Sign out */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <MenuItem
            icon={LogOut}
            label="התנתק"
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
