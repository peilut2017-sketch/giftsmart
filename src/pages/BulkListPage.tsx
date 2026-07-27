import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import type { Voucher } from '../types'
import toast from 'react-hot-toast'

interface VoucherEntry {
  voucher: Voucher
  selected: boolean
  price: string
  description: string
}

export default function BulkListPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile } = useAuth()
  const { vouchers } = useVouchers()
  const { listForSale } = useMarketplace()
  const { t } = useT()

  const listable = vouchers.filter(v => !v.is_archived && !v.is_locked && v.balance > 0)

  const preselectedIds = new Set<string>(
    (location.state as { voucherIds?: string[] } | null)?.voucherIds ?? []
  )

  const [entries, setEntries] = useState<VoucherEntry[]>(
    listable.map(v => ({ voucher: v, selected: preselectedIds.has(v.id), price: '', description: '' }))
  )
  const [submitting, setSubmitting] = useState(false)
  const [results, setResults] = useState<{ id: string; store: string; ok: boolean; error?: string }[]>([])
  const [done, setDone] = useState(false)

  const hasPaymentMethod = (profile?.marketplace_payment_methods?.length ?? 0) > 0
  const selected = entries.filter(e => e.selected)

  function toggleAll() {
    const allSelected = entries.every(e => e.selected)
    setEntries(prev => prev.map(e => ({ ...e, selected: !allSelected })))
  }

  function toggle(id: string) {
    setEntries(prev => prev.map(e => e.voucher.id === id ? { ...e, selected: !e.selected } : e))
  }

  function setPrice(id: string, value: string) {
    setEntries(prev => prev.map(e => e.voucher.id === id ? { ...e, price: value } : e))
  }

  function setDescription(id: string, value: string) {
    setEntries(prev => prev.map(e => e.voucher.id === id ? { ...e, description: value } : e))
  }

  async function submit() {
    if (selected.length === 0) { toast.error(t('bulk.select.required')); return }
    const invalid = selected.filter(e => !e.price || parseFloat(e.price) <= 0)
    if (invalid.length > 0) { toast.error(t('bulk.price.required')); return }
    if (!hasPaymentMethod) {
      toast.error(t('bulk.payment.required'))
      navigate('/settings')
      return
    }

    setSubmitting(true)
    const res: typeof results = []
    for (const entry of selected) {
      try {
        await listForSale(entry.voucher.id, parseFloat(entry.price), entry.description || undefined)
        res.push({ id: entry.voucher.id, store: entry.voucher.store_name, ok: true })
      } catch (e: unknown) {
        res.push({ id: entry.voucher.id, store: entry.voucher.store_name, ok: false, error: (e as Error)?.message })
      }
    }
    setResults(res)
    setDone(true)
    setSubmitting(false)
    const okCount = res.filter(r => r.ok).length
    if (okCount > 0) toast.success(`${okCount} ${t('bulk.published.success')}`)
  }

  if (done) {
    return (
      <div className="flex-1 bg-bg" dir="rtl">
        <div className="bg-surface border-b border-border sticky top-0 z-20">
          <div className="flex items-center gap-3 px-4 py-3">
            <button onClick={() => navigate('/market')} className="p-2 rounded-full bg-bg text-text2">
              <Icon name="arrow_forward" size={20} />
            </button>
            <h1 className="font-bold text-lg flex-1 text-text">{t('bulk.results.title')}</h1>
          </div>
        </div>
        <div className="p-4 space-y-3">
          {results.map(r => (
            <div key={r.id} className={`flex items-center gap-3 p-4 rounded-2xl border ${r.ok ? 'bg-primary-light border-primary/20' : 'bg-error/10 border-error/30'}`}>
              <Icon name={r.ok ? 'shopping_bag' : 'error'} size={20} color={r.ok ? 'var(--c-primary)' : 'var(--c-error)'} className="shrink-0" />
              <div>
                <p className="font-medium text-text">{r.store}</p>
                <p className="text-xs text-text3">{r.ok ? t('bulk.result.ok') : r.error || t('bulk.result.error')}</p>
              </div>
            </div>
          ))}
          <Button onClick={() => navigate('/market/mine')} fullWidth className="mt-2">
            {t('bulk.view.my.listings')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 bg-bg" dir="rtl">
      <div className="bg-surface border-b border-border sticky top-0 z-20">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-bg text-text2">
            <Icon name="arrow_forward" size={20} />
          </button>
          <h1 className="font-bold text-lg flex-1 text-text">{t('bulk.title')}</h1>
          <span className="text-sm text-text3">{selected.length} {t('bulk.selected')}</span>
        </div>
      </div>

      {!hasPaymentMethod && (
        <div className="mx-4 mt-4 bg-warning/10 border border-warning/30 rounded-2xl p-4 flex items-start gap-3">
          <Icon name="error" size={20} color="var(--c-warning)" className="shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-warning">{t('bulk.no.payment.title')}</p>
            <p className="text-xs text-warning mt-0.5">{t('bulk.no.payment.body')}</p>
            <button onClick={() => navigate('/settings')} className="text-xs text-warning font-semibold underline mt-1">
              {t('bulk.go.settings')}
            </button>
          </div>
        </div>
      )}

      <div className="p-4 pb-32 space-y-3">
        {listable.length === 0 ? (
          <div className="text-center py-12 text-text3 space-y-2">
            <Icon name="shopping_bag" size={40} color="var(--c-border)" />
            <p className="font-medium">{t('bulk.no.vouchers')}</p>
            <p className="text-sm">{t('bulk.no.vouchers.hint')}</p>
          </div>
        ) : (
          <>
            {/* Select all bar */}
            <button
              onClick={toggleAll}
              className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface rounded-card border border-border shadow-card text-sm font-medium text-text2"
            >
              <Icon name={entries.every(e => e.selected) ? 'check_box' : 'check_box_outline_blank'} size={18} color={entries.every(e => e.selected) ? 'var(--c-primary)' : 'var(--c-text3)'} />
              {entries.every(e => e.selected) ? t('bulk.deselect.all') : t('bulk.select.all')}
            </button>

            {entries.map(entry => {
              const v = entry.voucher
              return (
                <div
                  key={v.id}
                  className={`bg-surface rounded-card border shadow-card p-4 space-y-3 transition-colors ${
                    entry.selected ? 'border-primary/40' : 'border-border'
                  }`}
                >
                  {/* Voucher header with checkbox */}
                  <div className="flex items-start gap-3">
                    <button onClick={() => toggle(v.id)} className="mt-0.5 shrink-0">
                      <Icon name={entry.selected ? 'check_box' : 'check_box_outline_blank'} size={20} color={entry.selected ? 'var(--c-primary)' : 'var(--c-text3)'} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-text truncate">{v.store_name}</p>
                      <p className="text-xs text-text3 mt-0.5">{t('bulk.balance')}: ₪{v.balance}</p>
                    </div>
                  </div>

                  {/* Price & description inputs — only show when selected */}
                  {entry.selected && (
                    <div className="space-y-2 pt-1 border-t border-border">
                      <div>
                        <label className="text-xs text-text3 block mb-1">{t('bulk.asking.price')} *</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={1}
                          max={v.balance}
                          value={entry.price}
                          onChange={e => setPrice(v.id, e.target.value)}
                          placeholder={`${t('bulk.price.up.to')} ₪${v.balance}`}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-text3 block mb-1">{t('bulk.description')}</label>
                        <input
                          type="text"
                          value={entry.description}
                          onChange={e => setDescription(v.id, e.target.value)}
                          placeholder={t('bulk.description.placeholder')}
                          className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      {/* Fixed bottom submit */}
      {selected.length > 0 && (
        <div className="fixed left-0 right-0 px-4 pb-2 pt-3" style={{ bottom: 'var(--nav-h)', background: 'linear-gradient(to top, var(--c-bg), transparent)' }}>
          <Button onClick={submit} disabled={submitting} loading={submitting} fullWidth size="lg">
            {submitting ? `${t('bulk.publishing')}...` : (
              <>
                <Icon name="shopping_bag" size={20} />
                {t('bulk.publish')} {selected.length} {t('bulk.vouchers')}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  )
}
