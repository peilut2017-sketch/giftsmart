import { useEffect, useState } from 'react'
import { useVouchers, type ActivityLogEntry } from '../contexts/VoucherContext'
import { History, Plus, Edit2, Archive, ArchiveRestore, Trash2, CreditCard, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { formatCurrency } from '../utils/helpers'

const ACTION_META: Record<ActivityLogEntry['action'], { label: string; Icon: any; color: string; bg: string }> = {
  add:            { label: 'הוספת שובר',        Icon: Plus,           color: 'text-green-600',  bg: 'bg-green-50'  },
  edit:           { label: 'עריכת שובר',         Icon: Edit2,          color: 'text-blue-600',   bg: 'bg-blue-50'   },
  balance_update: { label: 'עדכון יתרה',         Icon: CreditCard,     color: 'text-purple-600', bg: 'bg-purple-50' },
  archive:        { label: 'העברה לארכיון',      Icon: Archive,        color: 'text-orange-600', bg: 'bg-orange-50' },
  unarchive:      { label: 'החזרה מהארכיון',     Icon: ArchiveRestore, color: 'text-teal-600',   bg: 'bg-teal-50'   },
  delete:         { label: 'מחיקה',              Icon: Trash2,         color: 'text-red-600',    bg: 'bg-red-50'    },
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'לפני רגע'
  if (m < 60) return `לפני ${m} דק׳`
  const h = Math.floor(m / 60)
  if (h < 24) return `לפני ${h} שע׳`
  const d = Math.floor(h / 24)
  if (d < 7)  return `לפני ${d} ימים`
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
}

function buildSubtitle(entry: ActivityLogEntry): string {
  const d = entry.details || {}
  switch (entry.action) {
    case 'add':
      return d.amount ? `סכום: ${formatCurrency(d.amount)}` : ''
    case 'balance_update':
      if (d.from !== undefined && d.to !== undefined)
        return `${formatCurrency(d.from)} ← ${formatCurrency(d.to)}`
      return ''
    case 'edit': {
      const parts: string[] = []
      if (d.store_name) parts.push(`שם: ${d.store_name.to}`)
      if (d.balance)    parts.push(`יתרה: ${formatCurrency(d.balance.to)}`)
      if (d.amount)     parts.push(`סכום: ${formatCurrency(d.amount.to)}`)
      if (d.expiry_date) parts.push('תוקף עודכן')
      return parts.join(' · ') || 'פרטים עודכנו'
    }
    case 'archive':
    case 'delete':
      return d.balance !== undefined ? `יתרה: ${formatCurrency(d.balance)}` : ''
    default:
      return ''
  }
}

export default function ActivityLog() {
  const { getActivityLog } = useVouchers()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [limit, setLimit] = useState(20)

  async function load(l = limit) {
    setLoading(true)
    const data = await getActivityLog(l)
    setEntries(data)
    setLoading(false)
  }

  useEffect(() => { if (expanded) load() }, [expanded])

  const visible = entries

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
      {/* Header — always visible, toggles the panel */}
      <button
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <History className="w-5 h-5 text-gray-600" />
        </div>
        <div className="flex-1 text-right">
          <p className="text-sm font-medium text-gray-800">לוג פעולות</p>
          <p className="text-xs text-gray-400">כל הפעולות שבוצעו בארנק</p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400" />
          : <ChevronDown className="w-4 h-4 text-gray-400" />
        }
      </button>

      {expanded && (
        <div className="border-t">
          {/* Refresh */}
          <div className="flex justify-end px-4 pt-2">
            <button
              onClick={() => load(limit)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600"
            >
              <RefreshCw className="w-3 h-3" />
              רענן
            </button>
          </div>

          {loading ? (
            <div className="py-10 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-green-200 border-t-green-500 rounded-full animate-spin" />
            </div>
          ) : visible.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              אין פעולות עדיין
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {visible.map(entry => {
                const meta = ACTION_META[entry.action]
                const subtitle = buildSubtitle(entry)
                return (
                  <div key={entry.id} className="flex items-start gap-3 px-4 py-3">
                    <div className={`mt-0.5 w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                      <meta.Icon className={`w-4 h-4 ${meta.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-gray-800 truncate">{entry.voucher_name}</span>
                        <span className="text-xs text-gray-400 flex-shrink-0">{timeAgo(entry.created_at)}</span>
                      </div>
                      <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                      {subtitle && <span className="text-xs text-gray-400 mr-1.5">· {subtitle}</span>}
                    </div>
                  </div>
                )
              })}

              {entries.length >= limit && (
                <button
                  onClick={() => { const next = limit + 50; setLimit(next); load(next) }}
                  className="w-full py-3 text-xs text-green-600 hover:bg-green-50 transition-colors"
                >
                  טען עוד
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
