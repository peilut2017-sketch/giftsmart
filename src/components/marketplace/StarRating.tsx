import { useT } from '../../lib/i18n'
import Icon from '../ui/Icon'

// ─── Rating Stars ────────────────────────────────────────────────────────────
function StarRating({ value, max = 5, onChange }: { value: number; max?: number; onChange?: (v: number) => void }) {
  const { t } = useT()
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <button
          key={i}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(i + 1)}
          className={`${onChange ? 'cursor-pointer' : 'cursor-default'} focus:outline-none`}
          aria-label={`${i + 1} ${t('market.stars')}`}
        >
          <Icon name="star" size={20} filled={i < value} color={i < value ? '#facc15' : 'var(--c-border)'} />
        </button>
      ))}
    </div>
  )
}

export default StarRating
