import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useMotionValue, useTransform, animate, type PanInfo } from 'framer-motion'
import { formatDistanceToNow } from 'date-fns'
import { he } from 'date-fns/locale'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import DealCard from '../components/DealCard'
import { SettingsSubHeader, Spinner } from '../components/settings/SettingsUI'
import { usePageView } from '../hooks/usePageView'
import { useNotificationsFeed, type NotificationItem } from '../hooks/useNotificationsFeed'

const DISMISS_THRESHOLD = 90

function SwipeableRow({ id, onDismiss, children }: { id: string; onDismiss: (id: string) => void; children: React.ReactNode }) {
  const x = useMotionValue(0)
  const bgOpacity = useTransform(x, [-140, -40, 0, 40, 140], [1, 0.4, 0, 0.4, 1])
  // Framer suppresses the synthetic click on the drag element itself, but the click
  // still lands on the child row button — so a swipe would both dismiss the row and
  // navigate to whatever it links to. Swallow that one click at the capture phase.
  const draggedRef = useRef(false)

  function handleDragEnd(_e: PointerEvent | MouseEvent | TouchEvent, info: PanInfo) {
    if (Math.abs(info.offset.x) > DISMISS_THRESHOLD) {
      animate(x, info.offset.x > 0 ? 400 : -400, { duration: 0.2, ease: 'easeIn' })
      setTimeout(() => onDismiss(id), 180)
    } else {
      animate(x, 0, { type: 'spring', stiffness: 500, damping: 32 })
    }
  }

  return (
    <div
      className="relative overflow-hidden rounded-card"
      onClickCapture={e => {
        if (!draggedRef.current) return
        draggedRef.current = false
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {/* pointer-events-none is load-bearing, not defensive: this overlay is
          position:absolute and therefore paints above its static sibling below, so
          without it every pointerdown lands here instead of on the draggable row and
          the swipe gesture never starts (opacity:0 does not opt an element out of
          hit-testing). */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center bg-error pointer-events-none"
        style={{ opacity: bgOpacity }}
      >
        <Icon name="delete" size={20} color="#fff" />
      </motion.div>
      <motion.div
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.7}
        style={{ x }}
        onDragStart={() => { draggedRef.current = true }}
        onDragEnd={handleDragEnd}
      >
        {children}
      </motion.div>
    </div>
  )
}

function timeAgo(iso: string): string {
  try {
    return formatDistanceToNow(new Date(iso), { locale: he, addSuffix: true })
  } catch {
    return ''
  }
}

function NotificationRow({ item, onClick }: { item: NotificationItem & { unseen: boolean }; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-right p-4 flex items-center gap-3 transition ${item.unseen ? 'bg-primary-light/40' : 'bg-surface'}`}
    >
      <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ background: item.iconBg }}>
        <Icon name={item.icon} size={19} color={item.iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {item.unseen && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
          <p className={`text-sm truncate ${item.unseen ? 'font-bold text-text' : 'font-semibold text-text2'}`}>{item.title}</p>
        </div>
        <p className="text-xs text-text3 mt-0.5 line-clamp-2">{item.desc}</p>
        <p className="text-[11px] text-text3 mt-1">{timeAgo(item.timestamp)}</p>
      </div>
      {item.path && <Icon name="chevron_left" size={16} color="var(--c-text3)" />}
    </button>
  )
}

/**
 * One chronological feed merging every notification type (see useNotificationsFeed).
 * Not a persisted read/unread log server-side — "seen" and "dismissed" state live in
 * localStorage since most of these categories (expiry/utilization) are computed live
 * from current voucher state, not discrete stored events.
 */
export default function NotificationsPage() {
  usePageView('notifications')
  const navigate = useNavigate()
  const { t } = useT()
  const { items, loading, markAllSeen, dismiss } = useNotificationsFeed()

  // Mark everything visible on this load as seen — captured separately by the hook
  // so the highlight stays stable for the rest of this visit even as this persists.
  useEffect(() => {
    if (loading) return
    const timer = setTimeout(markAllSeen, 1200)
    return () => clearTimeout(timer)
  }, [loading, markAllSeen])

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('notifications.title')} />
      <div className="pb-10">
        {loading ? (
          <div className="flex justify-center py-16"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 px-6">
            <Icon name="notifications" size={48} color="var(--c-border)" />
            <p className="text-text2 font-medium mt-4">{t('notifications.empty')}</p>
          </div>
        ) : (
          <div className="px-4 pt-3 space-y-2">
            {/* The row wrappers deliberately have no `layout` prop: framer-motion's layout
                projection takes over the transforms of everything beneath it each frame,
                which silently cancelled the child row's drag (verified — pointer events
                arrived and touch-action was set, but no transform was ever applied). The
                exit animation still collapses a dismissed row smoothly without it. */}
            <AnimatePresence initial={false}>
              {items.map(item => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 1 }}
                  exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <SwipeableRow id={item.id} onDismiss={dismiss}>
                    {item.type === 'discount' && item.deal ? (
                      <div className={`p-1.5 rounded-card ${item.unseen ? 'bg-primary-light/40' : 'bg-bg'}`}>
                        <DealCard deal={item.deal} />
                      </div>
                    ) : (
                      <div className="bg-surface rounded-card shadow-card overflow-hidden">
                        <NotificationRow item={item} onClick={() => item.path && navigate(item.path)} />
                      </div>
                    )}
                  </SwipeableRow>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  )
}
