import { useState } from 'react'
import { useMarketplace } from '../../contexts/MarketplaceContext'
import { useT } from '../../lib/i18n'
import Button from '../ui/Button'
import BottomSheet from '../ui/BottomSheet'
import toast from 'react-hot-toast'

// ─── Report Modal ─────────────────────────────────────────────────────────────
function ReportModal({
  reportedUserId, reportedName, purchaseId, listingId, onClose,
}: {
  reportedUserId: string
  reportedName: string
  purchaseId?: string
  listingId?: string
  onClose: () => void
}) {
  const { reportUser } = useMarketplace()
  const { t } = useT()
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [saving, setSaving] = useState(false)

  const reasons = [
    t('market.report.reason.payment'),
    t('market.report.reason.invalid'),
    t('market.report.reason.fraud'),
    t('market.report.reason.abusive'),
    t('market.report.reason.false'),
    t('market.report.reason.other'),
  ]

  async function submit() {
    if (!reason) { toast.error(t('market.report.choose')); return }
    setSaving(true)
    try {
      await reportUser(reportedUserId, reason, details || undefined, purchaseId, listingId)
      toast.success(t('market.report.sent'))
      onClose()
    } catch {
      toast.error(t('market.report.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('market.report.title')}
      footer={
        <Button onClick={submit} disabled={saving || !reason} loading={saving} variant="danger" fullWidth>
          {t('market.report.submit')}
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-text3">{t('market.report.on')}: {reportedName}</p>
        <div className="space-y-2">
          {reasons.map(r => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className={`w-full text-right px-4 py-2.5 rounded-xl border text-sm transition-colors ${
                reason === r ? 'border-error bg-error/10 text-error font-medium' : 'border-border text-text2'
              }`}
            >
              {r}
            </button>
          ))}
        </div>
        <textarea
          className="w-full border border-border rounded-xl p-3 text-sm bg-surface text-text resize-none h-20 focus:outline-none focus:ring-2 focus:ring-error/30"
          placeholder={t('market.report.details.placeholder')}
          value={details}
          onChange={e => setDetails(e.target.value)}
        />
      </div>
    </BottomSheet>
  )
}

export default ReportModal
