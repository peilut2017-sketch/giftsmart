import { useState, useMemo, useRef, useEffect } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { defaultExpiryDate } from '../utils/helpers'
import { extractFromSMS } from '../utils/smsExtractor'
import { analyzeVoucherImage, analyzeVoucherText, isGeminiAvailable } from '../lib/gemini'
import { X, Clipboard, Plus, Camera, Tag, Link, ImagePlus, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'

const OCR_STORAGE_KEY = () => `ocr_scans_${new Date().toISOString().slice(0, 7)}` // YYYY-MM

interface Props {
  voucher?: Voucher
  onClose: () => void
  onSave: (v: any) => void
}

export default function VoucherForm({ voucher, onClose, onSave }: Props) {
  const { categories, stores, superVouchers, addStore, addCategory, vouchers, archivedVouchers } = useVouchers()
  const { profile } = useAuth()
  const { limits, openUpgradeSheet } = useSubscription()
  const showVoucherValue = profile?.show_voucher_value ?? false

  const [storeName, setStoreName] = useState(voucher?.store_name || '')
  const [storeSearch, setStoreSearch] = useState(voucher?.store_name || '')
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [amount, setAmount] = useState(voucher?.amount?.toString() || '')
  const [balance, setBalance] = useState(voucher?.balance?.toString() || '')
  const [usageAmount, setUsageAmount] = useState('')
  const [storeUsedInput, setStoreUsedInput] = useState('')
  const [valuePercent, setValuePercent] = useState(voucher?.value_percent?.toString() || '')
  const [code, setCode] = useState(voucher?.code || '')
  const [cvv, setCvv] = useState(voucher?.cvv || '')
  const [expiryDate, setExpiryDate] = useState(voucher?.expiry_date || defaultExpiryDate())
  const [selectedCats, setSelectedCats] = useState<string[]>(voucher?.categories || [])
  const [tags, setTags] = useState(voucher?.tags?.join(', ') || '')
  const [notes, setNotes] = useState(voucher?.notes || '')
  const [link, setLink] = useState(voucher?.link || '')
  const [source, setSource] = useState(voucher?.source || '')
  const [newCatName, setNewCatName] = useState('')
  const [showCatInput, setShowCatInput] = useState(false)
  const [showSMSInput, setShowSMSInput] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const [smsLoading, setSmsLoading] = useState(false)
  const [showImageMenu, setShowImageMenu] = useState(false)
  const geminiAvailable = isGeminiAvailable()
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const imageCameraRef = useRef<HTMLInputElement>(null)
  const imageFileRef = useRef<HTMLInputElement>(null)
  const imageMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!showImageMenu) return
    function onOutside(e: MouseEvent | TouchEvent) {
      if (imageMenuRef.current && !imageMenuRef.current.contains(e.target as Node)) {
        setShowImageMenu(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
    }
  }, [showImageMenu])
  const scannerDivId = 'qr-scanner-div'

  // Existing tags from all vouchers for autocomplete
  const existingTags = useMemo(() => {
    const tagSet = new Set<string>()
    ;[...vouchers, ...archivedVouchers].forEach(v => v.tags?.forEach(t => tagSet.add(t)))
    return [...tagSet].sort()
  }, [vouchers, archivedVouchers])

  const currentTagInput = tags.split(',').pop()?.trim() || ''
  const addedTagsList = tags.split(',').map(t => t.trim()).filter(Boolean)
  const tagSuggestions = currentTagInput.length >= 1
    ? existingTags.filter(t =>
        t.toLowerCase().includes(currentTagInput.toLowerCase()) &&
        !addedTagsList.includes(t)
      ).slice(0, 5)
    : []

  function addTagSuggestion(tag: string) {
    const parts = tags.split(',')
    parts[parts.length - 1] = tag
    setTags(parts.map(t => t.trim()).filter(Boolean).join(', ') + ', ')
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
          (decodedText) => {
            setCode(decodedText)
            stopScanner()
            toast.success('קוד נסרק!')
          },
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
      if (scannerRef.current?.isScanning) {
        await scannerRef.current.stop()
        scannerRef.current.clear()
      }
    } catch {}
    scannerRef.current = null
    setShowScanner(false)
  }

  function applyExtracted(extracted: { store_name?: string; amount?: number; balance?: number; code?: string; cvv?: string; expiry_date?: string }) {
    let found = 0
    if (extracted.store_name) { setStoreName(extracted.store_name); setStoreSearch(extracted.store_name); found++ }
    if (extracted.amount) { setAmount(extracted.amount.toString()); if (!balance) setBalance(extracted.amount.toString()); found++ }
    if (extracted.balance && !extracted.amount) { setBalance(extracted.balance.toString()); found++ }
    if (extracted.code) { setCode(extracted.code); found++ }
    if (extracted.cvv) { setCvv(extracted.cvv); found++ }
    if (extracted.expiry_date) { setExpiryDate(extracted.expiry_date); found++ }
    return found
  }

  async function handleImageOCR(file: File) {
    if (file.type && !file.type.startsWith('image/')) return toast.error('יש לבחור קובץ תמונה')
    const scanKey = OCR_STORAGE_KEY()
    const scansThisMonth = parseInt(localStorage.getItem(scanKey) || '0')
    if (scansThisMonth >= limits.maxScansPerMonth) {
      openUpgradeSheet(`הגעת למגבלת ${limits.maxScansPerMonth} הסריקות לחודש זה`)
      return
    }
    setOcrLoading(true)
    const usingGemini = isGeminiAvailable()
    const toastId = toast.loading(usingGemini ? 'מנתח תמונה עם AI...' : 'מנתח תמונה... (עד 15 שניות)')
    try {
      let extracted: ReturnType<typeof extractFromSMS>

      if (usingGemini) {
        extracted = await analyzeVoucherImage(file)
      } else {
        // Fallback: Tesseract → regex
        const { createWorker } = await import('tesseract.js')
        const worker = await createWorker(['heb', 'eng'])
        const url = URL.createObjectURL(file)
        const { data: { text } } = await worker.recognize(url)
        URL.revokeObjectURL(url)
        await worker.terminate()
        if (!text.trim()) {
          toast.dismiss(toastId)
          return toast.error('לא ניתן לחלץ טקסט מהתמונה')
        }
        extracted = extractFromSMS(text)
      }

      // Increment scan counter
      localStorage.setItem(scanKey, (scansThisMonth + 1).toString())

      const found = applyExtracted(extracted)
      toast.dismiss(toastId)
      if (found > 0) toast.success(`זוהו ${found} פרטים${usingGemini ? ' (AI)' : ''}`)
      else toast('לא זוהו פרטי שובר — נסה תמונה ברורה יותר', { icon: '🔍' })
    } catch (err) {
      // Gemini failed — try Tesseract as last resort
      if (isGeminiAvailable()) {
        try {
          toast.dismiss(toastId)
          const toastId2 = toast.loading('מנסה OCR...')
          const { createWorker } = await import('tesseract.js')
          const worker = await createWorker(['heb', 'eng'])
          const url = URL.createObjectURL(file)
          const { data: { text } } = await worker.recognize(url)
          URL.revokeObjectURL(url)
          await worker.terminate()
          const extracted = extractFromSMS(text)
          localStorage.setItem(scanKey, (scansThisMonth + 1).toString())
          const found = applyExtracted(extracted)
          toast.dismiss(toastId2)
          if (found > 0) toast.success(`זוהו ${found} פרטים (OCR)`)
          else toast('לא זוהו פרטי שובר — נסה תמונה ברורה יותר', { icon: '🔍' })
          return
        } catch {}
      }
      toast.dismiss(toastId)
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[OCR]', msg)
      // Show a hint if it's an HEIC file
      if (msg.includes('decode') || msg.includes('heic') || msg.includes('heif')) {
        toast.error('פורמט HEIC לא נתמך — שמור כ-JPEG/PNG ונסה שוב')
      } else if (msg.includes('GEMINI_API_KEY')) {
        toast.error('מפתח Gemini לא מוגדר בשרת — הגדר GEMINI_API_KEY ב-Supabase Secrets')
      } else {
        toast.error(`שגיאה בניתוח התמונה: ${msg}`)
      }
    } finally {
      setOcrLoading(false)
    }
  }

  async function handleSMSExtract() {
    if (!smsText.trim()) return
    if (geminiAvailable) {
      setSmsLoading(true)
      const toastId = toast.loading('מנתח טקסט עם AI...')
      try {
        const extracted = await analyzeVoucherText(smsText)
        const found = applyExtracted(extracted)
        toast.dismiss(toastId)
        if (found > 0) toast.success(`זוהו ${found} פרטים (AI)`)
        else toast('לא זוהו פרטי שובר — נסה להדביק טקסט אחר', { icon: '🔍' })
      } catch {
        toast.dismiss(toastId)
        const extracted = extractFromSMS(smsText)
        applyExtracted(extracted)
        toast.success('פרטים חולצו')
      } finally {
        setSmsLoading(false)
      }
    } else {
      const extracted = extractFromSMS(smsText)
      applyExtracted(extracted)
      toast.success('פרטים חולצו בהצלחה!')
    }
    setShowSMSInput(false)
  }

  function toggleCat(cat: string) {
    setSelectedCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!storeName) return toast.error('יש לבחור שם חנות')
    if (!code) return toast.error('יש להזין קוד שובר')

    // Duplicate check
    const allVouchers = [...vouchers, ...archivedVouchers]
    const duplicate = allVouchers.find(v =>
      v.code.toLowerCase().trim() === code.toLowerCase().trim() &&
      (!voucher || v.id !== voucher.id)
    )
    if (duplicate) {
      const proceed = confirm(`קוד שובר זה כבר קיים (${duplicate.store_name}). האם להמשיך בכל זאת?`)
      if (!proceed) return
    }

    setLoading(true)
    try {
      const used = parseFloat(usageAmount) || 0
      const parsedAmount = parseFloat(amount) || 0
      const newBalance = voucher
        ? Math.max(0, (voucher.balance ?? 0) - used)
        : (parseFloat(balance) || parsedAmount || 0)

      // Validate balance ≤ original amount
      if (parsedAmount > 0 && newBalance > parsedAmount) {
        toast.error(`היתרה (₪${newBalance.toLocaleString('he-IL')}) לא יכולה להיות גבוהה מהסכום המקורי (₪${parsedAmount.toLocaleString('he-IL')})`)
        setLoading(false)
        return
      }

      const v = {
        store_name: storeName,
        amount: parsedAmount,
        balance: newBalance,
        value_percent: valuePercent ? parseFloat(valuePercent) : null,
        code: code.trim(),
        cvv: cvv.trim() || undefined,
        expiry_date: expiryDate || undefined,
        categories: selectedCats,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
        link: link.trim() || undefined,
        source: source.trim() || undefined,
        is_archived: false,
        is_shared: false,
        _storeUsed: (voucher && used > 0) ? (storeUsedInput.trim() || null) : undefined,
      }
      await onSave(v)
      onClose()
    } catch {
      // error already handled by caller (toast shown in handleSave)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92dvh] flex flex-col animate-slide-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-bold">{voucher ? 'עריכת שובר' : 'הוספת שובר'}</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSMSInput(!showSMSInput)}
              className="flex items-center gap-1 text-xs bg-blue-50 text-blue-600 px-3 py-1.5 rounded-full font-medium"
              type="button"
            >
              <Clipboard className="w-3.5 h-3.5" />
              הדבק SMS
              {geminiAvailable && <Sparkles className="w-3 h-3 text-purple-400" />}
            </button>
            <div className="relative" ref={imageMenuRef}>
              <button
                type="button"
                disabled={ocrLoading}
                onClick={() => setShowImageMenu(v => !v)}
                className="flex items-center gap-1 text-xs bg-purple-50 text-purple-600 px-3 py-1.5 rounded-full font-medium disabled:opacity-50"
              >
                <ImagePlus className="w-3.5 h-3.5" />
                {ocrLoading ? 'מנתח...' : 'סרוק תמונה'}
                {geminiAvailable && !ocrLoading && <Sparkles className="w-3 h-3 text-purple-400" />}
              </button>
              {showImageMenu && (
                <div className="absolute top-full mt-1 right-0 bg-white rounded-2xl shadow-lg border border-gray-100 py-1 z-50 min-w-[140px]">
                  <button
                    type="button"
                    onClick={() => { setShowImageMenu(false); imageCameraRef.current?.click() }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Camera className="w-4 h-4 text-gray-500" />
                    מצלמה
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowImageMenu(false); imageFileRef.current?.click() }}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <ImagePlus className="w-4 h-4 text-gray-500" />
                    גלריה / קבצים
                  </button>
                </div>
              )}
              {/* Camera input */}
              <input
                ref={imageCameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageOCR(f); e.target.value = '' }}
              />
              {/* Gallery / files input */}
              <input
                ref={imageFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageOCR(f); e.target.value = '' }}
              />
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* SMS Input */}
        {showSMSInput && (
          <div className="p-4 bg-blue-50 border-b">
            <textarea
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
              placeholder="הדבק כאן את הודעת ה-SMS או המייל עם פרטי השובר..."
              className="w-full p-3 rounded-xl border border-blue-200 text-sm bg-white resize-none h-24 focus:outline-none focus:ring-2 focus:ring-blue-300"
              dir="auto"
            />
            <button
              onClick={handleSMSExtract}
              disabled={!smsText.trim() || smsLoading}
              className="mt-2 w-full bg-blue-500 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-1.5"
              type="button"
            >
              {smsLoading ? 'מנתח...' : (
                <>
                  {geminiAvailable && <Sparkles className="w-3.5 h-3.5" />}
                  חלץ פרטים {geminiAvailable ? '(AI)' : ''}
                </>
              )}
            </button>
          </div>
        )}

        {/* Camera Scanner */}
        {showScanner && (
          <div className="p-4 bg-gray-900 border-b relative">
            <div id={scannerDivId} className="w-full rounded-xl overflow-hidden" />
            <button
              onClick={stopScanner}
              className="mt-2 w-full bg-red-500 text-white py-2 rounded-xl text-sm font-medium"
              type="button"
            >
              סגור מצלמה
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 p-4 space-y-4">
          {/* Store */}
          <div>
            <label htmlFor="vf-store" className="text-sm font-medium text-gray-700 mb-1 block">שם חנות *</label>
            <div className="relative">
              <input
                id="vf-store"
                type="text"
                value={storeSearch}
                onChange={e => { setStoreSearch(e.target.value); setStoreName(e.target.value); setShowStoreDropdown(true) }}
                onFocus={() => setShowStoreDropdown(true)}
                placeholder="חפש או הזן שם חנות"
                aria-autocomplete="list"
                aria-expanded={showStoreDropdown && !!storeSearch}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              {showStoreDropdown && storeSearch && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100 rounded-2xl shadow-lg max-h-48 overflow-y-auto">
                  {filteredStores.slice(0, 6).map(s => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setStoreName(s.name); setStoreSearch(s.name); setShowStoreDropdown(false) }}
                      className="w-full text-right px-4 py-2.5 text-sm hover:bg-gray-50 border-b last:border-0"
                    >
                      {s.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleAddStore}
                    className="w-full text-right px-4 py-2.5 text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    הוסף "{storeSearch}" כחנות חדשה
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Amount + Balance / Usage */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="vf-amount" className="text-sm font-medium text-gray-700 mb-1 block">סכום מקורי (₪)</label>
              <input
                id="vf-amount"
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
            </div>
            {voucher ? (
              <div>
                <label htmlFor="vf-usage" className="text-sm font-medium text-gray-700 mb-1 block">סכום שימוש (₪)</label>
                <input
                  id="vf-usage"
                  type="number"
                  value={usageAmount}
                  onChange={e => setUsageAmount(e.target.value)}
                  placeholder="0"
                  min="0"
                  max={voucher.balance}
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  dir="ltr"
                />
                {(() => {
                  const used = parseFloat(usageAmount) || 0
                  const newBal = Math.max(0, (voucher.balance ?? 0) - used)
                  return used > 0 ? (
                    <p className={`text-xs mt-1 font-medium ${newBal <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                      יתרה חדשה: ₪{newBal.toLocaleString('he-IL')}
                    </p>
                  ) : (
                    <p className="text-xs mt-1 text-gray-400">יתרה: ₪{(voucher.balance ?? 0).toLocaleString('he-IL')}</p>
                  )
                })()}
                {(parseFloat(usageAmount) || 0) > 0 && (
                  <input
                    type="text"
                    value={storeUsedInput}
                    onChange={e => setStoreUsedInput(e.target.value)}
                    placeholder="באיזה חנות? (אופציונלי)"
                    className="w-full mt-2 px-4 py-2.5 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    dir="rtl"
                  />
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="vf-balance" className="text-sm font-medium text-gray-700 mb-1 block">יתרה (₪)</label>
                <input
                  id="vf-balance"
                  type="number"
                  value={balance}
                  onChange={e => setBalance(e.target.value)}
                  placeholder="0"
                  max={parseFloat(amount) > 0 ? amount : undefined}
                  className={`w-full px-4 py-3 border rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 ${
                    parseFloat(amount) > 0 && parseFloat(balance) > parseFloat(amount)
                      ? 'border-red-400 bg-red-50'
                      : 'border-gray-200'
                  }`}
                  dir="ltr"
                />
                {parseFloat(amount) > 0 && parseFloat(balance) > parseFloat(amount) && (
                  <p className="text-xs mt-1 text-red-500">לא יכולה לעלות על הסכום המקורי</p>
                )}
              </div>
            )}
          </div>

          {/* Value percent — only if feature enabled */}
          {showVoucherValue && (
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">ערך שוק (%)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={valuePercent}
                  onChange={e => setValuePercent(e.target.value)}
                  placeholder="למשל 90"
                  min="1"
                  max="100"
                  className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  dir="ltr"
                />
                <span className="text-sm text-gray-500 shrink-0">%</span>
              </div>
              {valuePercent && parseFloat(valuePercent) > 0 && parseFloat(valuePercent) < 100 && (
                <p className="text-xs mt-1 text-gray-400">
                  (ערך {(100 - parseFloat(valuePercent)).toFixed(0)}% פחות מהנקוב)
                </p>
              )}
            </div>
          )}

          {/* Code + Camera */}
          <div>
            <label htmlFor="vf-code" className="text-sm font-medium text-gray-700 mb-1 block">קוד שובר *</label>
            <div className="flex gap-2">
              <input
                id="vf-code"
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                placeholder="הזן קוד שובר"
                className="flex-1 px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 font-mono"
                dir="ltr"
              />
              <button
                type="button"
                onClick={showScanner ? stopScanner : startScanner}
                aria-label={showScanner ? 'סגור מצלמה' : 'סרוק ברקוד / QR'}
                className={`px-3 py-3 rounded-2xl border transition-colors ${showScanner ? 'bg-red-50 border-red-200 text-red-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
              >
                <Camera className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* CVV + Expiry */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor="vf-cvv" className="text-sm font-medium text-gray-700 mb-1 block">CVV</label>
              <input
                id="vf-cvv"
                type="text"
                value={cvv}
                onChange={e => setCvv(e.target.value)}
                placeholder="אופציונלי"
                className="w-full px-3 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 font-mono"
                dir="ltr"
              />
            </div>
            <div className="col-span-2">
              <label htmlFor="vf-expiry" className="text-sm font-medium text-gray-700 mb-1 block">תאריך תפוגה</label>
              <input
                id="vf-expiry"
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                className="w-full px-2 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
              <div className="flex gap-1.5 mt-1.5">
                {[{ label: '+1y', years: 1 }, { label: '+2y', years: 2 }, { label: '+5y', years: 5 }].map(({ label, years }) => (
                  <button
                    key={years}
                    type="button"
                    onClick={() => {
                      const d = new Date()
                      d.setFullYear(d.getFullYear() + years)
                      setExpiryDate(d.toISOString().split('T')[0])
                    }}
                    className="flex-1 py-1 text-xs font-medium bg-gray-100 text-gray-600 rounded-xl hover:bg-green-100 hover:text-green-700 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Source */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">מקור שובר</label>
            <input
              type="text"
              value={source}
              onChange={e => setSource(e.target.value)}
              placeholder="לדוגמה: קיבלתי כמתנה, נקנה בחנות, תוכנית נאמנות..."
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>

          {/* Link */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5 block">
              <Link className="w-3.5 h-3.5" />
              קישור לשובר/לבדיקת יתרה
            </label>
            <input
              type="url"
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder="https://..."
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
              dir="ltr"
            />
          </div>

          {/* Categories */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">קטגוריות</label>
            <div className="flex flex-wrap gap-2">
              {categories.map(cat => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCat(cat.name)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedCats.includes(cat.name)
                      ? 'bg-green-100 text-green-700 border-2 border-green-400'
                      : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                  }`}
                >
                  {cat.emoji} {cat.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCatInput(!showCatInput)}
                className="px-3 py-1.5 rounded-full text-xs font-medium bg-gray-50 text-gray-500 border-2 border-dashed border-gray-300 hover:bg-gray-100"
              >
                <Plus className="w-3.5 h-3.5 inline" /> הוסף קטגוריה
              </button>
            </div>
            {showCatInput && (
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newCatName}
                  onChange={e => setNewCatName(e.target.value)}
                  placeholder="שם קטגוריה חדשה"
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                <button
                  type="button"
                  onClick={handleAddCat}
                  className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm font-medium"
                >
                  הוסף
                </button>
              </div>
            )}
          </div>

          {/* Tags with autocomplete */}
          <div className="relative">
            <label className="text-sm font-medium text-gray-700 mb-1 block flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" />
              תגיות (מופרדות בפסיק)
            </label>
            <input
              type="text"
              value={tags}
              onChange={e => { setTags(e.target.value); setShowTagSuggestions(true) }}
              onFocus={() => setShowTagSuggestions(true)}
              onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
              placeholder="מתנה, יום הולדת, קיץ..."
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            {showTagSuggestions && tagSuggestions.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-white border border-gray-100 rounded-2xl shadow-lg overflow-hidden">
                {tagSuggestions.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onMouseDown={() => addTagSuggestion(tag)}
                    className="w-full text-right px-4 py-2 text-sm hover:bg-gray-50 border-b last:border-0 flex items-center gap-2"
                  >
                    <Tag className="w-3 h-3 text-gray-400" />
                    {tag}
                  </button>
                ))}
              </div>
            )}
            {/* Existing tags as chips */}
            {existingTags.length > 0 && currentTagInput === '' && (
              <div className="flex flex-wrap gap-1 mt-2">
                {existingTags.filter(t => !addedTagsList.includes(t)).slice(0, 8).map(tag => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      const current = tags.trim()
                      setTags(current ? current + ', ' + tag + ', ' : tag + ', ')
                    }}
                    className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full hover:bg-gray-200"
                  >
                    +{tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">הערות</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="הערות נוספות..."
              rows={3}
              className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
            />
          </div>

        </form>

        {/* Footer */}
        <div className="p-4 border-t safe-area-bottom">
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3.5 rounded-2xl font-semibold shadow-md hover:shadow-lg transition-all disabled:opacity-70"
          >
            {loading ? 'שומר...' : voucher ? 'שמור שינויים' : 'הוסף שובר'}
          </button>
        </div>
      </div>
    </div>
  )
}
