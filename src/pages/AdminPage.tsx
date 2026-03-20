import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, getExpiryStatus, formatDate } from '../utils/helpers'
import { Shield, Users, Star, Download, Edit2, Trash2, Plus, Globe, BarChart2, Zap, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import type { SuperVoucher } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { SUPER_VOUCHER_STORES } from '../types'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@example.com'

interface Member {
  user_id: string
  email: string
  role: string
}

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

type Confirm = { title: string; message?: string; onConfirm: () => void }

export default function AdminPage() {
  const { user } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, walletId, walletName, addSuperVoucher, updateSuperVoucher, deleteSuperVoucher, inviteMember, removeMember, updateWalletName } = useVouchers()

  const [members, setMembers] = useState<Member[]>([])
  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
  const [showUsers, setShowUsers] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [editingWalletName, setEditingWalletName] = useState(false)
  const [newWalletName, setNewWalletName] = useState(walletName)
  const [editingSV, setEditingSV] = useState<SuperVoucher | null>(null)
  const [showAddSV, setShowAddSV] = useState(false)
  const [svName, setSvName] = useState('')
  const [svStores, setSvStores] = useState('')
  const [svDesc, setSvDesc] = useState('')
  const [svGlobal, setSvGlobal] = useState(false)
  const [showQuickSV, setShowQuickSV] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const isAdmin = user?.email === ADMIN_EMAIL

  // Load system-wide stats immediately — no walletId needed
  useEffect(() => {
    if (!isAdmin) return
    supabase.rpc('get_system_stats').then(({ data }) => {
      if (data) setSystemStats(data)
    })
    supabase.rpc('get_all_users').then(({ data }) => {
      if (data) setAllUsers(data)
    })
  }, [isAdmin])

  // Load wallet members only once walletId is available
  useEffect(() => {
    if (!walletId || !isAdmin) return
    supabase.from('wallet_members').select('*').eq('wallet_id', walletId).then(({ data }) => {
      if (data) setMembers(data)
    })
  }, [walletId, isAdmin])

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

  async function handleInvite() {
    if (!inviteEmail) return
    try {
      await inviteMember(inviteEmail)
      toast.success('הזמנה נשלחה!')
      setInviteEmail('')
    } catch (err: any) {
      toast.error(err?.message || 'שגיאה בהזמנה')
    }
  }

  function handleRemoveMember(userId: string, email: string) {
    setConfirm({
      title: 'הסרת חבר',
      message: `להסיר את ${email} מהארנק?`,
      onConfirm: async () => {
        setConfirm(null)
        await removeMember(userId)
        setMembers(prev => prev.filter(m => m.user_id !== userId))
        toast.success('חבר הוסר')
      },
    })
  }

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
    })
    toast.success(svGlobal ? 'שובר-על גלובלי נוסף' : 'שובר-על נוסף')
    setSvName(''); setSvStores(''); setSvDesc(''); setSvGlobal(false)
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
          <div className="mt-3 pt-3 border-t border-slate-600 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">
                משתמשים רשומים:&nbsp;
                <span className="font-bold text-white">{usersCount === null ? '...' : usersCount}</span>
              </span>
            </div>
            {expiringSoon > 0 && (
              <span className="text-xs bg-orange-400/20 text-orange-300 px-2 py-1 rounded-lg">
                ⚠️ {expiringSoon} פגים בקרוב
              </span>
            )}
          </div>
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
                  <p className="text-xs text-gray-400">{formatDate(u.created_at)}</p>
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
              <input value={newWalletName} onChange={e => setNewWalletName(e.target.value)} className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              <button onClick={handleSaveWalletName} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm">שמור</button>
              <button onClick={() => setEditingWalletName(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm">ביטול</button>
            </div>
          )}
        </div>

        {/* Members */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" /> חברים בארנק ({members.length})
          </h3>
          <div className="space-y-2 mb-3">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm text-gray-700">{m.email}</p>
                  <p className="text-xs text-gray-400">{m.role === 'owner' ? 'בעלים' : 'חבר'}</p>
                </div>
                {m.role !== 'owner' && (
                  <button onClick={() => handleRemoveMember(m.user_id, m.email)} className="text-red-500 p-1.5 rounded-lg hover:bg-red-50">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="אימייל לשליחת הזמנה"
              className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              dir="ltr"
            />
            <button onClick={handleInvite} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium">הזמן</button>
          </div>
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
              <input value={svName} onChange={e => setSvName(e.target.value)} placeholder="שם שובר-על" className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              <input value={svDesc} onChange={e => setSvDesc(e.target.value)} placeholder="תיאור (אופציונלי)" className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              <textarea value={svStores} onChange={e => setSvStores(e.target.value)} placeholder="חנויות מכבדות (כל חנות בשורה נפרדת או מופרדות בפסיק)" rows={3} className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 resize-y" />
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
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <textarea
                      value={editingSV.stores.join('\n')}
                      onChange={e => setEditingSV({ ...editingSV, stores: e.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean) })}
                      rows={3}
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
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
