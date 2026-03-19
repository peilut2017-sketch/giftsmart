import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, getExpiryStatus } from '../utils/helpers'
import { Shield, Users, Star, Download, Edit2, Trash2, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import type { SuperVoucher } from '../types'

const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'admin@example.com'

interface Member {
  user_id: string
  email: string
  role: string
}

export default function AdminPage() {
  const { user } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, walletId, walletName, addSuperVoucher, updateSuperVoucher, deleteSuperVoucher, inviteMember, removeMember, updateWalletName } = useVouchers()

  const [members, setMembers] = useState<Member[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [editingWalletName, setEditingWalletName] = useState(false)
  const [newWalletName, setNewWalletName] = useState(walletName)
  const [editingSV, setEditingSV] = useState<SuperVoucher | null>(null)
  const [showAddSV, setShowAddSV] = useState(false)
  const [svName, setSvName] = useState('')
  const [svStores, setSvStores] = useState('')
  const [svDesc, setSvDesc] = useState('')

  const isAdmin = user?.email === ADMIN_EMAIL

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

  const totalBalance = vouchers.reduce((s, v) => s + v.balance, 0)
  const totalAmount = vouchers.reduce((s, v) => s + v.amount, 0)
  const totalUsed = totalAmount - totalBalance
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

  async function handleRemoveMember(userId: string) {
    if (!confirm('להסיר חבר?')) return
    await removeMember(userId)
    setMembers(prev => prev.filter(m => m.user_id !== userId))
    toast.success('חבר הוסר')
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
    })
    toast.success('שובר-על נוסף')
    setSvName(''); setSvStores(''); setSvDesc('')
    setShowAddSV(false)
  }

  async function handleDeleteSV(id: string) {
    if (!confirm('למחוק שובר-על?')) return
    await deleteSuperVoucher(id)
    toast.success('נמחק')
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

  return (
    <div className="flex-1 bg-gray-50">
      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-600" />
          פאנל מנהל
        </h1>
      </div>

      <div className="p-4 pb-24 space-y-4">
        {/* Stats */}
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-3xl p-5 text-white">
          <h3 className="text-sm text-slate-300 mb-3">סטטיסטיקות ארנק</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">יתרה כוללת</p>
              <p className="text-xl font-bold">{formatCurrency(totalBalance)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">שווי רכישות</p>
              <p className="text-xl font-bold">{formatCurrency(totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">סה"כ נוצל</p>
              <p className="text-xl font-bold">{formatCurrency(totalUsed)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">פגים בקרוב</p>
              <p className={`text-xl font-bold ${expiringSoon > 0 ? 'text-orange-300' : 'text-white'}`}>{expiringSoon}</p>
            </div>
          </div>
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
              <input
                value={newWalletName}
                onChange={e => setNewWalletName(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              <button onClick={handleSaveWalletName} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm">
                שמור
              </button>
              <button onClick={() => setEditingWalletName(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm">
                ביטול
              </button>
            </div>
          )}
        </div>

        {/* Members */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <Users className="w-4 h-4" /> חברים ({members.length})
          </h3>
          <div className="space-y-2 mb-3">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between py-2 border-b last:border-0">
                <div>
                  <p className="text-sm text-gray-700">{m.email}</p>
                  <p className="text-xs text-gray-400">{m.role === 'owner' ? 'בעלים' : 'חבר'}</p>
                </div>
                {m.role !== 'owner' && (
                  <button onClick={() => handleRemoveMember(m.user_id)} className="text-red-500 p-1.5 rounded-lg hover:bg-red-50">
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
            <button onClick={handleInvite} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium">
              הזמן
            </button>
          </div>
        </div>

        {/* Super Vouchers */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> שוברי-על ({superVouchers.length})
            </h3>
            <button onClick={() => setShowAddSV(true)} className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-xl flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> הוסף
            </button>
          </div>

          {showAddSV && (
            <div className="bg-gray-50 rounded-2xl p-4 mb-3 space-y-2">
              <input value={svName} onChange={e => setSvName(e.target.value)} placeholder="שם שובר-על" className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              <input value={svDesc} onChange={e => setSvDesc(e.target.value)} placeholder="תיאור (אופציונלי)" className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              <textarea value={svStores} onChange={e => setSvStores(e.target.value)} placeholder="חנויות מכבדות (כל חנות בשורה נפרדת או מופרדות בפסיק)" rows={3} className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 resize-y" />
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
                    <div className="flex gap-2">
                      <button onClick={() => { updateSuperVoucher(sv.id, editingSV); setEditingSV(null); toast.success('עודכן') }} className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm">שמור</button>
                      <button onClick={() => setEditingSV(null)} className="flex-1 bg-gray-100 py-2 rounded-xl text-sm">ביטול</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-medium text-gray-800 text-sm">{sv.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{sv.stores.length} חנויות</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingSV(sv)} className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteSV(sv.id)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Export */}
        <button
          onClick={exportCSV}
          className="w-full flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-3xl py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
        >
          <Download className="w-5 h-5 text-green-600" />
          ייצוא CSV
        </button>
      </div>
    </div>
  )
}
