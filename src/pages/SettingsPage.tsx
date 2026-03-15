import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { Lock, CloudUpload, Wifi, LogOut, ChevronRight, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const { user, profile, signOut, updateProfile } = useAuth()
  const { syncToCloud, isOnline, refreshVouchers } = useVouchers()

  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [phone, setPhone] = useState(profile?.phone || '')

  const [editPass, setEditPass] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [checking, setChecking] = useState(false)

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
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              <input
                type="tel"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="מספר טלפון"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
              <input
                type="password"
                value={newPass2}
                onChange={e => setNewPass2(e.target.value)}
                placeholder="אימות סיסמה"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
              icon={Wifi}
              label="בדוק חיבור"
              desc="בדיקת תקינות חיבור לבסיס הנתונים"
              onClick={handleCheckConnection}
              right={checking ? <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" /> : undefined}
            />
          </div>
        </div>

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

        <p className="text-center text-xs text-gray-400">ארנק שוברים v1.0.0</p>
      </div>
    </div>
  )
}
