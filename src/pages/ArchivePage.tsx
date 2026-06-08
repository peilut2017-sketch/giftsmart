import { useState, useMemo, useRef } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatDate } from '../utils/helpers'
import { RotateCcw, Trash2, Archive, SlidersHorizontal, Package } from 'lucide-react'
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

  // Undo delete
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const sortedFiltered = useMemo(() => {
    let result = archivedVouchers.filter(v =>
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
      default: // archived — most recently archived first
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
            className="underline font-semibold text-blue-600 mr-1"
          >
            {t('archive.undo')}
          </button>
        </span>
      ),
      { duration: 5000 }
    )
  }

  const sortLabels: Record<SortKey, string> = {
    added: 'חדש→ישן',
    store: 'חנות א-ב',
    balance: '₪ יתרה',
    expiry: 'תפוגה',
  }

  return (
    <div className="flex-1" style={{ background: 'var(--c-bg)' }}>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {/* Header */}
      <div style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)', padding: '20px 20px 16px', position: 'sticky', top: 0, zIndex: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--c-text)' }}>ארכיון</div>
            <div style={{ fontSize: 13, color: 'var(--c-text3)', marginTop: 2 }}>שוברים שמומשו או פגו</div>
          </div>
          <button
            onClick={() => setShowSort(!showSort)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
              padding: '6px 12px', borderRadius: 999, fontWeight: 500,
              background: showSort ? 'var(--c-primary-light)' : 'var(--c-bg)',
              color: showSort ? 'var(--c-primary)' : 'var(--c-text3)',
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            {sortLabels[sortKey]}
          </button>
        </div>

        {showSort && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {(Object.keys(sortLabels) as SortKey[]).map(key => (
              <button
                key={key}
                onClick={() => { setSortKey(key); setShowSort(false) }}
                style={{
                  fontSize: 12, padding: '6px 12px', borderRadius: 999, fontWeight: 500,
                  background: sortKey === key ? 'var(--c-primary-light)' : 'var(--c-bg)',
                  color: sortKey === key ? 'var(--c-primary)' : 'var(--c-text3)',
                  border: sortKey === key ? '1px solid var(--c-primary)' : '1px solid transparent',
                  cursor: 'pointer', transition: 'all 0.15s',
                }}
              >
                {sortLabels[key]}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--c-bg)', borderRadius: 999, padding: '8px 14px', marginTop: 12 }}>
          <Archive style={{ width: 16, height: 16, color: 'var(--c-text3)', flexShrink: 0 }} />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="חיפוש בארכיון..."
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', fontSize: 15, color: 'var(--c-text)' }}
          />
        </div>
      </div>

      <div className="p-4 pb-24">
        {sortedFiltered.length === 0 ? (
          <div className="text-center py-16">
            <Package className="w-14 h-14 mx-auto mb-3" style={{ color: 'var(--c-border)' }} />
            <p className="text-gray-500">{search ? 'לא נמצאו שוברים' : 'הארכיון ריק'}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedFiltered.map(v => (
              <div
                key={v.id}
                onClick={() => navigate(`/checkout/${v.id}`)}
                style={{ display: 'flex', overflow: 'hidden', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', background: 'var(--c-surface)', opacity: 0.75, cursor: 'pointer' }}
              >
                {/* Left color strip */}
                <div style={{ width: 5, background: '#9ca3af', flexShrink: 0 }} />
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, padding: '12px 12px 12px 10px', gap: 12 }}>
                  {/* Store initial avatar */}
                  <div style={{ width: 40, height: 40, background: '#f3f4f6', color: '#9ca3af', fontSize: 16, fontWeight: 800, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {v.store_name.charAt(0)}
                  </div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.store_name}</div>
                    {(() => {
                      const isE2EE = isEncryptedField(v.code)
                      const decrypted = decryptedMap.get(v.id)
                      if (isE2EE && !isVaultUnlocked) return null
                      const displayCode = isE2EE && decrypted ? decrypted.code : v.code
                      return <div style={{ fontSize: 11, color: 'var(--c-text3)', fontFamily: 'monospace', marginTop: 2 }}>{displayCode}</div>
                    })()}
                    {v.archive_reason && (
                      <div style={{ marginTop: 4 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, background: 'rgba(107,114,128,0.1)', color: 'var(--c-text2)', padding: '2px 8px', borderRadius: 999 }}>
                          {t('archive.reason.label')} {v.archive_reason}
                        </span>
                      </div>
                    )}
                    {v.expiry_date && (
                      <div style={{ fontSize: 11, color: 'var(--c-text3)', marginTop: 2 }}>תוקף: {formatDate(v.expiry_date)}</div>
                    )}
                  </div>
                  {/* Balance + actions */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text3)' }}>{formatCurrency(v.balance)}</div>
                    <button
                      onClick={e => { e.stopPropagation(); unarchiveVoucher(v.id).then(() => toast.success('הוחזר לארנק')) }}
                      style={{ padding: 8, borderRadius: 10, background: 'rgba(34,197,94,0.1)', color: '#16a34a', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="החזר לארנק"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); requestDelete(v.id) }}
                      style={{ padding: 8, borderRadius: 10, background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      title="מחיקה"
                    >
                      <Trash2 className="w-4 h-4" />
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
