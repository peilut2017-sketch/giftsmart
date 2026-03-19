import { useState, useMemo, useRef } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatDate } from '../utils/helpers'
import { RotateCcw, Trash2, Archive, SlidersHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'

type SortKey = 'added' | 'store' | 'balance' | 'expiry'

export default function ArchivePage() {
  const navigate = useNavigate()
  const { archivedVouchers, unarchiveVoucher, deleteVoucher } = useVouchers()
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [showSort, setShowSort] = useState(false)

  // Undo delete
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const sortedFiltered = useMemo(() => {
    let result = archivedVouchers.filter(v =>
      !hiddenIds.has(v.id) && (
        v.store_name.toLowerCase().includes(search.toLowerCase()) ||
        v.code.toLowerCase().includes(search.toLowerCase())
      )
    )
    switch (sortKey) {
      case 'store': result.sort((a, b) => a.store_name.localeCompare(b.store_name, 'he')); break
      case 'balance': result.sort((a, b) => b.balance - a.balance); break
      case 'expiry':
        result.sort((a, b) => {
          if (!a.expiry_date) return 1
          if (!b.expiry_date) return -1
          return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
        })
        break
      default: // added - newest first
        result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
    return result
  }, [archivedVouchers, search, sortKey, hiddenIds])

  function requestDelete(id: string) {
    setConfirm({
      title: 'מחיקת שובר',
      message: 'למחוק את השובר לצמיתות? הפעולה אינה ניתנת לביטול.',
      onConfirm: () => { setConfirm(null); handleDelete(id) },
    })
  }

  async function handleDelete(id: string) {
    setHiddenIds(prev => new Set([...prev, id]))
    const timer = setTimeout(async () => {
      await deleteVoucher(id)
      setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
      pendingDeletesRef.current.delete(id)
    }, 5000)
    pendingDeletesRef.current.set(id, timer)

    toast(
      (t) => (
        <span>
          שובר נמחק{' '}
          <button
            onClick={() => {
              clearTimeout(pendingDeletesRef.current.get(id))
              pendingDeletesRef.current.delete(id)
              setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              toast.dismiss(t.id)
            }}
            className="underline font-semibold text-blue-600 mr-1"
          >
            ביטול
          </button>
        </span>
      ),
      { duration: 5000, icon: '🗑️' }
    )
  }

  const sortLabels: Record<SortKey, string> = {
    added: '🕐 חדש→ישן',
    store: '🏪 חנות א-ב',
    balance: '₪ יתרה',
    expiry: '📅 תפוגה',
  }

  return (
    <div className="flex-1">
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20 px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Archive className="w-5 h-5 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-900">ארכיון</h1>
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{archivedVouchers.length}</span>
          <div className="flex-1" />
          <button
            onClick={() => setShowSort(!showSort)}
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
              showSort ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {sortLabels[sortKey]}
          </button>
        </div>

        {showSort && (
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(sortLabels) as SortKey[]).map(key => (
              <button
                key={key}
                onClick={() => { setSortKey(key); setShowSort(false) }}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                  sortKey === key ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {sortLabels[key]}
              </button>
            ))}
          </div>
        )}

        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש בארכיון..."
          className="w-full px-4 py-2.5 bg-gray-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
        />
      </div>

      <div className="p-4 pb-24">
        {sortedFiltered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">🗄️</div>
            <p className="text-gray-500">{search ? 'לא נמצאו שוברים' : 'הארכיון ריק'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFiltered.map(v => (
              <div
                key={v.id}
                onClick={() => navigate(`/checkout/${v.id}`)}
                className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-700 truncate">{v.store_name}</p>
                    <p className="text-xs text-gray-400 font-mono mt-0.5">{v.code}</p>
                    {v.expiry_date && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        תוקף: {formatDate(v.expiry_date)}
                      </p>
                    )}
                    {v.categories?.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {v.categories.slice(0, 2).map(cat => (
                          <span key={cat} className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{cat}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mr-2">
                    <div className="text-left">
                      <div className="text-base font-bold text-gray-500">{formatCurrency(v.balance)}</div>
                    </div>
                    <button
                      onClick={e => { e.stopPropagation(); unarchiveVoucher(v.id).then(() => toast.success('הוחזר לארנק')) }}
                      className="p-2 rounded-xl bg-green-50 text-green-600 hover:bg-green-100 transition-colors"
                      title="החזר לארנק"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); requestDelete(v.id) }}
                      className="p-2 rounded-xl bg-red-50 text-red-500 hover:bg-red-100 transition-colors"
                      title="מחיקה"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
