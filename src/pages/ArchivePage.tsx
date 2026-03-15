import { useState } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatDate } from '../utils/helpers'
import { RotateCcw, Trash2, Archive } from 'lucide-react'
import toast from 'react-hot-toast'

export default function ArchivePage() {
  const navigate = useNavigate()
  const { archivedVouchers, unarchiveVoucher, deleteVoucher } = useVouchers()
  const [search, setSearch] = useState('')

  const filtered = archivedVouchers.filter(v =>
    v.store_name.toLowerCase().includes(search.toLowerCase()) ||
    v.code.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1">
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-20 px-4 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Archive className="w-5 h-5 text-gray-400" />
          <h1 className="text-xl font-bold text-gray-900">ארכיון</h1>
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-0.5 rounded-full">{archivedVouchers.length}</span>
        </div>
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="חיפוש בארכיון..."
          className="w-full px-4 py-2.5 bg-gray-100 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
        />
      </div>

      <div className="p-4 pb-24">
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-3">🗄️</div>
            <p className="text-gray-500">{search ? 'לא נמצאו שוברים' : 'הארכיון ריק'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(v => (
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
                      onClick={e => {
                        e.stopPropagation()
                        if (confirm('למחוק לצמיתות?')) deleteVoucher(v.id).then(() => toast.success('נמחק'))
                      }}
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
