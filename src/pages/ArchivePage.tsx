import { useState, useMemo } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatDate, getStoreInitials } from '../utils/helpers'
import Icon from '../components/ui/Icon'
import toast from 'react-hot-toast'
import ConfirmDialog from '../components/ConfirmDialog'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { useT } from '../lib/i18n'
import { usePageView } from '../hooks/usePageView'
import { useUndoableDelete } from '../hooks/useUndoableDelete'

type SortKey = 'added' | 'store' | 'balance' | 'expiry'

export default function ArchivePage() {
  const navigate = useNavigate()
  const { archivedVouchers, unarchiveVoucher, deleteVoucher, loading } = useVouchers()
  const { isVaultUnlocked, decryptedMap } = useE2EE()
  const { t } = useT()
  usePageView('archive')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [showSort, setShowSort] = useState(false)
  const [restoringIds, setRestoringIds] = useState<Set<string>>(new Set())

  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Shared undo-delete: completes even if the user navigates away mid-countdown
  const { hiddenIds, requestDelete: scheduleDelete } = useUndoableDelete(deleteVoucher, {
    message: t('archive.deleted'),
    undo: t('archive.undo'),
    failed: t('app.error'),
  })

  const sortedFiltered = useMemo(() => {
    const q = search.toLowerCase()
    const result = archivedVouchers.filter(v => {
      if (hiddenIds.has(v.id)) return false
      if (!q) return true
      // Search the DECRYPTED code for E2EE vouchers (matching SearchPage) — matching
      // raw ciphertext both missed real matches and could match base64 noise.
      const codeText = isEncryptedField(v.code)
        ? (isVaultUnlocked ? decryptedMap.get(v.id)?.code ?? '' : '')
        : v.code
      return v.store_name.toLowerCase().includes(q) || codeText.toLowerCase().includes(q)
    })
    switch (sortKey) {
      case 'store': result.sort((a, b) => a.store_name.localeCompare(b.store_name, 'he')); break
      case 'balance': result.sort((a, b) => b.balance - a.balance); break
      case 'expiry':
        result.sort((a, b) => {
          if (!a.expiry_date) return 1
          if (!b.expiry_date) return -1
          return new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
        })
        break
      default:
        result.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    }
    return result
  }, [archivedVouchers, search, sortKey, hiddenIds, isVaultUnlocked, decryptedMap])

  function requestDelete(id: string) {
    setConfirm({
      title: t('archive.delete.confirm.title'),
      message: t('archive.delete.confirm.msg'),
      onConfirm: () => { setConfirm(null); scheduleDelete(id) },
    })
  }

  async function handleRestore(id: string) {
    if (restoringIds.has(id)) return
    setRestoringIds(prev => new Set(prev).add(id))
    try {
      await unarchiveVoucher(id)
      toast.success(t('archive.restored'))
    } catch {
      toast.error(t('app.error'))
    } finally {
      setRestoringIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  const sortLabels: Record<SortKey, string> = {
    added: t('archive.sort.added'),
    store: t('archive.sort.store'),
    balance: t('archive.sort.balance'),
    expiry: t('archive.sort.expiry'),
  }

  return (
    <div className="flex-1 bg-bg">
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message} danger onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}

      {/* Header */}
      <div className="bg-surface border-b border-border sticky top-0 z-20 px-5 pt-5 pb-4">
        <div className="flex items-center gap-2 mb-1">
          <div className="flex-1">
            <div className="text-[22px] font-extrabold text-text">{t('nav.archive')}</div>
            <div className="text-[13px] text-text3 mt-0.5">{t('archive.subtitle')}</div>
          </div>
          <button
            onClick={() => setShowSort(!showSort)}
            aria-expanded={showSort}
            className={`flex items-center gap-1 text-xs px-3 py-2 rounded-full font-medium ${showSort ? 'bg-primary-light text-primary' : 'bg-bg text-text3'}`}
          >
            <Icon name="tune" size={14} /> {sortLabels[sortKey]}
          </button>
        </div>

        {showSort && (
          <div className="flex flex-wrap gap-2 mb-3">
            {(Object.keys(sortLabels) as SortKey[]).map(key => (
              <button
                key={key}
                onClick={() => { setSortKey(key); setShowSort(false) }}
                aria-pressed={sortKey === key}
                className={`text-xs px-3 py-2 rounded-full font-medium border ${sortKey === key ? 'bg-primary-light text-primary border-primary' : 'bg-bg text-text3 border-transparent'}`}
              >
                {sortLabels[key]}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 bg-bg rounded-full px-3.5 mt-3">
          <Icon name="archive" size={16} color="var(--c-text3)" />
          <input
            type="search" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t('archive.search.placeholder')}
            className="flex-1 h-10 bg-transparent border-none outline-none text-base text-text"
          />
        </div>
      </div>

      <div className="p-4 pb-8">
        {loading ? (
          <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 gs-skeleton rounded-card" />)}</div>
        ) : sortedFiltered.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="inventory_2" size={56} color="var(--c-border)" />
            <p className="text-text2 mt-3">{search ? t('archive.empty.search') : t('archive.empty')}</p>
            {!search && (
              <button
                onClick={() => navigate('/search')}
                className="mt-4 px-5 py-2.5 rounded-2xl bg-primary-light text-primary-dark text-sm font-bold"
              >
                {t('archive.empty.cta')}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFiltered.map(v => (
              <div
                key={v.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/checkout/${v.id}`)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/checkout/${v.id}`) } }}
                className="flex overflow-hidden rounded-card shadow-card bg-surface opacity-80 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              >
                <div className="w-1.5 flex-shrink-0 bg-text3" />
                <div className="flex items-center flex-1 gap-3 py-3 pe-2.5 ps-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-bg text-text3 font-extrabold">
                    {getStoreInitials(v.store_name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold text-text2 truncate">{v.store_name}</div>
                    {(() => {
                      const isE2EE = isEncryptedField(v.code)
                      const decrypted = decryptedMap.get(v.id)
                      if (isE2EE && !isVaultUnlocked) return null
                      const displayCode = isE2EE && decrypted ? decrypted.code : v.code
                      return <div className="text-[11px] text-text3 font-mono mt-0.5">{displayCode}</div>
                    })()}
                    {v.archive_reason && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-text3/10 text-text2 px-2 py-0.5 rounded-full mt-1">
                        {t('archive.reason.label')} {v.archive_reason}
                      </span>
                    )}
                    {v.expiry_date && <div className="text-[11px] text-text3 mt-0.5">{t('archive.expiry.prefix')}: {formatDate(v.expiry_date)}</div>}
                  </div>
                  <div className="flex items-center gap-2.5 flex-shrink-0">
                    <div className="text-sm font-bold text-text3">{formatCurrency(v.balance)}</div>
                    <button
                      onClick={e => { e.stopPropagation(); handleRestore(v.id) }}
                      disabled={restoringIds.has(v.id)}
                      className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center disabled:opacity-50"
                      aria-label={t('archive.restore')}
                      title={t('archive.restore')}
                    >
                      <Icon name={restoringIds.has(v.id) ? 'progress_activity' : 'restore_from_trash'} size={18} className={restoringIds.has(v.id) ? 'animate-spin' : undefined} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); requestDelete(v.id) }}
                      className="w-11 h-11 rounded-xl bg-error/10 text-error flex items-center justify-center"
                      aria-label={t('app.delete')}
                      title={t('app.delete')}
                    >
                      <Icon name="delete" size={18} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
