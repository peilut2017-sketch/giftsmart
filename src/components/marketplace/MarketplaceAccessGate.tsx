import { useState } from 'react'
import { useMarketplace } from '../../contexts/MarketplaceContext'
import { useT } from '../../lib/i18n'
import Icon from '../ui/Icon'
import Button from '../ui/Button'
import toast from 'react-hot-toast'

// ─── Access Request Screen ─────────────────────────────────────────────────────
function MarketplaceAccessGate() {
  const { myAccessStatus, requestMarketplaceAccess } = useMarketplace()
  const { t } = useT()
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  async function handleRequest() {
    setSending(true)
    try {
      await requestMarketplaceAccess(message.trim() || undefined)
      toast.success(t('market.access.sent'))
    } catch {
      toast.error(t('market.access.error'))
    } finally {
      setSending(false)
    }
  }

  if (myAccessStatus === 'pending') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 bg-warning/10 rounded-2xl flex items-center justify-center mb-4">
          <Icon name="shopping_bag" size={32} color="var(--c-warning)" />
        </div>
        <h2 className="text-lg font-bold text-text mb-2">{t('market.access.pending.title')}</h2>
        <p className="text-sm text-text3 max-w-xs">{t('market.access.pending.body')}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-primary-light rounded-2xl flex items-center justify-center mb-4">
        <Icon name="shopping_bag" size={32} color="var(--c-primary)" />
      </div>
      <h2 className="text-lg font-bold text-text mb-1">{t('market.title')}</h2>
      {myAccessStatus === 'rejected' && (
        <p className="text-sm text-error mb-3">{t('market.access.rejected')}</p>
      )}
      <p className="text-sm text-text3 mb-6 max-w-xs">
        {t('market.access.desc')}
      </p>
      <textarea
        value={message}
        onChange={e => setMessage(e.target.value)}
        placeholder={t('market.access.message.placeholder')}
        rows={3}
        className="w-full max-w-xs border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text mb-4 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
      />
      <Button onClick={handleRequest} loading={sending}>
        <Icon name="add" size={16} />
        {t('market.access.request')}
      </Button>
    </div>
  )
}

export default MarketplaceAccessGate
