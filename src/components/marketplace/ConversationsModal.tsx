import { useState, useEffect } from 'react'
import { useMarketplace } from '../../contexts/MarketplaceContext'
import { useT } from '../../lib/i18n'
import type { MarketplaceListing, ListingConversation } from '../../types'
import Icon from '../ui/Icon'
import BottomSheet from '../ui/BottomSheet'
import toast from 'react-hot-toast'

// ─── Conversations list modal (seller picks which buyer to chat with) ─────────
function ConversationsModal({
  listing,
  onSelectConversation,
  onClose,
}: {
  listing: MarketplaceListing
  onSelectConversation: (buyerId: string, buyerName: string) => void
  onClose: () => void
}) {
  const { getListingConversations } = useMarketplace()
  const { t } = useT()
  const [convs, setConvs] = useState<ListingConversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getListingConversations(listing.id)
      .then(data => {
        setConvs(data)
        // If exactly one conversation, jump straight to it
        if (data.length === 1) {
          onSelectConversation(
            data[0].other_user_id,
            data[0].other_user_name || data[0].other_user_email || t('market.buyer'),
          )
        }
      })
      .catch(() => toast.error(t('market.convs.load.error')))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <BottomSheet open onClose={onClose} title={t('market.convs.title')}>
      <p className="text-xs text-text3 -mt-2 mb-3">{listing.store_name}</p>
      <div className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-10">
            <Icon name="progress_activity" size={24} color="var(--c-primary)" className="animate-spin" />
          </div>
        ) : convs.length === 0 ? (
          <div className="text-center py-10 text-text3 space-y-2">
            <Icon name="chat" size={40} color="var(--c-border)" />
            <p className="text-sm">{t('market.convs.empty')}</p>
          </div>
        ) : (
          convs.map(c => {
            const hasUnread = (c.unread_count ?? 0) > 0
            return (
              <button
                key={c.other_user_id}
                onClick={() => onSelectConversation(
                  c.other_user_id,
                  c.other_user_name || c.other_user_email || t('market.buyer'),
                )}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-right ${
                  hasUnread ? 'border-primary/40 bg-primary-light' : 'border-border'
                }`}
              >
                <div className="relative shrink-0">
                  <div className="w-9 h-9 bg-gradient-to-br from-primary-mid to-primary-dark rounded-full flex items-center justify-center text-white font-bold text-sm">
                    {(c.other_user_name || c.other_user_email || '?')[0].toUpperCase()}
                  </div>
                  {hasUnread && (
                    <span className="absolute -top-1 -right-1 min-w-[16px] h-4 bg-error text-white text-[10px] font-bold rounded-full flex items-center justify-center px-0.5">
                      {(c.unread_count ?? 0) > 9 ? '9+' : c.unread_count}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm truncate ${hasUnread ? 'font-bold text-text' : 'font-medium text-text'}`}>
                    {c.other_user_name || c.other_user_email}
                  </p>
                  <p className={`text-xs truncate ${hasUnread ? 'text-text2 font-medium' : 'text-text3'}`}>
                    {c.last_body}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs text-text3">{c.message_count} {t('market.messages')}</span>
                  <Icon name="chevron_left" size={16} color="var(--c-border)" />
                </div>
              </button>
            )
          })
        )}
      </div>
    </BottomSheet>
  )
}

export default ConversationsModal
