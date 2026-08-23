import { useEffect, useState } from 'react'
import { useVouchers, type ActivityLogEntry } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { supabase } from '../lib/supabase'
import { History, Plus, Edit2, Archive, ArchiveRestore, Trash2, CreditCard, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Undo2, Zap, Gift, Link2, Mail, Share2, ShoppingBag, XCircle, KeyRound, Fingerprint, MessageSquare, Users, CreditCard as CardIcon, ShoppingCart } from 'lucide-react'
import { formatCurrency } from '../utils/helpers'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'

const ACTION_META: Record<ActivityLogEntry['action'], { labelKey: string; Icon: any; color: string; bg: string }> = {
  // Voucher actions
  add:                          { labelKey: 'log.action.add',                    Icon: Plus,          color: 'text-green-600',  bg: 'bg-green-50'   },
  edit:                         { labelKey: 'log.action.edit',                   Icon: Edit2,         color: 'text-blue-600',   bg: 'bg-blue-50'    },
  balance_update:               { labelKey: 'log.action.balance_update',         Icon: CreditCard,    color: 'text-purple-600', bg: 'bg-purple-50'  },
  archive:                      { labelKey: 'log.action.archive',                Icon: Archive,       color: 'text-orange-600', bg: 'bg-orange-50'  },
  unarchive:                    { labelKey: 'log.action.unarchive',              Icon: ArchiveRestore,color: 'text-teal-600',   bg: 'bg-teal-50'    },
  delete:                       { labelKey: 'log.action.delete',                 Icon: Trash2,        color: 'text-red-600',    bg: 'bg-red-50'     },
  // Sharing
  share_link:                   { labelKey: 'log.action.share_link',             Icon: Link2,         color: 'text-cyan-600',   bg: 'bg-cyan-50'    },
  share_link_deleted:           { labelKey: 'log.action.share_link_deleted',     Icon: Link2,         color: 'text-cyan-600',   bg: 'bg-cyan-50'    },
  share_email:                  { labelKey: 'log.action.share_email',            Icon: Share2,        color: 'text-cyan-600',   bg: 'bg-cyan-50'    },
  unshare_email:                { labelKey: 'log.action.unshare_email',          Icon: Share2,        color: 'text-cyan-600',   bg: 'bg-cyan-50'    },
  // Gift
  gift_sent:                    { labelKey: 'log.action.gift_sent',              Icon: Mail,          color: 'text-pink-600',   bg: 'bg-pink-50'    },
  gift_link:                    { labelKey: 'log.action.gift_link',              Icon: Link2,         color: 'text-pink-600',   bg: 'bg-pink-50'    },
  gift_cancelled:               { labelKey: 'log.action.gift_cancelled',         Icon: XCircle,       color: 'text-pink-600',   bg: 'bg-pink-50'    },
  gift_received:                { labelKey: 'log.action.gift_received',          Icon: Gift,          color: 'text-rose-600',   bg: 'bg-rose-50'    },
  gift_balance_update:          { labelKey: 'log.action.gift_balance_update',    Icon: CreditCard,    color: 'text-pink-600',   bg: 'bg-pink-50'    },
  // Marketplace
  list_for_sale:                { labelKey: 'log.action.list_for_sale',          Icon: ShoppingBag,   color: 'text-violet-600', bg: 'bg-violet-50'  },
  cancel_sale:                  { labelKey: 'log.action.cancel_sale',            Icon: XCircle,       color: 'text-violet-600', bg: 'bg-violet-50'  },
  // System events
  system_password_change:       { labelKey: 'log.action.system_password_change', Icon: KeyRound,      color: 'text-gray-600',   bg: 'bg-gray-100'   },
  system_biometric_link:        { labelKey: 'log.action.system_biometric_link',  Icon: Fingerprint,   color: 'text-gray-600',   bg: 'bg-gray-100'   },
  system_telegram_link:         { labelKey: 'log.action.system_telegram_link',   Icon: MessageSquare, color: 'text-gray-600',   bg: 'bg-gray-100'   },
  system_wallet_share:          { labelKey: 'log.action.system_wallet_share',    Icon: Users,         color: 'text-gray-600',   bg: 'bg-gray-100'   },
  system_payment_method_add:    { labelKey: 'log.action.system_payment_method_add',    Icon: CardIcon, color: 'text-gray-600',  bg: 'bg-gray-100'   },
  system_payment_method_remove: { labelKey: 'log.action.system_payment_method_remove', Icon: CardIcon, color: 'text-gray-600',  bg: 'bg-gray-100'   },
  system_voucher_purchase:      { labelKey: 'log.action.system_voucher_purchase', Icon: ShoppingCart, color: 'text-gray-600',   bg: 'bg-gray-100'   },
}

// Rows written by older versions / server RPCs may carry actions outside the
// map — rendering must never crash on them (it used to blank the whole panel).
const FALLBACK_META = { labelKey: '', Icon: History, color: 'text-gray-500', bg: 'bg-gray-100' }

const UNDOABLE: ActivityLogEntry['action'][] = ['edit', 'balance_update', 'archive', 'unarchive']

function timeAgo(iso: string, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return t('log.time.just.now')
  if (m < 60) return t('log.time.minutes.ago', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('log.time.hours.ago', { h })
  const d = Math.floor(h / 24)
  if (d < 7)  return t('log.time.days.ago', { d })
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', year: 'numeric' })
}

// Who performed the action — shared partners and share/gift links write a
// source (and, for partners, an actor name) into details.
function actorSuffix(d: ActivityLogEntry['details'], t: (key: string, vars?: Record<string, string | number>) => string): string {
  if (d.source === 'shared_user') return d.actor_name ? ` · ${t('log.sub.by.partner')}: ${d.actor_name}` : ` · ${t('log.sub.by.partner')}`
  if (d.source === 'shared_link') return ` · ${t('log.sub.by.link')}`
  if (d.source === 'gift_link')   return ` · ${t('log.sub.by.gift.link')}`
  return ''
}

function balanceLine(d: ActivityLogEntry['details'], t: (key: string, vars?: Record<string, string | number>) => string): string {
  const parts: string[] = []
  if (d.used != null && Number(d.used) > 0) parts.push(`${t('log.sub.used')}: ${formatCurrency(d.used)}`)
  else if (d.from !== undefined && d.to !== undefined) parts.push(`${formatCurrency(d.from)} ← ${formatCurrency(d.to)}`)
  if (d.to !== undefined && (d.used != null || d.from !== undefined)) parts.push(`${t('log.sub.balance')}: ${formatCurrency(d.to)}`)
  if (d.store_used) parts.push(String(d.store_used))
  return parts.join(' · ')
}

function buildSubtitle(entry: ActivityLogEntry, t: (key: string, vars?: Record<string, string | number>) => string): string {
  const d = entry.details || {}
  switch (entry.action) {
    case 'add':
      return d.amount ? `${t('log.sub.amount')}: ${formatCurrency(d.amount)}` : ''
    case 'balance_update': {
      const base = balanceLine(d, t)
      return base ? base + actorSuffix(d, t) : actorSuffix(d, t).replace(/^ · /, '')
    }
    case 'edit': {
      const parts: string[] = []
      if (d.store_name)  parts.push(`${t('log.sub.name')}: ${d.store_name.to}`)
      if (d.balance)     parts.push(`${t('log.sub.balance')}: ${formatCurrency(d.balance.to)}`)
      if (d.amount)      parts.push(`${t('log.sub.amount')}: ${formatCurrency(d.amount.to)}`)
      if (d.expiry_date) parts.push(t('log.sub.expiry.updated'))
      return parts.join(' · ') || t('log.sub.details.updated')
    }
    case 'archive':
    case 'delete':
      return d.balance !== undefined ? `${t('log.sub.balance')}: ${formatCurrency(d.balance)}` : ''
    case 'gift_sent':
      return d.recipient ? `${t('log.sub.to')}: ${d.recipient}` : ''
    case 'gift_link':
      return t('log.sub.gift.link')
    case 'gift_received':
      return d.sender ? `${t('log.sub.from')}: ${d.sender}` : ''
    case 'gift_balance_update': {
      const base = balanceLine(d, t)
      return base ? base + actorSuffix(d, t) : actorSuffix(d, t).replace(/^ · /, '')
    }
    case 'gift_cancelled':
      return d.recipient ? `${t('log.sub.to')}: ${d.recipient}` : ''
    case 'share_link':
      return d.expires_in_days ? `${t('log.sub.valid')}: ${d.expires_in_days} ${t('log.sub.days')}` : t('log.sub.no.expiry')
    case 'share_link_deleted':
      return ''
    case 'share_email':
    case 'unshare_email':
      return d.recipient ? `${t('log.sub.to')}: ${d.recipient}` : ''
    case 'list_for_sale':
      return d.asking_price ? `${t('log.sub.price')}: ${formatCurrency(d.asking_price)}` : ''
    case 'cancel_sale':
      return ''
    case 'system_payment_method_add':
    case 'system_payment_method_remove':
      return d.type ? d.type : ''
    case 'system_wallet_share':
      return d.email ? `${t('log.sub.to')}: ${d.email}` : ''
    case 'system_voucher_purchase':
      return d.store_name ? d.store_name : ''
    default:
      return ''
  }
}

const PAGE = 30

export default function ActivityLog() {
  const { t } = useT()
  const { getActivityLog, updateVoucher, archiveVoucher, unarchiveVoucher } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const [entries, setEntries] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tableError, setTableError] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [expanded, setExpanded] = useState(false)
  const [undoingId, setUndoingId] = useState<string | null>(null)

  // The plan window filters what's shown — every count and pagination decision
  // must use the filtered list, or the header advertises rows the user can't see.
  const cutoffMs = limits.historyDays === Infinity
    ? -Infinity
    : Date.now() - limits.historyDays * 24 * 60 * 60 * 1000
  const visibleEntries = entries.filter(e => new Date(e.created_at).getTime() >= cutoffMs)
  const oldestLoadedMs = entries.length > 0
    ? new Date(entries[entries.length - 1].created_at).getTime()
    : Infinity
  // More rows may exist server-side, and (for free plans) the ones we'd fetch
  // can still fall inside the visible window as long as the oldest loaded row does.
  const canLoadMore = entries.length >= limit && oldestLoadedMs >= cutoffMs

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
        toast.success(t('log.undo.balance.restored'))
      } else if (entry.action === 'edit') {
        const before: Record<string, any> = {}
        Object.entries(entry.details).forEach(([k, v]: [string, any]) => {
          if (v && typeof v === 'object' && 'from' in v) before[k] = v.from
        })
        if (Object.keys(before).length > 0) {
          await updateVoucher(entry.voucher_id, before)
          toast.success(t('log.undo.edit.restored'))
        }
      } else if (entry.action === 'archive') {
        await unarchiveVoucher(entry.voucher_id)
        toast.success(t('log.undo.unarchived'))
      } else if (entry.action === 'unarchive') {
        await archiveVoucher(entry.voucher_id)
        toast.success(t('log.undo.archived'))
      }
      await load(limit)
    } catch {
      toast.error(t('log.undo.failed'))
    } finally {
      setUndoingId(null)
    }
  }

  return (
    <div className="bg-surface rounded-3xl shadow-sm overflow-hidden">
      {/* Collapsible header */}
      <button
        className="w-full flex items-center gap-3 px-4 py-4 hover:bg-bg transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
          <History className="w-5 h-5 text-text2" />
        </div>
        <div className="flex-1 text-right">
          <p className="text-sm font-medium text-text">{t('log.title')}</p>
          <p className="text-xs text-text3">
            {expanded && visibleEntries.length > 0 ? `${visibleEntries.length} ${t('log.records')}` : t('log.subtitle')}
          </p>
        </div>
        {expanded
          ? <ChevronUp className="w-4 h-4 text-text3 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-text3 flex-shrink-0" />
        }
      </button>

      {expanded && (
        <div className="border-t border-border">
          <div className="flex justify-end px-4 pt-2 pb-1">
            <button
              onClick={() => load(limit)}
              disabled={loading}
              className="flex items-center gap-1 text-xs text-text3 hover:text-primary disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {t('log.refresh')}
            </button>
          </div>

          {loading ? (
            <div className="py-10 flex flex-col items-center justify-center gap-2">
              <div className="w-7 h-7 border-2 border-primary-light border-t-primary rounded-full animate-spin" />
              <p className="text-xs text-text3">{t('log.loading')}</p>
            </div>

          ) : tableError ? (
            <div className="py-6 px-5 flex flex-col items-center gap-3 text-center">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-orange-500" />
              </div>
              <p className="text-sm font-medium text-text">{t('log.unavailable')}</p>
              <p className="text-xs text-text3">{t('log.unavailable.hint')}</p>
              <button
                onClick={() => load(limit)}
                className="px-4 py-2 rounded-xl bg-bg text-xs font-semibold text-text2 hover:bg-border/60 transition-colors"
              >
                {t('app.retry')}
              </button>
            </div>

          ) : visibleEntries.length === 0 ? (
            <div className="py-10 flex flex-col items-center gap-2 text-center">
              <History className="w-8 h-8 text-border" />
              <p className="text-sm text-text2">{t('log.empty')}</p>
              <p className="text-xs text-text3">{t('log.empty.hint')}</p>
            </div>

          ) : (
            <div className="divide-y divide-border/50">
              {visibleEntries
                .map(entry => {
                  const meta = ACTION_META[entry.action] ?? FALLBACK_META
                  const subtitle = buildSubtitle(entry, t)
                  const canUndo = UNDOABLE.includes(entry.action) && !!entry.voucher_id
                  return (
                    <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${meta.bg}`}>
                        <meta.Icon className={`w-4 h-4 ${meta.color}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-text truncate">{entry.voucher_name}</span>
                          <span className="text-xs text-text3 flex-shrink-0 whitespace-nowrap">{timeAgo(entry.created_at, t)}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <span className={`text-xs font-medium ${meta.color}`}>{meta.labelKey ? t(meta.labelKey) : entry.action}</span>
                          {subtitle && <span className="text-xs text-text3">· {subtitle}</span>}
                        </div>
                      </div>
                      {canUndo && (
                        <button
                          onClick={() => handleUndo(entry)}
                          disabled={undoingId === entry.id}
                          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-text3 hover:bg-bg hover:text-primary disabled:opacity-40 transition-colors"
                          aria-label={t('log.undo.aria', { action: meta.labelKey ? t(meta.labelKey) : entry.action })}
                        >
                          <Undo2 className={`w-3.5 h-3.5 ${undoingId === entry.id ? 'animate-spin' : ''}`} />
                          {t('log.undo.button')}
                        </button>
                      )}
                    </div>
                  )
                })}

              {canLoadMore && (
                <button
                  onClick={() => { const next = limit + PAGE; setLimit(next); load(next) }}
                  disabled={loading}
                  className="w-full py-3 text-xs text-primary hover:bg-primary-light/50 disabled:opacity-40 transition-colors"
                >
                  {t('log.load.more')}
                </button>
              )}

              {limits.historyDays < Infinity && (
                <button
                  onClick={() => openUpgradeSheet(t('log.upgrade.reason'))}
                  className="w-full flex items-center justify-center gap-2 py-3 text-xs text-gold hover:bg-gold-light/60 transition-colors"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {t('log.window.notice', { days: limits.historyDays })}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
