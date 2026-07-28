import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useDiscounts } from '../contexts/DiscountsContext'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import DealCard from '../components/DealCard'
import { SettingsSubHeader, SL, Card, Spinner } from '../components/settings/SettingsUI'
import { getExpiryStatus, getExpiryLabel, formatCurrency, formatDate } from '../utils/helpers'
import { usePageView } from '../hooks/usePageView'

// A utilization alert fires once a voucher has this little of its face value left —
// low enough to be worth flagging as "almost fully used," not just routine spending.
const LOW_BALANCE_THRESHOLD = 0.15

interface SystemMessage { id: string; title: string; body: string; created_at: string }
interface SupportReply { id: string; subject: string; admin_reply: string; replied_at: string }

/**
 * A live-computed notification feed, not a persisted read/unread log — there's no
 * backend event table for most of these categories (expiry/utilization are derived
 * from current voucher state, same as the badges already shown elsewhere in the app).
 * System messages (push_broadcasts + admin_broadcasts) and support replies are real
 * rows, discounts reuse DiscountsContext's existing "my clubs" filter.
 */
export default function NotificationsPage() {
  usePageView('notifications')
  const navigate = useNavigate()
  const { t } = useT()
  const { user } = useAuth()
  const { vouchers } = useVouchers()
  const { deals, fetchDeals } = useDiscounts()

  const [systemMessages, setSystemMessages] = useState<SystemMessage[]>([])
  const [supportReplies, setSupportReplies] = useState<SupportReply[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    fetchDeals(undefined, undefined, true) // myOnly — only clubs the user follows

    async function load() {
      const [pushRes, broadcastRes, supportRes] = await Promise.all([
        supabase.from('push_broadcasts').select('id, title, body, created_at').order('created_at', { ascending: false }).limit(15),
        supabase.from('admin_broadcasts').select('id, subject, body, created_at').order('created_at', { ascending: false }).limit(15),
        supabase.from('support_messages').select('id, subject, admin_reply, replied_at').eq('user_id', user!.id).not('admin_reply', 'is', null).order('replied_at', { ascending: false }).limit(15),
      ])
      const push = (pushRes.data || []).map((p: any) => ({ id: `push-${p.id}`, title: p.title, body: p.body, created_at: p.created_at }))
      const broadcasts = (broadcastRes.data || []).map((b: any) => ({ id: `bc-${b.id}`, title: b.subject, body: b.body, created_at: b.created_at }))
      setSystemMessages(
        [...push, ...broadcasts]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 15)
      )
      setSupportReplies((supportRes.data || []) as SupportReply[])
      setLoading(false)
    }
    load()
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps

  const utilizationAlerts = useMemo(
    () => vouchers
      .filter(v => v.amount > 0 && v.balance > 0 && v.balance / v.amount <= LOW_BALANCE_THRESHOLD)
      .sort((a, b) => a.balance / a.amount - b.balance / b.amount),
    [vouchers]
  )

  const expiryAlerts = useMemo(
    () => vouchers
      .filter(v => v.expiry_date && ['expired', 'critical', 'warning'].includes(getExpiryStatus(v.expiry_date)))
      .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime()),
    [vouchers]
  )

  const followedClubDeals = useMemo(() => deals.filter(d => d.is_my_club).slice(0, 10), [deals])

  const hasAnything =
    systemMessages.length > 0 || utilizationAlerts.length > 0 || expiryAlerts.length > 0 ||
    followedClubDeals.length > 0 || supportReplies.length > 0

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('notifications.title')} />
      <div className="pb-10">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : !hasAnything ? (
          <div className="text-center py-20 px-6">
            <Icon name="notifications" size={48} color="var(--c-border)" />
            <p className="text-text2 font-medium mt-4">{t('notifications.empty')}</p>
          </div>
        ) : (
          <>
            {systemMessages.length > 0 && (
              <>
                <SL>{t('notifications.system')}</SL>
                <div className="px-4">
                  <Card>
                    {systemMessages.map(m => (
                      <div key={m.id} className="p-4 border-b border-border last:border-0 flex gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                          <Icon name="notifications_active" size={18} color="#3b82f6" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text">{m.title}</p>
                          <p className="text-xs text-text2 mt-0.5">{m.body}</p>
                          <p className="text-[11px] text-text3 mt-1">{formatDate(m.created_at)}</p>
                        </div>
                      </div>
                    ))}
                  </Card>
                </div>
              </>
            )}

            {expiryAlerts.length > 0 && (
              <>
                <SL>{t('notifications.expiry')}</SL>
                <div className="px-4">
                  <Card>
                    {expiryAlerts.map(v => (
                      <button key={v.id} onClick={() => navigate(`/checkout/${v.id}`)} className="w-full text-right p-4 border-b border-border last:border-0 flex items-center gap-3 hover:bg-bg transition">
                        <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center shrink-0">
                          <Icon name="event_busy" size={18} color="var(--c-error)" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text truncate">{v.store_name}</p>
                          <p className="text-xs text-error mt-0.5 font-medium">{getExpiryLabel(v.expiry_date)}</p>
                        </div>
                        <Icon name="chevron_left" size={16} color="var(--c-text3)" />
                      </button>
                    ))}
                  </Card>
                </div>
              </>
            )}

            {utilizationAlerts.length > 0 && (
              <>
                <SL>{t('notifications.utilization')}</SL>
                <div className="px-4">
                  <Card>
                    {utilizationAlerts.map(v => {
                      const pct = Math.round((v.balance / v.amount) * 100)
                      return (
                        <button key={v.id} onClick={() => navigate(`/checkout/${v.id}`)} className="w-full text-right p-4 border-b border-border last:border-0 flex items-center gap-3 hover:bg-bg transition">
                          <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center shrink-0">
                            <Icon name="bolt" size={18} color="var(--c-warning)" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text truncate">{v.store_name}</p>
                            <p className="text-xs text-text2 mt-0.5">{t('notifications.utilization.desc', { pct, balance: formatCurrency(v.balance) })}</p>
                          </div>
                          <Icon name="chevron_left" size={16} color="var(--c-text3)" />
                        </button>
                      )
                    })}
                  </Card>
                </div>
              </>
            )}

            {followedClubDeals.length > 0 && (
              <>
                <SL>{t('notifications.discounts')}</SL>
                <div className="px-4 space-y-2">
                  {followedClubDeals.map(deal => <DealCard key={deal.deal_id} deal={deal} />)}
                </div>
              </>
            )}

            {supportReplies.length > 0 && (
              <>
                <SL>{t('notifications.support')}</SL>
                <div className="px-4">
                  <Card>
                    {supportReplies.map(m => (
                      <button key={m.id} onClick={() => navigate('/settings/about')} className="w-full text-right p-4 border-b border-border last:border-0 flex items-center gap-3 hover:bg-bg transition">
                        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                          <Icon name="chat" size={18} color="var(--c-primary)" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-text truncate">{m.subject}</p>
                          <p className="text-xs text-text2 mt-0.5 line-clamp-2">{m.admin_reply}</p>
                        </div>
                        <Icon name="chevron_left" size={16} color="var(--c-text3)" />
                      </button>
                    ))}
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
