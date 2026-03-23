import { useState, useMemo, useRef } from 'react'
import type { Voucher } from '../types'
import { useVouchers } from '../contexts/VoucherContext'
import { defaultExpiryDate } from '../utils/helpers'
import { extractFromSMS } from '../utils/smsExtractor'
import { X, Clipboard, Plus, Camera, Tag, Link, ImagePlus } from 'lucide-react'
import toast from 'react-hot-toast'
import { Html5Qrcode } from 'html5-qrcode'

interface Props {
  voucher?: Voucher
  onClose: () => void
  onSave: (v: any) => void
}

export default function VoucherForm({ voucher, onClose, onSave }: Props) {
  const { categories, stores, superVouchers, addStore, addCategory, vouchers, archivedVouchers } = useVouchers()

  const [storeName, setStoreName] = useState(voucher?.store_name || '')
  const [storeSearch, setStoreSearch] = useState(voucher?.store_name || '')
  const [showStoreDropdown, setShowStoreDropdown] = useState(false)
  const [amount, setAmount] = useState(voucher?.amount?.toString() || '')
  const [balance, setBalance] = useState(voucher?.balance?.toString() || '')
  const [usageAmount, setUsageAmount] = useState('')
  const [code, setCode] = useState(voucher?.code || '')
  const [cvv, setCvv] = useState(voucher?.cvv || '')
  const [expiryDate, setExpiryDate] = useState(voucher?.expiry_date || defaultExpiryDate())
  const [selectedCats, setSelectedCats] = useState<string[]>(voucher?.categories || [])
  const [tags, setTags] = useState(voucher?.tags?.join(', ') || '')
  const [notes, setNotes] = useState(voucher?.notes || '')
  const [link, setLink] = useState(voucher?.link || '')
  const [newCatName, setNewCatName] = useState('')
  const [showCatInput, setShowCatInput] = useState(false)
  const [showSMSInput, setShowSMSInput] = useState(false)
  const [smsText, setSmsText] = useState('')
  const [loading, setLoading] = useState(false)
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [ocrLoading, setOcrLoading] = useState(false)
  const scannerRef = useRef<Html5Qrcode | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
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

  async function handleImageOCR(file: File) {
    if (!file.type.startsWith('image/')) return toast.error('יש לבחור קובץ תמונה')
    setOcrLoading(true)
    const toastId = toast.loading('מנתח תמונה... (עד 15 שניות)')
    try {
      // Lazy-load Tesseract to avoid bloating the main bundle
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

      const extracted = extractFromSMS(text)
      let found = 0
      if (extracted.store_name) { setStoreName(extracted.store_name); setStoreSearch(extracted.store_name); found++ }
      if (extracted.amount) { setAmount(extracted.amount.toString()); if (!balance) setBalance(extracted.amount.toString()); found++ }
      if (extracted.code) { setCode(extracted.code); found++ }
      if (extracted.cvv) { setCvv(extracted.cvv); found++ }
      if (extracted.expiry_date) { setExpiryDate(extracted.expiry_date); found++ }

      toast.dismiss(toastId)
      if (found > 0) toast.success(`חולצו ${found} פרטים מהתמונה`)
      else toast('זוהה טקסט אך לא נמצאו פרטי שובר — נסה תמונה ברורה יותר', { icon: '🔍' })
    } catch (err) {
      toast.dismiss(toastId)
      toast.error('שגיאה בניתוח התמונה')
    } finally {
      setOcrLoading(false)
    }
  }

  function handleSMSExtract() {
    const extracted = extractFromSMS(smsText)
    if (extracted.store_name) { setStoreName(extracted.store_name); setStoreSearch(extracted.store_name) }
    if (extracted.amount) { setAmount(extracted.amount.toString()); if (!balance) setBalance(extracted.amount.toString()) }
    if (extracted.code) setCode(extracted.code)
    if (extracted.cvv) setCvv(extracted.cvv)
    if (extracted.expiry_date) setExpiryDate(extracted.expiry_date)
    setShowSMSInput(false)
    toast.success('פרטים חולצו בהצלחה!')
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
        amount: parseFloat(amount) || 0,
        balance: newBalance,
        code: code.trim(),
        cvv: cvv.trim() || undefined,
        expiry_date: expiryDate || undefined,
        categories: selectedCats,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        notes: notes.trim() || undefined,
        link: link.trim() || undefined,
        is_archived: false,
        is_shared: false,
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
              <Clipboard className="w-3.5 h-3.5" /> הדבק SMS
            </button>
            <button
              type="button"
              disabled={ocrLoading}
              onClick={() => imageInputRef.current?.click()}
              className="flex items-center gap-1 text-xs bg-purple-50 text-purple-600 px-3 py-1.5 rounded-full font-medium disabled:opacity-50"
              title="העלה תמונה של השובר"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              {ocrLoading ? 'מנתח...' : 'סרוק תמונה'}
            </button>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleImageOCR(f); e.target.value = '' }}
            />
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
              disabled={!smsText.trim()}
              className="mt-2 w-full bg-blue-500 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-50"
              type="button"
            >
              חלץ פרטים
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
            <label className="text-sm font-medium text-gray-700 mb-1 block">שם חנות *</label>
            <div className="relative">
              <input
                type="text"
                value={storeSearch}
                onChange={e => { setStoreSearch(e.target.value); setStoreName(e.target.value); setShowStoreDropdown(true) }}
                onFocus={() => setShowStoreDropdown(true)}
                placeholder="חפש או הזן שם חנות"
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
              <label className="text-sm font-medium text-gray-700 mb-1 block">סכום מקורי (₪)</label>
              <input
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
                <label className="text-sm font-medium text-gray-700 mb-1 block">סכום שימוש (₪)</label>
                <input
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
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1 block">יתרה (₪)</label>
                <input
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

          {/* Code + Camera */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 block">קוד שובר *</label>
            <div className="flex gap-2">
              <input
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
                className={`px-3 py-3 rounded-2xl border transition-colors ${showScanner ? 'bg-red-50 border-red-200 text-red-500' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
                title="סרוק ברקוד/QR"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* CVV */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">CVV / קוד אבטחה</label>
              <input
                type="text"
                value={cvv}
                onChange={e => setCvv(e.target.value)}
                placeholder="אופציונלי"
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 font-mono"
                dir="ltr"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700 mb-1 block">תאריך תפוגה</label>
              <input
                type="date"
                value={expiryDate}
                onChange={e => setExpiryDate(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                dir="ltr"
              />
            </div>
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

          {/* Link */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1.5 block">
              <Link className="w-3.5 h-3.5" />
              קישור לשובר
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
