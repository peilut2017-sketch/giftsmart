import { useState, useMemo, useRef, useEffect } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { defaultExpiryDate } from '../utils/helpers'
import Icon from './ui/Icon'
import { isBiometricEnabled, hasBiometricWrappedVaultKey } from '../lib/passkey'
import { useT } from '../lib/i18n'

type AmountUnit = '₪' | '$' | '€' | 'אחר' | 'פריט'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'
import { supabase } from '../lib/supabase'
import { useE2EE } from '../contexts/E2EEContext'
import { isEncryptedField } from '../lib/e2ee'
import { useAuth } from '../contexts/AuthContext'

// Wizard step ids (add mode only; edit mode renders everything at once)
const STEP_STORE = 1
const STEP_CODE = 2
const STEP_BALANCE = 3
const STEP_EXPIRY = 4
const STEP_DETAILS = 5
const STEP_SUCCESS = 6
const INPUT_STEPS = [STEP_STORE, STEP_CODE, STEP_BALANCE, STEP_EXPIRY, STEP_DETAILS]

// ── Date display helpers (Israeli format DD.MM.YYYY) ──────────────────────────
function isoToDisplay(iso: string): string {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-')
    return `${d}.${m}.${y}`
  }
  return iso
}

function parseDisplayToISO(val: string): string | null {
  const digitsOnly = val.replace(/\D/g, '')
  if (/^\d{6}$/.test(digitsOnly)) {
    const d = digitsOnly.slice(0, 2), m = digitsOnly.slice(2, 4), y = '20' + digitsOnly.slice(4, 6)
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`
  }
  if (/^\d{8}$/.test(digitsOnly)) {
    const d = digitsOnly.slice(0, 2), m = digitsOnly.slice(2, 4), y = digitsOnly.slice(4, 8)
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`
  }
  const match = val.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/)
  if (match) {
    const d = match[1].padStart(2, '0'), m = match[2].padStart(2, '0')
    let y = match[3]; if (y.length === 2) y = '20' + y
    if (+m >= 1 && +m <= 12 && +d >= 1 && +d <= 31) return `${y}-${m}-${d}`
  }
  return null
}

interface Props {
  voucher?: Voucher
  onClose: () => void
  onSave: (v: any) => void
}

export default function VoucherForm({ voucher, onClose, onSave }: Props) {
  const { categories, stores, superVouchers, addStore, addCategory, vouchers, archivedVouchers } = useVouchers()
  useSubscription()
  const { hasVault, isUnifiedVault, hint, isVaultUnlocked, setupVaultFromPassword, unlockVault, unlockVaultFromRecovery, unlockVaultWithBiometric, encrypt, decrypt, decryptedMap } = useE2EE()
  const { user } = useAuth()
  const { t } = useT()

  const isEdit = !!voucher
  // Edit renders all sections at once (single scroll); add is a stepped wizard.
  const [step, setStep] = useState(STEP_STORE)
  const showAll = isEdit
  const [savedSummary, setSavedSummary] = useState<{ store: string; balance: number } | null>(null)

  const [storeName, setStoreName] = useState(voucher?.store_name || '')
  const [storeSearch, setStoreSearch] = useState(voucher?.store_name || '')
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [amount, setAmount] = useState(voucher?.amount?.toString() || '')
  const [balance] = useState(voucher?.balance?.toString() || '')
  const [itemName, setItemName] = useState(() => {
    if (voucher?.item_name) return voucher.item_name
    if (voucher?.notes?.startsWith('📦 ')) return voucher.notes.split('\n')[0].slice('📦 '.length)
    return ''
  })
  const [usageAmount, setUsageAmount] = useState('')
  const [storeUsedInput, setStoreUsedInput] = useState('')
  const [actualCost, setActualCost] = useState(voucher?.actual_cost?.toString() || '')
  const [code, setCode] = useState(voucher?.code || '')
  const [cvv, setCvv] = useState(voucher?.cvv || '')
  const [expiryDate, setExpiryDate] = useState(voucher?.expiry_date || defaultExpiryDate())
  const [displayDate, setDisplayDate] = useState(() => isoToDisplay(voucher?.expiry_date || defaultExpiryDate()))
  const [selectedCats, setSelectedCats] = useState<string[]>(voucher?.categories || [])
  const [tags, setTags] = useState(voucher?.tags?.join(', ') || '')
  const [notes, setNotes] = useState(() => {
    const n = voucher?.notes || ''
    if (!voucher?.item_name && n.startsWith('📦 ')) return n.split('\n').slice(1).join('\n')
    return n
  })
  const [link, setLink] = useState(voucher?.link || '')
  const [source, setSource] = useState(voucher?.source || '')
  const [newCatName, setNewCatName] = useState('')
  const [showCatInput, setShowCatInput] = useState(false)
  const [showCatDropdown, setShowCatDropdown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [isLocked, setIsLocked] = useState(voucher?.is_locked || false)
  const [lockReason, setLockReason] = useState(voucher?.lock_reason || '')
  const [showScanner, setShowScanner] = useState(false)
  const [amountUnit, setAmountUnit] = useState<AmountUnit>(() => {
    if (voucher?.item_name || voucher?.notes?.startsWith('📦 ')) return 'פריט'
    return '₪'
  })
  const [showUnitPicker, setShowUnitPicker] = useState(false)

  // E2EE vault
  const [e2eeEnabled, setE2eeEnabled] = useState(
    voucher?.is_e2ee ?? (localStorage.getItem('gs_e2ee_default') !== 'false')
  )
  const [showVaultModal, setShowVaultModal] = useState(false)
  const [vaultModalMode, setVaultModalMode] = useState<'setup' | 'unlock'>('setup')
  const [vaultPassInput, setVaultPassInput] = useState('')
  const [vaultPass2Input, setVaultPass2Input] = useState('')
  const [vaultHintInput, setVaultHintInput] = useState('')
  const [vaultLoading, setVaultLoading] = useState(false)
  const [vaultError, setVaultError] = useState('')
  const [biometricLoading, setBiometricLoading] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const operatorPickerRef = useRef<HTMLDivElement>(null)
  const hiddenDateRef = useRef<HTMLInputElement>(null)

  function openDatePicker() {
    if (hiddenDateRef.current) {
      if (typeof hiddenDateRef.current.showPicker === 'function') hiddenDateRef.current.showPicker()
      else hiddenDateRef.current.click()
    }
  }

  function handleDateTextChange(val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 8)
    let display: string
    if (digits.length > 4) display = digits.slice(0, 2) + '.' + digits.slice(2, 4) + '.' + digits.slice(4)
    else if (digits.length > 2) display = digits.slice(0, 2) + '.' + digits.slice(2)
    else display = digits
    setDisplayDate(display)
    const iso = parseDisplayToISO(display)
    if (iso) setExpiryDate(iso)
  }
  const unitPickerRef = useRef<HTMLDivElement>(null)

  // Operator quick-fill
  const [operators, setOperators] = useState<{ id: string; name: string; url: string }[]>([])
  const [showOperatorPicker, setShowOperatorPicker] = useState(false)
  const [operatorsLoaded, setOperatorsLoaded] = useState(false)

  useEffect(() => {
    if (!showOperatorPicker) return
    function onOutside(e: MouseEvent | TouchEvent) {
      if (operatorPickerRef.current && !operatorPickerRef.current.contains(e.target as Node)) setShowOperatorPicker(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('touchstart', onOutside) }
  }, [showOperatorPicker])

  useEffect(() => {
    if (!showUnitPicker) return
    function onOutside(e: MouseEvent | TouchEvent) {
      if (unitPickerRef.current && !unitPickerRef.current.contains(e.target as Node)) setShowUnitPicker(false)
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => { document.removeEventListener('mousedown', onOutside); document.removeEventListener('touchstart', onOutside) }
  }, [showUnitPicker])

  useEffect(() => () => { stopScanner() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openOperatorPicker() {
    if (!operatorsLoaded) {
      const { data } = await supabase.rpc('get_balance_operators')
      if (data) setOperators(data)
      setOperatorsLoaded(true)
    }
    setShowOperatorPicker(v => !v)
  }

  const scannerDivId = 'qr-scanner-div'

  const existingTags = useMemo(() => {
    const tagSet = new Set<string>()
    ;[...vouchers, ...archivedVouchers].forEach(v => v.tags?.forEach(tg => tagSet.add(tg)))
    return [...tagSet].sort()
  }, [vouchers, archivedVouchers])

  const currentTagInput = tags.split(',').pop()?.trim() || ''
  const addedTagsList = tags.split(',').map(tg => tg.trim()).filter(Boolean)
  const tagSuggestions = currentTagInput.length >= 1
    ? existingTags.filter(tg => tg.toLowerCase().includes(currentTagInput.toLowerCase()) && !addedTagsList.includes(tg)).slice(0, 5)
    : []

  function addTagSuggestion(tag: string) {
    const parts = tags.split(',')
    parts[parts.length - 1] = tag
    setTags(parts.map(tg => tg.trim()).filter(Boolean).join(', ') + ', ')
    setShowTagSuggestions(false)
  }

  const filteredStores = [
    ...stores.filter(s => s.name.toLowerCase().includes(storeSearch.toLowerCase())),
    ...superVouchers.filter(sv => sv.name.toLowerCase().includes(storeSearch.toLowerCase())).map(sv => ({ id: sv.id, name: sv.name })),
  ].filter((s, i, arr) => arr.findIndex(x => x.name === s.name) === i)

  async function startScanner() {
    setShowScanner(true)
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode(scannerDivId)
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText) => { setCode(decodedText); stopScanner(); toast.success('קוד נסרק!') },
          () => {}
        )
      } catch {
        toast.error('לא ניתן לפתוח מצלמה')
        setShowScanner(false)
      }
    }, 100)
  }

  async function stopScanner() {
    try {
      if (scannerRef.current?.isScanning) { await scannerRef.current.stop(); scannerRef.current.clear() }
    } catch {}
    scannerRef.current = null
    setShowScanner(false)
  }

  function toggleCat(cat: string) {
    setSelectedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
  }

  useEffect(() => {
    if (!voucher?.is_e2ee || !isVaultUnlocked) return
    async function decryptInitial() {
      if (isEncryptedField(code)) { try { setCode(await decrypt(code)) } catch {} }
      if (isEncryptedField(cvv))  { try { setCvv(await decrypt(cvv)) }   catch {} }
    }
    decryptInitial()
  }, [isVaultUnlocked]) // eslint-disable-line react-hooks/exhaustive-deps

  const hasEncryptedVouchers = [...vouchers, ...archivedVouchers].some(v => v.is_e2ee)

  function vaultMode(): 'unlock' | 'setup' {
    if (hasVault || isUnifiedVault) return 'unlock'
    if (hasEncryptedVouchers) return 'unlock'
    return 'setup'
  }

  function handleToggleE2EE() {
    if (!e2eeEnabled) {
      if (!isVaultUnlocked) { setVaultModalMode(vaultMode()); setShowVaultModal(true) }
      else setE2eeEnabled(true)
    } else setE2eeEnabled(false)
  }

  async function handleVaultSubmit() {
    setVaultLoading(true); setVaultError('')
    try {
      if (vaultModalMode === 'setup') {
        if (vaultPassInput.length < 6) { setVaultError('ססמה קצרה מדי (מינ. 6 תווים)'); return }
        if (vaultPassInput !== vaultPass2Input) { setVaultError('הססמאות אינן תואמות'); return }
        await setupVaultFromPassword(vaultPassInput, user!.id, vaultHintInput || undefined)
      } else {
        let ok = await unlockVault(vaultPassInput)
        if (!ok) ok = await unlockVaultFromRecovery(vaultPassInput)
        if (!ok) {
          if (!hasVault && hasEncryptedVouchers) {
            setVaultError('לא ניתן לפתוח. נסה: סיסמת הכניסה המקורית, הסיסמה הישנה של הכספת, או קוד השחזור (XXXX-XXXX-...)')
          } else {
            setVaultError(isUnifiedVault ? 'ססמה שגויה — הזן את סיסמת הכניסה לאפליקציה' : 'ססמה שגויה')
          }
          return
        }
      }
      setE2eeEnabled(true)
      setShowVaultModal(false)
      setVaultPassInput(''); setVaultPass2Input(''); setVaultError('')
    } finally {
      setVaultLoading(false)
    }
  }

  async function handleAddStore() {
    if (!storeSearch.trim()) return
    const newStore = await addStore(storeSearch.trim())
    setStoreName(newStore.name)
    setShowStoreDropdown(false)
  }

  async function handleAddCat() {
    if (!newCatName.trim()) return
    await addCategory(newCatName.trim())
    setSelectedCats(prev => [...prev, newCatName.trim()])
    setNewCatName('')
    setShowCatInput(false)
  }

  // Per-step "Next" gate (add-mode wizard only)
  function validateStep(s: number): boolean {
    if (s === STEP_STORE && !storeName.trim()) { toast.error('יש לבחור שם חנות'); return false }
    if (s === STEP_CODE && !code.trim()) { toast.error('יש להזין קוד שובר'); return false }
    if (s === STEP_BALANCE && amountUnit === 'פריט' && !itemName.trim()) { toast.error('יש להזין שם פריט'); return false }
    return true
  }

  function goNext() {
    if (!validateStep(step)) return
    const idx = INPUT_STEPS.indexOf(step)
    if (idx < INPUT_STEPS.length - 1) setStep(INPUT_STEPS[idx + 1])
  }
  function goBack() {
    const idx = INPUT_STEPS.indexOf(step)
    if (idx > 0) setStep(INPUT_STEPS[idx - 1])
  }

  function resetForm() {
    setSavedSummary(null)
    setStep(STEP_STORE)
    setStoreName(''); setStoreSearch(''); setAmount(''); setItemName(''); setUsageAmount('')
    setStoreUsedInput(''); setActualCost(''); setCode(''); setCvv('')
    setExpiryDate(defaultExpiryDate()); setDisplayDate(isoToDisplay(defaultExpiryDate()))
    setSelectedCats([]); setTags(''); setNotes(''); setLink(''); setSource('')
    setIsLocked(false); setLockReason(''); setAmountUnit('₪')
  }

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!storeName) return toast.error('יש לבחור שם חנות')
    if (!code) return toast.error('יש להזין קוד שובר')

    // Duplicate check — plain vouchers and E2EE vouchers (using decryptedMap)
    if (!e2eeEnabled) {
      const allVouchers = [...vouchers, ...archivedVouchers]
      const normalizedCode = code.toLowerCase().trim()
      const duplicate =
        allVouchers.find(v => !v.is_e2ee && v.code.toLowerCase().trim() === normalizedCode && (!voucher || v.id !== voucher.id)) ??
        allVouchers.find(v => v.is_e2ee && (decryptedMap.get(v.id)?.code ?? '').toLowerCase().trim() === normalizedCode && (!voucher || v.id !== voucher.id))
      if (duplicate) {
        const proceed = confirm(`קוד שובר זה כבר קיים (${duplicate.store_name}). האם להמשיך בכל זאת?`)
        if (!proceed) return
      }
    }

    if (e2eeEnabled && !isVaultUnlocked) {
      setVaultModalMode(vaultMode())
      setShowVaultModal(true)
      return
    }

    setLoading(true)
    try {
      const used = parseFloat(usageAmount) || 0
      const parsedAmount = parseFloat(amount) || 0
      const newBalance = voucher
        ? Math.max(0, (voucher.balance ?? 0) - used)
        : (parseFloat(balance) || parsedAmount || 0)

      if (amountUnit === 'פריט' && !itemName.trim()) { toast.error('יש להזין שם פריט'); return }

      const notesValue = notes.trim()

      let finalCode = code.trim()
      let finalCvv  = cvv.trim() || undefined
      if (e2eeEnabled) {
        if (!isEncryptedField(finalCode)) finalCode = await encrypt(finalCode)
        if (finalCvv && !isEncryptedField(finalCvv)) finalCvv = await encrypt(finalCvv)
      }

      const v = {
        store_name: storeName,
        item_name: amountUnit === 'פריט' ? (itemName.trim() || undefined) : null,
        amount: parsedAmount,
        balance: newBalance,
        actual_cost: actualCost ? parseFloat(actualCost) : null,
        value_percent: actualCost && parsedAmount > 0 ? (parseFloat(actualCost) / parsedAmount) * 100 : null,
        code: finalCode,
        cvv: finalCvv,
        expiry_date: expiryDate || undefined,
        categories: selectedCats,
        tags: tags.split(',').map(tg => tg.trim()).filter(Boolean),
        notes: notesValue || undefined,
        link: link.trim() || undefined,
        source: source.trim() || undefined,
        is_archived: false,
        is_shared: false,
        is_locked: isLocked,
        lock_reason: isLocked ? lockReason.trim() || undefined : undefined,
        is_e2ee: e2eeEnabled,
        _storeUsed: (voucher && used > 0) ? (storeUsedInput.trim() || null) : undefined,
      }
      await onSave(v)
      if (isEdit) onClose()
      else { setSavedSummary({ store: storeName, balance: newBalance }); setStep(STEP_SUCCESS) }
    } catch {
      // error already handled by caller (toast shown in handleSave)
    } finally {
      setLoading(false)
    }
  }

  // Section visibility helper for the shared render (edit: all; add: gated by step)
  const show = (s: number) => showAll || step === s

  const inputCls = 'w-full px-4 py-3 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40'

  return (
    // Centered on all breakpoints, not just sm:+ — anchoring this to the bottom edge on
    // mobile (items-end, flush bottom sheet) meant every keyboard open/close cycle across
    // the wizard's 5 steps jolted the sheet, since its anchor point was exactly where the
    // keyboard appears from. Centered + a real margin on every side barely moves when the
    // visual viewport shrinks for the keyboard.
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="relative bg-surface w-full sm:max-w-lg rounded-[28px] max-h-[92dvh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center bg-bg text-text2">
            <Icon name="close" size={20} />
          </button>
          <h2 className="text-base font-extrabold text-text">
            {isEdit ? t('form.edit.voucher') : (step === STEP_SUCCESS ? t('voucher.added') : t('form.add.voucher'))}
          </h2>
          {/* Step dots (add mode, input steps only) */}
          {!showAll && step !== STEP_SUCCESS ? (
            <div className="flex items-center gap-1">
              {INPUT_STEPS.map(s => (
                <span key={s} className={`h-1.5 rounded-full transition-all ${s === step ? 'w-4 bg-primary' : s < step ? 'w-1.5 bg-primary/50' : 'w-1.5 bg-border'}`} />
              ))}
            </div>
          ) : <span className="w-9" />}
        </div>

        {/* Camera Scanner */}
        {showScanner && (
          <div className="p-4 bg-gray-900 border-b border-border relative">
            <div id={scannerDivId} className="w-full rounded-xl overflow-hidden" />
            <button onClick={stopScanner} className="mt-2 w-full bg-error text-white py-2 rounded-xl text-sm font-medium" type="button">
              {t('app.close')}
            </button>
          </div>
        )}

        {/* ── Success step (add mode) ── */}
        {!showAll && step === STEP_SUCCESS ? (
          <div className="flex-1 overflow-y-auto p-6 text-center flex flex-col items-center justify-center">
            <div className="w-24 h-24 rounded-full bg-primary-light flex items-center justify-center mb-5">
              <div className="w-16 h-16 rounded-full bg-primary flex items-center justify-center">
                <Icon name="check" size={38} color="#fff" />
              </div>
            </div>
            <h3 className="text-xl font-black text-text mb-1">{t('voucher.added')}</h3>
            {savedSummary && (
              <div className="mt-5 w-full bg-surface border border-border rounded-card shadow-card p-4 flex items-center gap-3 text-right">
                <div className="w-12 h-12 rounded-2xl bg-primary flex items-center justify-center text-white font-extrabold">{savedSummary.store.charAt(0)}</div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-text">{savedSummary.store}</div>
                  <div className="text-xs text-text3">{t('checkout.current.balance')}</div>
                </div>
                <div className="text-lg font-black text-text">₪{savedSummary.balance.toLocaleString('he-IL')}</div>
              </div>
            )}
          </div>
        ) : (
          /* ── Form body ── */
          <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-4 space-y-4">
            {/* Step titles (add mode) */}
            {!showAll && (
              <div className="text-center mb-1">
                <p className="text-lg font-extrabold text-text">
                  {step === STEP_STORE ? t('form.store') : step === STEP_CODE ? t('form.code') : step === STEP_BALANCE ? t('form.amount') : step === STEP_EXPIRY ? t('form.expiry') : t('form.more.details')}
                </p>
              </div>
            )}

            {/* Store */}
            {show(STEP_STORE) && (
              <div>
                <label htmlFor="vf-store" className="text-sm font-medium text-text2 mb-1 block">{t('form.store')} *</label>
                <div className="relative">
                  <input
                    id="vf-store" type="text" value={storeSearch}
                    onChange={e => { setStoreSearch(e.target.value); setStoreName(e.target.value); setShowStoreDropdown(true) }}
                    onFocus={() => setShowStoreDropdown(true)}
                    placeholder={t('form.store.placeholder')}
                    aria-autocomplete="list" aria-expanded={showStoreDropdown && !!storeSearch}
                    className={inputCls}
                  />
                  {showStoreDropdown && storeSearch && (
                    <div className="absolute z-20 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg max-h-48 overflow-y-auto">
                      {filteredStores.slice(0, 6).map(s => (
                        <button key={s.id} type="button" onClick={() => { setStoreName(s.name); setStoreSearch(s.name); setShowStoreDropdown(false) }} className="w-full text-right px-4 py-2.5 text-sm hover:bg-bg border-b border-border last:border-0 text-text">
                          {s.name}
                        </button>
                      ))}
                      <button type="button" onClick={handleAddStore} className="w-full text-right px-4 py-2.5 text-sm text-primary hover:bg-primary-light flex items-center gap-2">
                        <Icon name="add" size={16} /> הוסף "{storeSearch}" כחנות חדשה
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Code + Camera */}
            {show(STEP_CODE) && (
              <div>
                <label htmlFor="vf-code" className="text-sm font-medium text-text2 mb-1 block">{t('form.code')} *</label>
                <div className="flex gap-2">
                  <input
                    id="vf-code" type="text"
                    value={isEncryptedField(code) && !isVaultUnlocked ? '' : code}
                    onChange={e => setCode(e.target.value)}
                    disabled={isEncryptedField(code) && !isVaultUnlocked}
                    placeholder={isEncryptedField(code) && !isVaultUnlocked ? '🔐 מוצפן — פתח כספת' : t('form.code.placeholder')}
                    className={`ph-no-capture flex-1 ${inputCls} font-mono disabled:bg-indigo-50 disabled:text-indigo-400 disabled:cursor-not-allowed`}
                    dir="ltr"
                  />
                  <button type="button" onClick={showScanner ? stopScanner : startScanner} aria-label={showScanner ? t('app.close') : t('form.scan.barcode')} className={`px-3 py-3 rounded-2xl border transition ${showScanner ? 'bg-error/10 border-error/30 text-error' : 'border-border text-text2 hover:bg-bg'}`}>
                    <Icon name="barcode_scanner" size={20} aria-hidden />
                  </button>
                </div>
              </div>
            )}

            {/* Amount/Item + Balance / Usage */}
            {show(STEP_BALANCE) && (
              <div className="grid grid-cols-2 gap-3">
                {amountUnit === 'פריט' ? (
                  <>
                    <div className="col-span-2">
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="vf-item-name" className="text-sm font-medium text-text2">שם פריט *</label>
                        <UnitPicker unitPickerRef={unitPickerRef} amountUnit={amountUnit} showUnitPicker={showUnitPicker} setShowUnitPicker={setShowUnitPicker} setAmountUnit={setAmountUnit} />
                      </div>
                      <input id="vf-item-name" type="text" value={itemName} onChange={e => setItemName(e.target.value)} placeholder="שם פריט / שירות..." className={inputCls} dir="rtl" />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text2 mb-1 block">ערך שובר <span className="text-text3 font-normal text-xs">(אופציונלי)</span></label>
                      <div className="flex items-center gap-2"><span className="text-sm text-text3 shrink-0">₪</span>
                        <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0" className={inputCls} dir="ltr" />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-text2 mb-1 block">כמה עלה לי (₪)</label>
                      <div className="flex items-center gap-2"><span className="text-sm text-text3 shrink-0">₪</span>
                        <input type="number" value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0" min="0" className={inputCls} dir="ltr" />
                      </div>
                      {actualCost && parseFloat(actualCost) > 0 && parseFloat(amount) > 0 && (
                        <p className="text-xs mt-1 text-text3">ערך {((parseFloat(actualCost) / parseFloat(amount)) * 100).toFixed(0)}% | עלה {parseFloat(actualCost).toLocaleString('he-IL')} ₪</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="vf-amount" className="text-sm font-medium text-text2">{`שווי שובר (${amountUnit})`}</label>
                        <UnitPicker unitPickerRef={unitPickerRef} amountUnit={amountUnit} showUnitPicker={showUnitPicker} setShowUnitPicker={setShowUnitPicker} setAmountUnit={setAmountUnit} />
                      </div>
                      <input id="vf-amount" type="number" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className={inputCls} dir="ltr" />
                    </div>
                    {voucher ? (
                      <div>
                        <label htmlFor="vf-usage" className="text-sm font-medium text-text2 mb-1 block">סכום שימוש (₪)</label>
                        <input id="vf-usage" type="number" value={usageAmount} onChange={e => setUsageAmount(e.target.value)} placeholder="0" min="0" max={voucher.balance} className={inputCls} dir="ltr" />
                        {(() => {
                          const used = parseFloat(usageAmount) || 0
                          const newBal = Math.max(0, (voucher.balance ?? 0) - used)
                          return used > 0 ? (
                            <p className={`text-xs mt-1 font-medium ${newBal <= 0 ? 'text-error' : 'text-success'}`}>יתרה חדשה: ₪{newBal.toLocaleString('he-IL')}</p>
                          ) : (
                            <p className="text-xs mt-1 text-text3">יתרה: ₪{(voucher.balance ?? 0).toLocaleString('he-IL')}</p>
                          )
                        })()}
                        {(parseFloat(usageAmount) || 0) > 0 && (
                          <input type="text" value={storeUsedInput} onChange={e => setStoreUsedInput(e.target.value)} placeholder="באיזה חנות? (אופציונלי)" className={`mt-2 ${inputCls} py-2.5 text-sm`} dir="rtl" />
                        )}
                      </div>
                    ) : (
                      <div>
                        <label className="text-sm font-medium text-text2 mb-1 block">כמה עלה לי (₪)</label>
                        <div className="flex items-center gap-2"><span className="text-sm text-text3 shrink-0">₪</span>
                          <input type="number" value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0" min="0" className={inputCls} dir="ltr" />
                        </div>
                        {actualCost && parseFloat(actualCost) > 0 && parseFloat(amount) > 0 && (
                          <p className="text-xs mt-1 text-text3">ערך {((parseFloat(actualCost) / parseFloat(amount)) * 100).toFixed(0)}% | עלה {parseFloat(actualCost).toLocaleString('he-IL')} ₪</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Actual cost — edit mode, non-item (item mode includes it above) */}
            {show(STEP_BALANCE) && voucher && amountUnit !== 'פריט' && (
              <div>
                <label className="text-sm font-medium text-text2 mb-1 block">כמה עלה לי (₪)</label>
                <div className="flex items-center gap-2"><span className="text-sm text-text3 shrink-0">₪</span>
                  <input type="number" value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0" min="0" className={inputCls} dir="ltr" />
                </div>
                {actualCost && parseFloat(actualCost) > 0 && parseFloat(amount) > 0 && (
                  <p className="text-xs mt-1 text-text3">ערך {((parseFloat(actualCost) / parseFloat(amount)) * 100).toFixed(0)}% | עלה {parseFloat(actualCost).toLocaleString('he-IL')} ₪</p>
                )}
              </div>
            )}

            {/* Expiry */}
            {show(STEP_EXPIRY) && (
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label htmlFor="vf-expiry" className="text-sm font-medium text-text2">{t('form.expiry')}</label>
                  <button type="button" onClick={openDatePicker} className="text-text3 hover:text-primary" tabIndex={-1} aria-label="בחר תאריך"><Icon name="calendar_today" size={14} /></button>
                  <input ref={hiddenDateRef} type="date" value={expiryDate} onChange={e => { setExpiryDate(e.target.value); setDisplayDate(isoToDisplay(e.target.value)) }} className="sr-only" tabIndex={-1} aria-hidden />
                </div>
                <div className="flex gap-2 items-center">
                  <input id="vf-expiry" type="text" value={displayDate} onChange={e => handleDateTextChange(e.target.value)} placeholder="DD.MM.YYYY" className="flex-1 min-w-0 px-3 py-3 border border-border rounded-2xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40" dir="ltr" />
                  <div className="flex gap-1 shrink-0">
                    {[{ label: '+1y', years: 1 }, { label: '+2y', years: 2 }, { label: '+5y', years: 5 }].map(({ label, years }) => (
                      <button key={years} type="button" onClick={() => { const d = new Date(); d.setFullYear(d.getFullYear() + years); const iso = d.toISOString().split('T')[0]; setExpiryDate(iso); setDisplayDate(isoToDisplay(iso)) }} className="px-2 py-3 text-xs font-medium bg-bg text-text2 rounded-2xl hover:bg-primary-light hover:text-primary-dark transition">
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Additional details (step 5 / always in edit) ── */}
            {show(STEP_DETAILS) && (
              <div className="space-y-4">
                {!showAll && <p className="text-xs text-text3 text-center">{t('form.more.details.hint')}</p>}

                {/* E2EE toggle */}
                <button type="button" onClick={handleToggleE2EE} className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border transition ${e2eeEnabled ? 'bg-indigo-50 border-indigo-200' : 'bg-bg border-border hover:opacity-90'}`}>
                  <div className="flex items-center gap-2">
                    <Icon name="shield" size={16} color={e2eeEnabled ? '#4f46e5' : 'var(--c-text3)'} />
                    <div className="text-right">
                      <p className={`text-sm font-medium ${e2eeEnabled ? 'text-indigo-700' : 'text-text'}`}>{t('form.encrypt')}</p>
                      <p className="text-xs text-text3">קוד וCVV מוצפנים — רק אתה יכול לקרוא</p>
                    </div>
                  </div>
                  <div className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${e2eeEnabled ? 'bg-indigo-500' : 'bg-border'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${e2eeEnabled ? 'translate-x-0.5' : 'right-0.5'}`} />
                  </div>
                </button>

                {/* CVV */}
                <div>
                  <label htmlFor="vf-cvv" className="text-sm font-medium text-text2 mb-1 block">CVV</label>
                  <input id="vf-cvv" type="text"
                    value={isEncryptedField(cvv) && !isVaultUnlocked ? '' : cvv}
                    onChange={e => setCvv(e.target.value)}
                    disabled={isEncryptedField(cvv) && !isVaultUnlocked}
                    placeholder={isEncryptedField(cvv) && !isVaultUnlocked ? '🔐 מוצפן' : 'אופציונלי'}
                    className={`ph-no-capture ${inputCls} font-mono disabled:bg-indigo-50 disabled:text-indigo-400 disabled:cursor-not-allowed`}
                    dir="ltr" />
                </div>

                {/* Source */}
                <div>
                  <label className="text-sm font-medium text-text2 mb-1 block">מקור שובר</label>
                  <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="לדוגמה: קיבלתי כמתנה, נקנה בחנות, תוכנית נאמנות..." className={inputCls} />
                </div>

                {/* Link + operator */}
                <div>
                  <label className="text-sm font-medium text-text2 mb-1 flex items-center gap-1.5"><Icon name="link" size={14} /> {t('form.link')}</label>
                  <div className="relative" ref={operatorPickerRef}>
                    <div className="flex gap-1.5">
                      <input type="url" value={link} onChange={e => setLink(e.target.value)} placeholder="https://..." className={`flex-1 min-w-0 ${inputCls}`} dir="ltr" />
                      <button type="button" onClick={openOperatorPicker} className="flex-shrink-0 flex items-center gap-1 px-3 py-2 bg-teal-50 border border-teal-200 text-teal-700 rounded-2xl text-xs font-medium whitespace-nowrap">
                        מפעיל <Icon name="keyboard_arrow_down" size={12} />
                      </button>
                    </div>
                    {showOperatorPicker && (
                      <div className="absolute top-full right-0 left-0 mt-1 bg-surface border border-border rounded-2xl shadow-xl z-30 overflow-hidden">
                        {operators.length === 0 ? (
                          <p className="px-4 py-3 text-xs text-text3 text-center">אין מפעילים מוגדרים</p>
                        ) : (
                          <div className="max-h-44 overflow-y-auto divide-y divide-border">
                            {operators.map(op => (
                              <button key={op.id} type="button" onClick={() => { setLink(op.url); setShowOperatorPicker(false) }} className="w-full text-right px-4 py-2.5 hover:bg-teal-50 flex items-center justify-between gap-2">
                                <span className="font-medium text-sm text-text">{op.name}</span>
                                <span className="text-xs text-text3 truncate max-w-[140px]" dir="ltr">{op.url}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Categories */}
                <div>
                  <label className="text-sm font-medium text-text2 mb-2 block">{t('form.categories')}</label>
                  <div className="flex flex-wrap gap-2 items-center">
                    {selectedCats.map(name => {
                      const cat = categories.find(c => c.name === name)
                      return (
                        <button key={name} type="button" onClick={() => toggleCat(name)} className="px-3 py-1.5 rounded-full text-xs font-medium bg-primary-light text-primary-dark border-2 border-primary">
                          {cat?.emoji} {name}
                        </button>
                      )
                    })}
                    <button type="button" onClick={() => setShowCatDropdown(prev => !prev)} className="px-3 py-1.5 rounded-full text-xs font-medium bg-bg text-text2 border-2 border-dashed border-border hover:opacity-80">
                      <Icon name="add" size={14} className="inline" /> {showCatDropdown ? 'סגור' : 'ערוך קטגוריות'}
                    </button>
                  </div>
                  {showCatDropdown && (
                    <div className="mt-2 p-3 border border-border rounded-2xl bg-bg flex flex-wrap gap-2">
                      {categories.map(cat => (
                        <button key={cat.id} type="button" onClick={() => toggleCat(cat.name)} className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${selectedCats.includes(cat.name) ? 'bg-primary-light text-primary-dark border-2 border-primary' : 'bg-surface text-text2 border-2 border-transparent hover:opacity-80'}`}>
                          {cat.emoji} {cat.name}
                        </button>
                      ))}
                      <button type="button" onClick={() => setShowCatInput(!showCatInput)} className="px-3 py-1.5 rounded-full text-xs font-medium bg-surface text-text2 border-2 border-dashed border-border">
                        <Icon name="add" size={14} className="inline" /> הוסף קטגוריה
                      </button>
                      {showCatInput && (
                        <div className="w-full flex gap-2 mt-1">
                          <input type="text" value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="שם קטגוריה חדשה" className="flex-1 min-w-0 px-3 py-2 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40" />
                          <button type="button" onClick={handleAddCat} className="px-4 py-2 bg-primary text-white rounded-xl text-sm font-medium">{t('app.add')}</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tags */}
                <div className="relative">
                  <label className="text-sm font-medium text-text2 mb-1 block flex items-center gap-1"><Icon name="sell" size={14} /> תגיות (מופרדות בפסיק)</label>
                  <input type="text" value={tags} onChange={e => { setTags(e.target.value); setShowTagSuggestions(true) }} onFocus={() => setShowTagSuggestions(true)} onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)} placeholder="מתנה, יום הולדת, קיץ..." className={inputCls} />
                  {showTagSuggestions && tagSuggestions.length > 0 && (
                    <div className="absolute z-20 w-full mt-1 bg-surface border border-border rounded-2xl shadow-lg overflow-hidden">
                      {tagSuggestions.map(tag => (
                        <button key={tag} type="button" onMouseDown={() => addTagSuggestion(tag)} className="w-full text-right px-4 py-2 text-sm hover:bg-bg border-b border-border last:border-0 flex items-center gap-2 text-text">
                          <Icon name="sell" size={12} color="var(--c-text3)" /> {tag}
                        </button>
                      ))}
                    </div>
                  )}
                  {existingTags.length > 0 && currentTagInput === '' && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {existingTags.filter(tg => !addedTagsList.includes(tg)).slice(0, 8).map(tag => (
                        <button key={tag} type="button" onClick={() => { const current = tags.trim(); setTags(current ? current + ', ' + tag + ', ' : tag + ', ') }} className="text-xs bg-bg text-text2 px-2 py-0.5 rounded-full hover:opacity-80">
                          +{tag}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label className="text-sm font-medium text-text2 mb-1 block">{t('form.notes')}</label>
                  <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('form.notes.placeholder')} rows={3} className={`${inputCls} resize-none`} />
                </div>

                {/* Lock voucher */}
                <div className={`rounded-2xl border-2 p-4 transition ${isLocked ? 'border-warning/40 bg-warning/10' : 'border-border bg-bg'}`}>
                  <button type="button" onClick={() => setIsLocked(prev => !prev)} className="w-full flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Icon name="lock" size={16} color={isLocked ? 'var(--c-warning)' : 'var(--c-text3)'} />
                      <span className={`text-sm font-medium ${isLocked ? 'text-warning' : 'text-text2'}`}>נעל שובר</span>
                      {isLocked && <span className="text-xs bg-warning/20 text-warning px-2 py-0.5 rounded-full font-medium">פעיל</span>}
                    </div>
                    <div className={`w-10 h-6 rounded-full transition-colors flex items-center px-1 ${isLocked ? 'bg-warning' : 'bg-border'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${isLocked ? 'translate-x-[-16px]' : ''}`} />
                    </div>
                  </button>
                  <p className="text-xs text-text3 mt-1 mr-6">שובר נעול יציג אזהרה לפני פתיחה בקופה</p>
                  {isLocked && (
                    <div className="mt-3">
                      <label className="text-xs font-medium text-warning mb-1 block">סיבת נעילה</label>
                      <textarea value={lockReason} onChange={e => setLockReason(e.target.value)} placeholder="לדוגמה: שמור ליום הולדת של דני, לא לשימוש עד דצמבר..." rows={2} className="w-full px-4 py-3 border border-warning/30 rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-warning/40 resize-none" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </form>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-border safe-area-bottom">
          {showAll ? (
            <button onClick={() => handleSubmit()} disabled={loading} className="w-full bg-gradient-to-r from-primary-mid to-primary-dark text-white py-3.5 rounded-2xl font-semibold shadow-fab hover:brightness-105 transition disabled:opacity-70">
              {loading ? t('app.loading') : t('app.save')}
            </button>
          ) : step === STEP_SUCCESS ? (
            <div className="flex gap-2">
              <button onClick={resetForm} className="flex-1 py-3.5 rounded-2xl font-bold text-primary border border-primary/40 bg-surface">{t('form.add.another')}</button>
              <button onClick={onClose} className="flex-1 py-3.5 rounded-2xl font-bold text-white bg-gradient-to-r from-primary-mid to-primary-dark shadow-fab">{t('form.done')}</button>
            </div>
          ) : (
            <div className="flex gap-2">
              {step !== STEP_STORE && (
                <button onClick={goBack} className="px-6 py-3.5 rounded-2xl font-bold text-text2 bg-bg">{t('form.back')}</button>
              )}
              {step === STEP_DETAILS ? (
                <button onClick={() => handleSubmit()} disabled={loading} className="flex-1 bg-gradient-to-r from-primary-mid to-primary-dark text-white py-3.5 rounded-2xl font-semibold shadow-fab disabled:opacity-70">
                  {loading ? t('app.loading') : t('form.add.voucher')}
                </button>
              ) : (
                <button onClick={goNext} className="flex-1 bg-gradient-to-r from-primary-mid to-primary-dark text-white py-3.5 rounded-2xl font-semibold shadow-fab">{t('form.next')}</button>
              )}
            </div>
          )}
        </div>

        {/* Vault modal overlay */}
        {showVaultModal && (
          <div className="absolute inset-0 bg-surface/96 backdrop-blur-sm z-20 flex flex-col items-center justify-center p-6 rounded-t-[28px] sm:rounded-[28px] overflow-y-auto">
            <Icon name="shield" size={48} color="#6366f1" />
            <h3 className="text-lg font-bold text-text mb-1 mt-3">{vaultModalMode === 'setup' ? 'הגדר כספת הצפנה' : 'פתח כספת הצפנה'}</h3>

            {vaultModalMode === 'setup' ? (
              <div className="w-full max-w-xs mb-4 bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning space-y-1 leading-relaxed">
                <p className="font-bold flex items-center gap-1"><Icon name="warning" size={14} /> קרא לפני שממשיך:</p>
                <p>• קוד השובר יוצפן — רק מי שמחזיק בסיסמה יכול לקרוא אותו</p>
                <p>• הכספת תוגן <strong>בסיסמת הכניסה לאפליקציה</strong> — לא נדרשת סיסמה נפרדת</p>
                <p>• שיתוף קישור לשובר זה יחשוף את הקוד לשרת</p>
              </div>
            ) : !hasVault && hasEncryptedVouchers ? (
              <div className="w-full max-w-xs mb-4 bg-warning/10 border border-warning/30 rounded-xl p-3 text-xs text-warning space-y-1 leading-relaxed">
                <p className="font-bold flex items-center gap-1"><Icon name="warning" size={14} /> נתוני הכספת חסרים במכשיר זה</p>
                <p>נסה לפי הסדר:</p>
                <p>1. <strong>סיסמת הכניסה לאפליקציה</strong> (אם הייתה כספת מאוחדת)</p>
                <p>2. <strong>הסיסמה הישנה של הכספת</strong> (אם הייתה נפרדת)</p>
                <p>3. <strong>קוד שחזור</strong> (XXXX-XXXX-XXXX-...)</p>
              </div>
            ) : isUnifiedVault ? (
              <p className="text-xs text-indigo-500 mb-3 text-center">הכנס את <strong>סיסמת הכניסה לאפליקציה</strong>{hint ? <> · רמז: <span className="font-medium">{hint}</span></> : null}</p>
            ) : hint ? (
              <p className="text-xs text-indigo-500 mb-3 text-center flex items-center justify-center gap-1"><Icon name="lightbulb" size={14} /> רמז: <span className="font-medium">{hint}</span></p>
            ) : null}

            {vaultModalMode === 'unlock' && isBiometricEnabled() && hasBiometricWrappedVaultKey() && (
              <button type="button" disabled={biometricLoading}
                onClick={async () => {
                  setBiometricLoading(true)
                  try {
                    const ok = await unlockVaultWithBiometric()
                    if (ok) { setE2eeEnabled(true); setShowVaultModal(false) }
                    else setVaultError('אימות ביומטרי נכשל — נסה סיסמה')
                  } finally { setBiometricLoading(false) }
                }}
                className="flex items-center justify-center gap-2 w-full max-w-xs py-2.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-xl text-sm font-semibold disabled:opacity-50 mb-3">
                <Icon name="fingerprint" size={16} /> {biometricLoading ? 'ממתין...' : 'פתח עם ביומטרי'}
              </button>
            )}

            <div className="w-full max-w-xs space-y-2.5">
              <input type="password" value={vaultPassInput} onChange={e => setVaultPassInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !vaultPass2Input && handleVaultSubmit()}
                placeholder={vaultModalMode === 'setup' ? 'סיסמת כניסה לאפליקציה (מינ. 6 תווים)' : (!hasVault && hasEncryptedVouchers) ? 'סיסמה / קוד שחזור' : isUnifiedVault ? 'סיסמת כניסה לאפליקציה' : 'סיסמת כספת'}
                className="ph-no-capture w-full px-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300"
                dir="ltr" autoFocus autoComplete={vaultModalMode === 'setup' ? 'new-password' : 'current-password'} name="vault-password" />
              {vaultModalMode === 'setup' && (
                <>
                  <input type="password" value={vaultPass2Input} onChange={e => setVaultPass2Input(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleVaultSubmit()} placeholder="אימות סיסמה" className="ph-no-capture w-full px-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" dir="ltr" autoComplete="new-password" name="vault-password-confirm" />
                  <input type="text" value={vaultHintInput} onChange={e => setVaultHintInput(e.target.value)} placeholder="רמז סיסמה (לא חובה) — יוצג בפתיחת הכספת" className="w-full px-4 py-2.5 border border-border rounded-xl text-sm bg-surface text-text2 focus:outline-none focus:ring-2 focus:ring-indigo-200" dir="rtl" />
                </>
              )}
              {vaultError && <p className="text-xs text-error text-center">{vaultError}</p>}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={handleVaultSubmit} disabled={vaultLoading || !vaultPassInput} className="flex-1 py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                  {vaultLoading ? '...' : vaultModalMode === 'setup' ? 'צור כספת' : 'פתח'}
                </button>
                <button type="button" onClick={() => { setShowVaultModal(false); setVaultPassInput(''); setVaultPass2Input(''); setVaultHintInput(''); setVaultError('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-sm font-medium">
                  {t('app.cancel')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Shared amount-unit picker (currency / item)
function UnitPicker({ unitPickerRef, amountUnit, showUnitPicker, setShowUnitPicker, setAmountUnit }: {
  unitPickerRef: React.RefObject<HTMLDivElement | null>
  amountUnit: AmountUnit
  showUnitPicker: boolean
  setShowUnitPicker: (fn: (v: boolean) => boolean) => void
  setAmountUnit: (u: AmountUnit) => void
}) {
  return (
    <div className="relative" ref={unitPickerRef}>
      <button type="button" onClick={() => setShowUnitPicker(v => !v)} className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-bg text-text2 hover:opacity-80 text-xs font-semibold">
        {amountUnit} <Icon name="keyboard_arrow_down" size={12} />
      </button>
      {showUnitPicker && (
        <div className="absolute top-full left-0 mt-1 bg-surface rounded-xl shadow-lg border border-border py-1 z-30 min-w-[70px]">
          {(['₪', '$', '€', 'אחר', 'פריט'] as AmountUnit[]).map(u => (
            <button key={u} type="button" onClick={() => { setAmountUnit(u); setShowUnitPicker(() => false) }} className={`w-full px-3 py-1.5 text-xs text-right hover:bg-bg ${amountUnit === u ? 'text-primary font-semibold' : 'text-text'}`}>
              {u}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
