import { useState } from 'react'
import { useMarketplace } from '../../contexts/MarketplaceContext'
import { useT } from '../../lib/i18n'
import type { MarketplacePurchase } from '../../types'
import Button from '../ui/Button'
import BottomSheet from '../ui/BottomSheet'
import toast from 'react-hot-toast'
import StarRating from './StarRating'

// ─── Rate Modal ───────────────────────────────────────────────────────────────
function RateModal({ purchase, onClose }: { purchase: MarketplacePurchase; onClose: () => void }) {
  const { rateUser } = useMarketplace()
  const { t } = useT()
  const [rating, setRating] = useState(purchase.my_rating ?? 0)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (rating === 0) { toast.error(t('market.rate.choose')); return }
    setSaving(true)
    try {
      await rateUser(purchase.purchase_id, purchase.seller_id!, rating, comment || undefined)
      toast.success(t('market.rate.saved'))
      onClose()
    } catch {
      toast.error(t('market.rate.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('market.rate.seller')}
      footer={
        <Button onClick={submit} disabled={saving || rating === 0} loading={saving} fullWidth>
          {t('market.rate.save')}
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text3">
          {purchase.seller_name || purchase.seller_email} · {purchase.store_name}
        </p>
        <StarRating value={rating} onChange={setRating} />
        <textarea
          className="w-full border border-border rounded-xl p-3 text-sm bg-surface text-text resize-none h-24 focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder={t('market.rate.comment.placeholder')}
          value={comment}
          onChange={e => setComment(e.target.value)}
        />
      </div>
    </BottomSheet>
  )
}

export default RateModal
