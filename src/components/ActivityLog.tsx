import { useEffect, useState } from 'react'
import { useVouchers, type ActivityLogEntry } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { History, Plus, Edit2, Archive, ArchiveRestore, Trash2, CreditCard, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Undo2, Zap } from 'lucide-react'
import { formatCurrency } from '../utils/helpers'
import toast from 'react-hot-toast'

const ACTION_META: Record<ActivityLogEntry['action'], { label: string; Icon: any; color: string; bg: string }> = {
  add:            { label: 'הוספת שובר',     Icon: Plus,           color: 'text-green-600',  bg: 'bg-green-50'  },
  edit:           { label: 'עריכת שובר',      Icon: Edit2,          color: 'text-blue-600',   bg: 'bg-blue-50'   },
  balance_update: { label: 'עדכון יתרה',      Icon: CreditCard,     color: 'text-purple-600', bg: 'bg-purple-50' },
  archive:        { label: 'העברה לארכיון',   Icon: Archive,        color: 'text-orange-600', bg: 'bg-orange-50' },
  unarchive:      { label: 'החזרה מהארכיון',  Icon: ArchiveRestore, color: 'text-teal-600',   bg: 'bg-teal-50'   },
  delete:         { label: 'מחיקה',           Icon: Trash2,         color: 'text-red-600',    bg: 'bg-red-50'    },
}

const UNDOABLE: ActivityLogEntry['action'][] = ['edit', 'balance_update', 'archive', 'unarchive']

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
      return d.from !== undefined && d.to !== undefined
        ? `${formatCurrency(d.from)} ← ${formatCurrency(d.to)}` : ''
    case 'edit': {
      const parts: string[] = []
      if (d.store_name)  parts.push(`שם: ${d.store_name.to}`)
      if (d.balance)     parts.push(`יתרה: ${formatCurrency(d.balance.to)}`)
      if (d.amount)      parts.push(`סכום: ${formatCurrency(d.amount.to)}`)
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

const PAGE = 30

export default function ActivityLog() {
  const { getActivityLog, updateVoucher, archiveVoucher, unarchiveVoucher } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tableError, setTableError] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [expanded, setExpanded] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)

  async function load(l = limit) {
    setLoading(true)
    setTableError(false)
    try {
      const { error: checkErr } = await supabase
        .from('activity_log')
        .select('id')
        .limit(1)

      if (checkErr?.code === '42P01' || checkErr?.message?.includes('does not exist')) {
        setTableError(true)
        setLoading(false)
        return
      }

      const data = await getActivityLog(l)
      setEntries(data)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (expanded && entries.length === 0 && !tableError) load()
  }, [expanded])

  async function handleUndo(entry: ActivityLogEntry) {
    if (!entry.voucher_id) return
    setUndoingId(entry.id)
    try {
      if (entry.action === 'balance_update') {
        await updateVoucher(entry.voucher_id, { balance: entry.details.from })
        toast.success('יתרה שוחזרה')
      } else if (entry.action === 'edit') {
        const before: Record<string, any> = {}
        Object.entries(entry.details).forEach(([k, v]: [string, any]) => {
          if (v && typeof v === 'object' && 'from' in v) before[k] = v.from
        })
        if (Object.keys(before).length > 0) {
          await updateVoucher(entry.voucher_id, before)
          toast.success('עריכה שוחזרה')
        }
      } else if (entry.action === 'archive') {
        await unarchiveVoucher(entry.voucher_id)
        toast.success('שובר הוחזר מהארכיון')
      } else if (entry.action === 'unarchive') {
        await archiveVoucher(entry.voucher_id)
        toast.success('שובר הועבר לארכיון')
      }
      await load(limit)
    } catch {
      toast.error('שחזור נכשל')
    } finally {
      setUndoingId(null)
    }
  }

  return (
    <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
      {/* Collapsible header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
          <History className="w-5 h-5 text-gray-600" />
        </div>
        <div className="flex-1 text-right">
          <p className="text-sm font-medium text-gray-800">לוג פעולות</p>
          <p className="text-xs text-gray-400">
            {expanded && entries.length > 0 ? `${entries.length} רשומות` : 'הוספה, עריכה, ארכיון, מחיקה'}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        }
      </button>

      {expanded && (
        <div className="border-t">
          <div className="flex justify-end px-4 pt-2 pb-1">
            <button
              onClick={() => load(limit)}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-green-600 disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              רענן
            </button>
          </div>

          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2">
              <div className="w-7 h-7 border-2 border-green-200 border-t-green-500 rounded-full animate-spin" />
              <p className="text-xs text-gray-400">טוען פעולות...</p>
            </div>

          ) : tableError ? (
            <div className="py-6 px-5 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
              </div>
              <p className="text-sm font-medium text-gray-700">טבלת הלוג לא קיימת ב-Supabase</p>
              <p className="text-xs text-gray-400">הרץ את ה-SQL הבא ב-SQL Editor של Supabase:</p>
              <pre className="w-full text-left bg-gray-50 rounded-xl p-3 text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap">
{`CREATE TABLE activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  wallet_id UUID REFERENCES wallets(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  voucher_id UUID,
  voucher_name TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX activity_log_user_idx
  ON activity_log(user_id, created_at DESC);
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own activity log"
  ON activity_log FOR ALL
  USING (user_id = auth.uid());`}
              </pre>
            </div>

          ) : entries.length === 0 ? (
            <div className="py-10 flex flex-col items-center gap-2 text-center">
              <History className="w-8 h-8 text-gray-300" />
              <p className="text-sm text-gray-500">אין פעולות עדיין</p>
              <p className="text-xs text-gray-400">פעולות יירשמו כשתוסיף, תערוך, תארכב או תמחק שוברים</p>
            </div>

          ) : (
            <div className="divide-y divide-gray-50">
              {entries
                .filter(e => {
                  if (limits.historyDays === Infinity) return true
                  const cutoff = Date.now() - limits.historyDays * 24 * 60 * 60 * 1000
                  return new Date(e.created_at).getTime() >= cutoff
                })
                .map(entry => {
                  const meta = ACTION_META[entry.action]
                  const subtitle = buildSubtitle(entry)
                  const canUndo = UNDOABLE.includes(entry.action) && !!entry.voucher_id
                  return (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                        <meta.Icon className={`w-4 h-4 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-gray-800 truncate">{entry.voucher_name}</span>
                          <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{timeAgo(entry.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                          {subtitle && <span className="text-xs text-gray-400">· {subtitle}</span>}
                        </div>
                      </div>
                      {canUndo && (
                        <button
                          onClick={() => handleUndo(entry)}
                          disabled={undoingId === entry.id}
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-gray-500 hover:bg-gray-100 hover:text-green-700 disabled:opacity-40 transition-colors"
                          aria-label={`שחזר פעולה: ${meta.label}`}
                        >
                          <Undo2 className={`w-3.5 h-3.5 ${undoingId === entry.id ? 'animate-spin' : ''}`} />
                          שחזר
                        </button>
                      )}
                    </div>
                  )
                })}

              {limits.historyDays < Infinity && (
                <button
                  onClick={() => openUpgradeSheet('שדרג לPro לצפייה בכל ההיסטוריה')}
                  className="w-full flex items-center justify-center gap-2 py-3 text-xs text-amber-600 hover:bg-amber-50 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  מציג {limits.historyDays} ימים אחרונים בלבד — שדרג לצפייה בכל ההיסטוריה
                </button>
              )}

              {limits.historyDays === Infinity && entries.length >= limit && (
                <button
                  onClick={() => { const next = limit + PAGE; setLimit(next); load(next) }}
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
