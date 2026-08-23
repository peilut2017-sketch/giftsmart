import { useT } from '../../lib/i18n'
import Icon from '../ui/Icon'

// A failed fetch must not masquerade as "no listings" — render a retry instead
function ErrorRetry({ onRetry }: { onRetry: () => void }) {
  const { t } = useT()
  return (
    <div className="text-center py-12 space-y-3">
      <Icon name="wifi_off" size={40} color="var(--c-border)" />
      <p className="font-medium text-text2">{t('market.load.error')}</p>
      <button onClick={onRetry} className="px-5 py-2.5 rounded-2xl bg-primary-light text-primary-dark text-sm font-bold">
        {t('app.retry')}
      </button>
    </div>
  )
}

export default ErrorRetry
