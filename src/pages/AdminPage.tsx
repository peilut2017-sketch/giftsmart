import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, getExpiryStatus, formatDate } from '../utils/helpers'
import { Shield, Users, Star, Download, Edit2, Trash2, Plus, Globe, BarChart2, Zap, ChevronDown, ChevronUp, Crown, Ticket, MessageSquare, Send, CheckCheck, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import type { SuperVoucher } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { SUPER_VOUCHER_STORES } from '../types'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@example.com'

interface UserRow {
  id: string
  email: string
  name?: string
  created_at: string
}

interface SystemStats {
  total_vouchers: number
  total_archived: number
  total_balance: number
  total_wallets: number
  total_users: number
}

interface Coupon {
  id: string
  code: string
  name: string
  type: 'general' | 'private'
  discount_value: number
  max_uses: number | null
  uses_count: number
  valid_until: string | null
  restricted_to_email: string | null
  first_time_only: boolean
  is_active: boolean
  created_at: string
}

interface SupportMessage {
  id: string
  user_id: string
  user_email: string | null
  user_name: string | null
  subject: string
  body: string
  category: string
  status: 'unread' | 'read' | 'replied'
  admin_reply: string | null
  replied_at: string | null
  created_at: string
}

const CATEGORY_LABELS: Record<string, string> = {
  billing: '💳 חיוב',
  bug: '🐛 באג',
  feature: '💡 פיצ\'ר',
  general: '💬 כללי',
}

type Confirm = { title: string; message?: string; onConfirm: () => void }

export default function AdminPage() {
  const { user } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, walletName, addSuperVoucher, updateSuperVoucher, deleteSuperVoucher, updateWalletName } = useVouchers()

  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [proCount, setProCount] = useState<number | null>(null)
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
  const [showUsers, setShowUsers] = useState(false)
  const [editingWalletName, setEditingWalletName] = useState(false)
  const [newWalletName, setNewWalletName] = useState(walletName)
  const [editingSV, setEditingSV] = useState<SuperVoucher | null>(null)
  const [showAddSV, setShowAddSV] = useState(false)
  const [svName, setSvName] = useState('')
  const [svStores, setSvStores] = useState('')
  const [svDesc, setSvDesc] = useState('')
  const [svGlobal, setSvGlobal] = useState(false)
  const [svBalanceUrl, setSvBalanceUrl] = useState('')
  const [showQuickSV, setShowQuickSV] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  // Coupons
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [showCoupons, setShowCoupons] = useState(false)
  const [showAddCoupon, setShowAddCoupon] = useState(false)
  const [couponForm, setCouponForm] = useState({
    code: '', name: '', type: 'general' as 'general' | 'private',
    discount_value: 1, max_uses: '', valid_until: '',
    restricted_to_email: '', first_time_only: false,
  })
  // Messages
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [showMessages, setShowMessages] = useState(false)
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [sendingReply, setSendingReply] = useState<string | null>(null)

  const isAdmin = user?.email === ADMIN_EMAIL

  useEffect(() => {
    if (!isAdmin) return
    supabase.rpc('get_system_stats').then(({ data }) => { if (data) setSystemStats(data) })
    supabase.rpc('get_all_users').then(({ data }) => { if (data) setAllUsers(data) })
    supabase.rpc('admin_get_pro_count').then(({ data }) => { if (data !== null) setProCount(data) })
  }, [isAdmin])

  useEffect(() => {
    if (!showCoupons || coupons.length > 0) return
    supabase.rpc('admin_get_coupons').then(({ data }) => { if (data) setCoupons(data) })
  }, [showCoupons])

  useEffect(() => {
    if (!showMessages || messages.length > 0) return
    supabase.rpc('admin_get_messages').then(({ data }) => { if (data) setMessages(data) })
  }, [showMessages])

  async function handleCreateCoupon() {
    if (!couponForm.code || !couponForm.name) return toast.error('קוד ושם הם שדות חובה')
    const { data, error } = await supabase.rpc('admin_create_coupon', {
      p_code: couponForm.code,
      p_name: couponForm.name,
      p_type: couponForm.type,
      p_discount_value: couponForm.discount_value,
      p_max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
      p_valid_until: couponForm.valid_until ? new Date(couponForm.valid_until).toISOString() : null,
      p_restricted_email: couponForm.restricted_to_email || null,
      p_first_time_only: couponForm.first_time_only,
    })
    if (error) return toast.error('שגיאה: ' + error.message)
    setCoupons(prev => [data, ...prev])
    setShowAddCoupon(false)
    setCouponForm({ code: '', name: '', type: 'general', discount_value: 1, max_uses: '', valid_until: '', restricted_to_email: '', first_time_only: false })
    toast.success('קופון נוצר!')
  }

  async function handleToggleCoupon(id: string, active: boolean) {
    await supabase.rpc('admin_toggle_coupon', { p_id: id, p_active: active })
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, is_active: active } : c))
  }

  async function handleDeleteCoupon(id: string, code: string) {
    setConfirm({
      title: 'מחיקת קופון',
      message: `למחוק את הקופון "${code}"?`,
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_coupon', { p_id: id })
        setCoupons(prev => prev.filter(c => c.id !== id))
        toast.success('קופון נמחק')
      },
    })
  }

  async function handleExpandMessage(msg: SupportMessage) {
    const isNowOpen = expandedMsgId === msg.id
    setExpandedMsgId(isNowOpen ? null : msg.id)
    if (!isNowOpen && msg.status === 'unread') {
      await supabase.rpc('admin_mark_message_read', { p_id: msg.id })
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m))
    }
  }

  async function handleSendReply(msg: SupportMessage) {
    const reply = replyTexts[msg.id]?.trim()
    if (!reply) return
    setSendingReply(msg.id)
    const { error } = await supabase.rpc('admin_reply_message', { p_id: msg.id, p_reply: reply })
    setSendingReply(null)
    if (error) return toast.error('שגיאה: ' + error.message)
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'replied', admin_reply: reply } : m))
    setReplyTexts(prev => ({ ...prev, [msg.id]: '' }))
    toast.success('תשובה נשלחה')
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8">
          <Shield className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500">גישה מוגבלת למנהל ראשי</p>
        </div>
      </div>
    )
  }

  const expiringSoon = vouchers.filter(v => ['warning', 'critical'].includes(getExpiryStatus(v.expiry_date))).length

  async function handleSaveWalletName() {
    await updateWalletName(newWalletName)
    setEditingWalletName(false)
    toast.success('שם הארנק עודכן')
  }

  async function handleAddSV() {
    if (!svName) return
    await addSuperVoucher({
      name: svName,
      description: svDesc,
      stores: svStores.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      is_global: svGlobal,
      balance_check_url: svBalanceUrl.trim() || undefined,
    })
    toast.success(svGlobal ? 'שובר-על גלובלי נוסף' : 'שובר-על נוסף')
    setSvName(''); setSvStores(''); setSvDesc(''); setSvGlobal(false); setSvBalanceUrl('')
    setShowAddSV(false)
  }

  async function handleQuickAddSV(name: string, stores: string[]) {
    const alreadyExists = superVouchers.some(sv => sv.name === name)
    if (alreadyExists) return toast(`"${name}" כבר קיים`, { icon: 'ℹ️' })
    await addSuperVoucher({ name, stores, is_global: true })
    toast.success(`"${name}" נוסף כשובר-על גלובלי`)
  }

  function handleDeleteSV(id: string, name: string) {
    setConfirm({
      title: 'מחיקת שובר-על',
      message: `למחוק את "${name}"? הפעולה אינה ניתנת לביטול.`,
      onConfirm: async () => {
        setConfirm(null)
        await deleteSuperVoucher(id)
        toast.success('נמחק')
      },
    })
  }

  async function handleClearUserData(u: UserRow) {
    setDeleteTarget(null)
    const { error } = await supabase.rpc('admin_clear_user_data', { target_user_id: u.id })
    if (error) { toast.error('שגיאה: ' + error.message); return }
    toast.success(`נתוני ${u.email} נמחקו — המשתמש צריך להתנתק ולהתחבר מחדש`, { duration: 5000 })
  }

  async function handleDeleteUser(u: UserRow) {
    setDeleteTarget(null)
    const { error } = await supabase.rpc('admin_delete_user', { target_user_id: u.id })
    if (error) { toast.error('שגיאה: ' + error.message); return }
    setAllUsers(prev => prev.filter(x => x.id !== u.id))
    setSystemStats(prev => prev ? { ...prev, total_users: prev.total_users - 1 } : prev)
    toast.success(`${u.email} נמחק`)
  }

  async function exportCSV() {
    const all = [...vouchers, ...archivedVouchers]
    const rows = [
      ['חנות', 'קוד', 'יתרה', 'סכום מקורי', 'תפוגה', 'קטגוריות', 'תגיות', 'ארכיון'],
      ...all.map(v => [
        v.store_name, v.code, v.balance, v.amount,
        v.expiry_date || '', v.categories.join(';'), v.tags.join(';'),
        v.is_archived ? 'כן' : 'לא'
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'vouchers.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('קובץ CSV הורד!')
  }

  async function exportUsersCSV() {
    if (!allUsers.length) return toast.error('אין נתוני משתמשים')
    const rows = [
      ['מייל', 'שם', 'תאריך הרשמה'],
      ...allUsers.map(u => [u.email, u.name || '', formatDate(u.created_at)])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'users.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('רשימת משתמשים הורדה!')
  }

  const usersCount = systemStats?.total_users ?? null

  return (
    <div className="flex-1 bg-gray-50">
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">פעולה על משתמש</h3>
            <p className="text-sm text-gray-500 mb-1">{deleteTarget.email}</p>
            <p className="text-xs text-gray-400 mb-5">בחר פעולה — לא ניתן לשחזר</p>
            <div className="space-y-2">
              <button
                onClick={() => handleClearUserData(deleteTarget)}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-medium text-sm transition-colors"
              >
                מחק נתונים בלבד (שמור חשבון)
              </button>
              <button
                onClick={() => handleDeleteUser(deleteTarget)}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-medium text-sm transition-colors"
              >
                מחק משתמש לגמרי כולל נתונים
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-2xl font-medium text-sm transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-600" />
          פאנל מנהל
        </h1>
      </div>

      <div className="p-4 pb-24 space-y-4">

        {/* System Stats */}
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-3xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4 text-slate-300" />
            <h3 className="text-sm text-slate-300 font-medium">סטטיסטיקות מערכת</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">יתרה כוללת (כל הארנקים)</p>
              <p className="text-xl font-bold">
                {systemStats ? formatCurrency(systemStats.total_balance) : '...'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">שוברים פעילים</p>
              <p className="text-xl font-bold">{systemStats?.total_vouchers ?? '...'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארכיון</p>
              <p className="text-xl font-bold">{systemStats?.total_archived ?? '...'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארנקים</p>
              <p className="text-xl font-bold">{systemStats?.total_wallets ?? '...'}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-600 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">
                משתמשים:&nbsp;
                <span className="font-bold text-white">{usersCount === null ? '...' : usersCount}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-300">
                מנויי Pro:&nbsp;
                <span className="font-bold text-amber-300">{proCount === null ? '...' : proCount}</span>
              </span>
            </div>
          </div>
          {expiringSoon > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <span className="text-xs bg-orange-400/20 text-orange-300 px-2 py-1 rounded-lg">
                ⚠️ {expiringSoon} שוברים פגים בקרוב
              </span>
            </div>
          )}
        </div>

        {/* Registered Users List */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowUsers(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              רשימת משתמשים ({allUsers.length || usersCount || '...'})
            </span>
            <div className="flex items-center gap-2">
              {allUsers.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); exportUsersCSV() }}
                  className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-lg"
                >
                  ייצוא
                </button>
              )}
              {showUsers ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>
          {showUsers && (
            <div className="border-t divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {allUsers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">
                  הרץ את <code className="bg-gray-100 px-1 rounded text-xs">supabase-admin-functions.sql</code> כדי לראות נתונים
                </p>
              ) : allUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-800">{u.email}</p>
                    {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-400">{formatDate(u.created_at)}</p>
                    {u.email !== ADMIN_EMAIL && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="מחק משתמש"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Wallet name */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">🏷️ שם הארנק</h3>
          {!editingWalletName ? (
            <div className="flex items-center justify-between">
              <span className="text-gray-800">{walletName}</span>
              <button onClick={() => { setEditingWalletName(true); setNewWalletName(walletName) }} className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-xl">
                שנה
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input value={newWalletName} onChange={e => setNewWalletName(e.target.value)} className="flex-1 px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <button onClick={handleSaveWalletName} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm">שמור</button>
              <button onClick={() => setEditingWalletName(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm">ביטול</button>
            </div>
          )}
        </div>

        {/* Super Vouchers */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> שוברי-על ({superVouchers.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowQuickSV(v => !v)}
                className="text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl flex items-center gap-1"
              >
                <Zap className="w-3.5 h-3.5" /> מהיר
              </button>
              <button onClick={() => setShowAddSV(true)} className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-xl flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> הוסף
              </button>
            </div>
          </div>

          {/* Quick add from presets */}
          {showQuickSV && (
            <div className="bg-blue-50 rounded-2xl p-3 mb-3">
              <p className="text-xs text-blue-700 font-medium mb-2">הוסף שוברי-על ידועים (גלובלי אוטומטי):</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SUPER_VOUCHER_STORES).map(([name, stores]) => {
                  const exists = superVouchers.some(sv => sv.name === name)
                  return (
                    <button
                      key={name}
                      onClick={() => handleQuickAddSV(name, stores)}
                      disabled={exists}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                        exists
                          ? 'bg-gray-200 text-gray-400 cursor-default'
                          : 'bg-white border border-blue-200 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      {exists ? '✓ ' : ''}{name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {showAddSV && (
            <div className="bg-gray-50 rounded-2xl p-4 mb-3 space-y-2">
              <input value={svName} onChange={e => setSvName(e.target.value)} placeholder="שם שובר-על" className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <input value={svDesc} onChange={e => setSvDesc(e.target.value)} placeholder="תיאור (אופציונלי)" className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <textarea value={svStores} onChange={e => setSvStores(e.target.value)} placeholder="חנויות מכבדות (כל חנות בשורה נפרדת או מופרדות בפסיק)" rows={3} className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 resize-y" />
              <input value={svBalanceUrl} onChange={e => setSvBalanceUrl(e.target.value)} placeholder="לינק לבדיקת יתרה (אופציונלי)" type="url" className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" dir="ltr" />
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={svGlobal} onChange={e => setSvGlobal(e.target.checked)} className="w-4 h-4 accent-green-500" />
                <Globe className="w-4 h-4 text-blue-500" />
                גלובלי — יוצג לכל המשתמשים
              </label>
              <div className="flex gap-2">
                <button onClick={handleAddSV} className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm">הוסף</button>
                <button onClick={() => setShowAddSV(false)} className="flex-1 bg-gray-200 py-2 rounded-xl text-sm">ביטול</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {superVouchers.map(sv => (
              <div key={sv.id} className="border border-gray-100 rounded-2xl p-3">
                {editingSV?.id === sv.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingSV.name}
                      onChange={e => setEditingSV({ ...editingSV, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <textarea
                      value={editingSV.stores.join('\n')}
                      onChange={e => setEditingSV({ ...editingSV, stores: e.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean) })}
                      rows={3}
                      className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                    />
                    <input
                      type="url"
                      value={editingSV.balance_check_url || ''}
                      onChange={e => setEditingSV({ ...editingSV, balance_check_url: e.target.value })}
                      placeholder="לינק לבדיקת יתרה (אופציונלי)"
                      className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                      dir="ltr"
                    />
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={editingSV.is_global ?? false} onChange={e => setEditingSV({ ...editingSV, is_global: e.target.checked })} className="w-4 h-4 accent-green-500" />
                      <Globe className="w-4 h-4 text-blue-500" />
                      גלובלי
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => { updateSuperVoucher(sv.id, editingSV); setEditingSV(null); toast.success('עודכן') }} className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm">שמור</button>
                      <button onClick={() => setEditingSV(null)} className="flex-1 bg-gray-100 py-2 rounded-xl text-sm">ביטול</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-gray-800 text-sm">{sv.name}</p>
                        {sv.is_global && <Globe className="w-3.5 h-3.5 text-blue-400" aria-label="גלובלי" />}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{sv.stores.length} חנויות</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingSV(sv)} className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteSV(sv.id, sv.name)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Coupons ── */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowCoupons(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Ticket className="w-4 h-4 text-purple-500" />
              קופונים ({coupons.length})
            </span>
            <div className="flex items-center gap-2">
              {showCoupons && (
                <button
                  onClick={e => { e.stopPropagation(); setShowAddCoupon(v => !v) }}
                  className="text-xs text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> קופון חדש
                </button>
              )}
              {showCoupons ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>

          {showCoupons && (
            <div className="border-t">
              {showAddCoupon && (
                <div className="p-4 bg-purple-50 border-b space-y-2">
                  <p className="text-xs font-semibold text-purple-700 mb-2">קופון חדש</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={couponForm.code}
                      onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                      placeholder="קוד (SUMMER25)"
                      className="px-3 py-2 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                      dir="ltr"
                    />
                    <input
                      value={couponForm.name}
                      onChange={e => setCouponForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="שם פנימי"
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <select
                      value={couponForm.type}
                      onChange={e => setCouponForm(f => ({ ...f, type: e.target.value as any }))}
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    >
                      <option value="general">כללי</option>
                      <option value="private">פרטי</option>
                    </select>
                    <div className="flex items-center gap-1 border rounded-xl px-3">
                      <input
                        type="number" min={1} max={36}
                        value={couponForm.discount_value}
                        onChange={e => setCouponForm(f => ({ ...f, discount_value: parseInt(e.target.value) || 1 }))}
                        className="w-full text-sm focus:outline-none"
                      />
                      <span className="text-xs text-gray-400 whitespace-nowrap">חודשים</span>
                    </div>
                    <input
                      type="number" min={1}
                      value={couponForm.max_uses}
                      onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))}
                      placeholder="מקס שימושים"
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={couponForm.valid_until}
                      onChange={e => setCouponForm(f => ({ ...f, valid_until: e.target.value }))}
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    {couponForm.type === 'private' && (
                      <input
                        value={couponForm.restricted_to_email}
                        onChange={e => setCouponForm(f => ({ ...f, restricted_to_email: e.target.value }))}
                        placeholder="אימייל מוגבל"
                        type="email"
                        className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                        dir="ltr"
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={couponForm.first_time_only}
                      onChange={e => setCouponForm(f => ({ ...f, first_time_only: e.target.checked }))}
                      className="w-4 h-4 accent-purple-500" />
                    חדשים בלבד (למי שמעולם לא היה Pro)
                  </label>
                  <div className="flex gap-2">
                    <button onClick={handleCreateCoupon} className="flex-1 bg-purple-600 text-white py-2 rounded-xl text-sm font-medium">
                      צור קופון
                    </button>
                    <button onClick={() => setShowAddCoupon(false)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm">
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {coupons.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">אין קופונים עדיין</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {coupons.map(c => (
                    <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-purple-700">{c.code}</span>
                          <span className="text-xs text-gray-500">{c.name}</span>
                          {c.type === 'private' && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md">פרטי</span>
                          )}
                          {c.first_time_only && (
                            <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded-md">חדשים</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400">
                          <span>🎁 {c.discount_value} חודשי Pro</span>
                          <span>📊 {c.uses_count}{c.max_uses ? `/${c.max_uses}` : ''} שימושים</span>
                          {c.valid_until && <span>⏰ עד {formatDate(c.valid_until)}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleToggleCoupon(c.id, !c.is_active)}
                          className={`text-xs px-2.5 py-1 rounded-lg font-medium ${c.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                        >
                          {c.is_active ? 'פעיל' : 'כבוי'}
                        </button>
                        <button onClick={() => handleDeleteCoupon(c.id, c.code)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Support Messages ── */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowMessages(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-500" />
              הודעות תמיכה
              {messages.filter(m => m.status === 'unread').length > 0 && (
                <span className="text-xs font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                  {messages.filter(m => m.status === 'unread').length}
                </span>
              )}
            </span>
            {showMessages ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showMessages && (
            <div className="border-t">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">אין הודעות עדיין</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {messages.map(msg => {
                    const isExpanded = expandedMsgId === msg.id
                    const statusIcon = msg.status === 'unread'
                      ? <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                      : msg.status === 'replied'
                      ? <CheckCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      : <Eye className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    return (
                      <div key={msg.id}>
                        <button
                          onClick={() => handleExpandMessage(msg)}
                          className="w-full flex items-start gap-3 px-4 py-3 text-right hover:bg-gray-50 transition-colors"
                        >
                          {statusIcon}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 justify-between">
                              <span className={`text-sm font-medium truncate ${msg.status === 'unread' ? 'text-gray-900' : 'text-gray-600'}`}>
                                {msg.subject}
                              </span>
                              <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(msg.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-400">{msg.user_email || msg.user_name || 'משתמש'}</span>
                              <span className="text-xs text-gray-300">·</span>
                              <span className="text-xs text-gray-400">{CATEGORY_LABELS[msg.category] || msg.category}</span>
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-3">
                            <div className="bg-gray-50 rounded-2xl p-3">
                              <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.body}</p>
                            </div>
                            {msg.admin_reply && (
                              <div className="bg-teal-50 rounded-2xl p-3">
                                <p className="text-xs font-medium text-teal-600 mb-1">תשובתך:</p>
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.admin_reply}</p>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <textarea
                                value={replyTexts[msg.id] || ''}
                                onChange={e => setReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                placeholder="כתוב תשובה..."
                                rows={2}
                                className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
                              />
                              <button
                                onClick={() => handleSendReply(msg)}
                                disabled={sendingReply === msg.id || !replyTexts[msg.id]?.trim()}
                                className="px-3 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium flex items-center gap-1 disabled:opacity-40"
                              >
                                <Send className="w-3.5 h-3.5" />
                                {sendingReply === msg.id ? '...' : 'שלח'}
                              </button>
                            </div>
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

        {/* Exports */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-3xl py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-green-600" />
            ייצוא שוברים
          </button>
          <button
            onClick={exportUsersCSV}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-3xl py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-blue-500" />
            ייצוא משתמשים
          </button>
        </div>

      </div>
    </div>
  )
}
