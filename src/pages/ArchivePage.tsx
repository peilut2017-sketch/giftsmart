import { useState, useMemo, useRef } from 'react'
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

type SortKey = 'added' | 'store' | 'balance' | 'expiry'

export default function ArchivePage() {
  const navigate = useNavigate()
  const { archivedVouchers, unarchiveVoucher, deleteVoucher } = useVouchers()
  const { isVaultUnlocked, decryptedMap } = useE2EE()
  const { t } = useT()
  usePageView('archive')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('added')
  const [showSort, setShowSort] = useState(false)

  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const sortedFiltered = useMemo(() => {
    const result = archivedVouchers.filter(v =>
      !hiddenIds.has(v.id) && (
        v.store_name.toLowerCase().includes(search.toLowerCase()) ||
        v.code.toLowerCase().includes(search.toLowerCase())
      )
    )
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
  }, [archivedVouchers, search, sortKey, hiddenIds])

  function requestDelete(id: string) {
    setConfirm({
      title: t('archive.delete.confirm.title'),
      message: t('archive.delete.confirm.msg'),
      onConfirm: () => { setConfirm(null); handleDelete(id) },
    })
  }

  async function handleDelete(id: string) {
    setHiddenIds(prev => new Set([...prev, id]))
    const timer = setTimeout(async () => {
      await deleteVoucher(id)
      setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
      pendingDeletesRef.current.delete(id)
    }, 5000)
    pendingDeletesRef.current.set(id, timer)

    toast(
      (toastRef) => (
        <span>
          {t('archive.deleted')}{' '}
          <button
            onClick={() => {
              clearTimeout(pendingDeletesRef.current.get(id))
              pendingDeletesRef.current.delete(id)
              setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              toast.dismiss(toastRef.id)
            }}
            className="underline font-semibold text-primary mr-1"
          >
            {t('archive.undo')}
          </button>
        </span>
      ),
      { duration: 5000 }
    )
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
            className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium ${showSort ? 'bg-primary-light text-primary' : 'bg-bg text-text3'}`}
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
                className={`text-xs px-3 py-1.5 rounded-full font-medium border ${sortKey === key ? 'bg-primary-light text-primary border-primary' : 'bg-bg text-text3 border-transparent'}`}
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
            className="flex-1 h-10 bg-transparent border-none outline-none text-[15px] text-text"
          />
        </div>
      </div>

      <div className="p-4 pb-28">
        {sortedFiltered.length === 0 ? (
          <div className="text-center py-16">
            <Icon name="inventory_2" size={56} color="var(--c-border)" />
            <p className="text-text2 mt-3">{search ? t('archive.empty.search') : t('archive.empty')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFiltered.map(v => (
              <div key={v.id} onClick={() => navigate(`/checkout/${v.id}`)} className="flex overflow-hidden rounded-card shadow-card bg-surface opacity-75 cursor-pointer">
                <div className="w-1.5 flex-shrink-0 bg-text3" />
                <div className="flex items-center flex-1 gap-3 py-3 pr-2.5 pl-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-bg text-text3 font-extrabold" style={{ filter: 'grayscale(0.35)' }}>
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
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <div className="text-sm font-bold text-text3">{formatCurrency(v.balance)}</div>
                    <button
                      onClick={e => { e.stopPropagation(); unarchiveVoucher(v.id).then(() => toast.success(t('archive.restored'))) }}
                      className="p-2 rounded-xl bg-primary/10 text-primary flex items-center justify-center"
                      title={t('archive.restore')}
                    >
                      <Icon name="restore_from_trash" size={16} />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); requestDelete(v.id) }}
                      className="p-2 rounded-xl bg-error/10 text-error flex items-center justify-center"
                      title={t('app.delete')}
                    >
                      <Icon name="delete" size={16} />
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
