import { useState, useMemo, useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import QRCodeLib from 'qrcode'
import type { Voucher, SuperVoucher } from '../types'
import toast from 'react-hot-toast'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { useT } from '../lib/i18n'
import Icon from './ui/Icon'

interface Props {
  vouchers: Voucher[]
  superVouchers: SuperVoucher[]
  onUpdate: (id: string, balance: number, storeUsed?: string | null) => Promise<void>
  onNavigate: (id: string) => void
  onClose: () => void
}

function sortGroup(vs: Voucher[]) {
  return [...vs].sort((a, b) => {
    if (a.balance === 0 && b.balance !== 0) return 1
    if (a.balance !== 0 && b.balance === 0) return -1
    if (!a.expiry_date && !b.expiry_date) return a.balance - b.balance
    if (!a.expiry_date) return 1
    if (!b.expiry_date) return -1
    const d = new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime()
    return d !== 0 ? d : a.balance - b.balance
  })
}

function isAlphanumericCode(code: string) {
  return /[a-zA-Z]/.test(code)
}

function BarcodeDisplay({ code }: { code: string }) {
  const barcodeRef = useRef<SVGSVGElement>(null)
  const qrRef = useRef<HTMLCanvasElement>(null)
  const isAlpha = isAlphanumericCode(code)

  useEffect(() => {
    if (!code) return
    if (!isAlpha && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: false,
          margin: 8,
        })
      } catch {}
    }
    if (isAlpha && qrRef.current) {
      QRCodeLib.toCanvas(qrRef.current, code, {
        width: 180,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      }).catch(() => {})
    }
  }, [code, isAlpha])

  return (
    <div className="flex justify-center py-2">
      {!isAlpha
        ? <svg ref={barcodeRef} className="max-w-full" />
        : <canvas ref={qrRef} className="rounded-lg" />}
    </div>
  )
}

export default function InStoreMode({ vouchers, superVouchers, onUpdate, onNavigate, onClose }: Props) {
  const { t } = useT()
  const [search, setSearch] = useState('')
  const [payments, setPayments] = useState<Record<string, string>>({})
  const [transactionTotal, setTransactionTotal] = useState(0)
  const [updating, setUpdating] = useState<string | null>(null)
  const [expandedBarcode, setExpandedBarcode] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return vouchers.filter(v => {
      if (v.is_archived) return false
      if (!q) return true
      const sv = superVouchers.find(s => s.id === v.super_voucher_id)
      return (
        v.store_name.toLowerCase().includes(q) ||
        (sv != null && sv.stores.some(s => s.toLowerCase().includes(q)))
      )
    })
  }, [vouchers, superVouchers, search])

  const directVouchers = sortGroup(filtered.filter(v => !v.super_voucher_id))
  const superGroupVouchers = sortGroup(filtered.filter(v => !!v.super_voucher_id))

  const directTotal = directVouchers.filter(v => v.balance > 0).reduce((s, v) => s + v.balance, 0)
  const superTotal = superGroupVouchers.filter(v => v.balance > 0).reduce((s, v) => s + v.balance, 0)

  async function handleUpdate(v: Voucher) {
    const amt = parseFloat(payments[v.id] || '0')
    if (!amt || amt <= 0) { toast.error(t('instore.amount.invalid')); return }
    if (amt > v.balance) { toast.error(t('instore.amount.exceeds')); return }
    setUpdating(v.id)
    try {
      const newBal = Math.max(0, v.balance - amt)
      const storeName = v.store_name
      await onUpdate(v.id, newBal, search.trim() || null)
      setTransactionTotal(prev => prev + amt)
      setPayments(p => ({ ...p, [v.id]: '' }))
      toast.success(t('instore.balance.updated', { store: storeName }))
    } catch {
      toast.error(t('instore.update.error'))
    } finally {
      setUpdating(null)
    }
  }

  function toggleBarcode(id: string) {
    setExpandedBarcode(prev => prev === id ? null : id)
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-bg" dir="rtl">
      {/* Header */}
      <div
        style={{ background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary-mid) 60%, var(--c-primary) 100%)' }}
        className="px-4 pt-5 pb-4 shrink-0"
      >
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-lg font-bold text-white">{t('instore.title')}</h2>
            <p className="text-xs text-white/70">{t('instore.subtitle')}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-full bg-white/10">
            <Icon name="close" size={20} color="#fff" />
          </button>
        </div>

        {/* Totals */}
        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-white/10 rounded-2xl px-3 py-2">
            <div className="text-xs text-white/70 mb-0.5">{t('instore.direct')}</div>
            <div className="text-base font-bold text-white">₪{directTotal.toLocaleString('he-IL')}</div>
          </div>
          <div className="flex-1 bg-white/10 rounded-2xl px-3 py-2">
            <div className="text-xs text-white/70 mb-0.5">{t('instore.super')}</div>
            <div className="text-base font-bold text-white">₪{superTotal.toLocaleString('he-IL')}</div>
          </div>
          <div className="flex-1 rounded-2xl px-3 py-2" style={{ background: 'rgba(251,191,36,0.25)', border: '1px solid rgba(251,191,36,0.3)' }}>
            <div className="text-xs text-amber-200 mb-0.5">{t('instore.transaction')}</div>
            <div className="text-base font-bold text-amber-100">₪{transactionTotal.toLocaleString('he-IL')}</div>
          </div>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2 rounded-2xl px-3 py-2" style={{ background: 'rgba(255,255,255,0.15)' }}>
          <Icon name="search" size={16} color="rgba(255,255,255,0.6)" className="shrink-0" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('instore.search')}
            className="flex-1 bg-transparent text-sm focus:outline-none"
            style={{ color: '#fff' }}
          />
          {search && (
            <button onClick={() => setSearch('')}>
              <Icon name="close" size={14} color="rgba(255,255,255,0.6)" />
            </button>
          )}
        </div>
      </div>

      {/* Voucher list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2 pb-8">
        {directVouchers.length === 0 && superGroupVouchers.length === 0 ? (
          <div className="text-center py-12 text-text3">
            <Icon name="shopping_cart" size={40} color="var(--c-border)" className="mb-2" />
            <p className="font-medium text-sm">
              {search ? t('instore.no.store.vouchers') : t('instore.no.vouchers')}
            </p>
          </div>
        ) : (
          <>
            {directVouchers.length > 0 && superGroupVouchers.length > 0 && (
              <p className="text-xs text-text3 font-medium px-1">{t('instore.direct.vouchers')}</p>
            )}
            {directVouchers.map(v => (
              <VoucherRow
                key={v.id}
                voucher={v}
                payment={payments[v.id] || ''}
                barcodeOpen={expandedBarcode === v.id}
                onPaymentChange={val => setPayments(p => ({ ...p, [v.id]: val }))}
                onFill={() => setPayments(p => ({ ...p, [v.id]: v.balance.toString() }))}
                onUpdate={() => handleUpdate(v)}
                onToggleBarcode={() => toggleBarcode(v.id)}
                onNavigate={() => onNavigate(v.id)}
                updating={updating === v.id}
              />
            ))}
            {superGroupVouchers.length > 0 && (
              <p className="text-xs text-text3 font-medium px-1 pt-2">{t('instore.super.vouchers')}</p>
            )}
            {superGroupVouchers.map(v => (
              <VoucherRow
                key={v.id}
                voucher={v}
                payment={payments[v.id] || ''}
                barcodeOpen={expandedBarcode === v.id}
                onPaymentChange={val => setPayments(p => ({ ...p, [v.id]: val }))}
                onFill={() => setPayments(p => ({ ...p, [v.id]: v.balance.toString() }))}
                onUpdate={() => handleUpdate(v)}
                onToggleBarcode={() => toggleBarcode(v.id)}
                onNavigate={() => onNavigate(v.id)}
                updating={updating === v.id}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function VoucherRow({ voucher: v, payment, barcodeOpen, onPaymentChange, onFill, onUpdate, onToggleBarcode, onNavigate, updating }: {
  voucher: Voucher
  payment: string
  barcodeOpen: boolean
  onPaymentChange: (val: string) => void
  onFill: () => void
  onUpdate: () => void
  onToggleBarcode: () => void
  onNavigate: () => void
  updating: boolean
}) {
  const { t } = useT()
  const { decryptedMap, isVaultUnlocked } = useE2EE()
  const effectiveCode = v.is_e2ee
    ? (decryptedMap.get(v.id)?.code ?? v.code)
    : v.code
  const effectiveCvv = v.is_e2ee
    ? (decryptedMap.get(v.id)?.cvv ?? v.cvv)
    : v.cvv
  const isLocked = v.is_e2ee && isEncryptedField(effectiveCode)
  const isEmpty = v.balance <= 0

  async function copyCode() {
    if (isLocked) return
    await navigator.clipboard.writeText(effectiveCode).catch(() => {})
    toast.success(t('instore.code.copied'))
  }

  return (
    <div className={`bg-surface rounded-card border border-border shadow-card transition-opacity ${isEmpty ? 'opacity-50' : ''}`}>
      {/* Top row: store info + payment controls */}
      <div className="p-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-text text-sm truncate">{v.store_name}</p>
          <p className={`text-xs font-bold ${isEmpty ? 'text-text3' : 'text-primary'}`}>
            ₪{v.balance.toLocaleString('he-IL')}
          </p>
          {v.expiry_date && (
            <p className="text-xs text-text3">{v.expiry_date.slice(0, 10)}</p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            inputMode="decimal"
            value={payment}
            onChange={e => onPaymentChange(e.target.value)}
            placeholder="₪"
            disabled={isEmpty}
            min={0}
            max={v.balance}
            className="w-16 px-2 py-1.5 border border-border rounded-xl text-sm text-center bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-40"
            dir="ltr"
          />
          <button
            type="button"
            onClick={onFill}
            disabled={isEmpty}
            className="px-2.5 py-1.5 text-xs bg-bg text-text2 rounded-xl disabled:opacity-40 font-medium"
          >
            {t('instore.full')}
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={isEmpty || updating || !payment}
            className="px-2.5 py-1.5 text-xs bg-primary text-white rounded-xl disabled:opacity-40 font-medium flex items-center justify-center"
          >
            {updating ? <Icon name="progress_activity" size={14} className="animate-spin" /> : <Icon name="check" size={14} />}
          </button>
        </div>
      </div>

      {/* Code row */}
      <div className="px-3 pb-2.5 flex items-center gap-2 border-t border-border pt-2">
        <button
          onClick={copyCode}
          disabled={isLocked}
          className="flex-1 min-w-0 text-right"
        >
          {isLocked ? (
            <span className="flex items-center gap-1 text-xs text-primary bg-primary-light px-2.5 py-1 rounded-lg inline-flex">
              <Icon name="shield" size={12} />
              {isVaultUnlocked ? t('instore.decrypt.error') : t('instore.open.vault')}
            </span>
          ) : (
            <span className="font-mono text-xs text-text2 tracking-wider bg-bg px-2.5 py-1 rounded-lg inline-block truncate max-w-full">
              {effectiveCode}
            </span>
          )}
        </button>
        {v.cvv && !isLocked && (
          <span className="text-xs text-text3 shrink-0">CVV: <span className="font-mono font-semibold text-text2">{effectiveCvv}</span></span>
        )}
        <button
          onClick={onToggleBarcode}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors ${barcodeOpen ? 'bg-primary-light text-primary' : 'bg-bg text-text3'}`}
        >
          <Icon name="qr_code_2" size={12} />
          {barcodeOpen ? t('app.close') : t('instore.barcode')}
        </button>
        <button
          onClick={onNavigate}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-bg text-text3 shrink-0"
          title={t('instore.go.voucher')}
        >
          <Icon name="north_east" size={12} />
        </button>
      </div>

      {/* Barcode panel */}
      {barcodeOpen && !isLocked && (
        <div className="border-t border-border bg-bg rounded-b-card overflow-hidden">
          <BarcodeDisplay code={effectiveCode} />
        </div>
      )}
    </div>
  )
}
