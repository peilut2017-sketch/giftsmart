import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Search, X, Percent, Settings2, Loader2, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n'
import DealCard from '../components/DealCard'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

const ALL_TAGS = [
  'מסעדות', 'קפה', 'קניות', 'אופנה', 'סופר', 'בריאות',
  'בידור', 'ילדים', 'נסיעות', 'אלקטרוניקה', 'יופי', 'ספורט',
]

const DISCOUNT_TYPES = [
  { value: 'percent',   label: 'אחוז (%)' },
  { value: 'fixed',     label: 'סכום קבוע (₪)' },
  { value: 'free_item', label: 'פריט חינם' },
  { value: 'other',     label: 'אחר' },
] as const

// ── Submit Deal Modal ────────────────────────────────────────────────────────
function SubmitDealModal({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  useBodyScrollLock()

  const [form, setForm] = useState({
    club_name: '', business_name: '', title: '',
    description: '', discount_type: 'percent' as 'percent' | 'fixed' | 'free_item' | 'other',
    discount_value: '', promo_code: '', external_link: '',
    tags: '', start_date: '', expiration_date: '',
  })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  async function handleSubmit() {
    if (!form.club_name.trim() || !form.business_name.trim() || !form.title.trim()) {
      toast.error('מועדון, עסק וכותרת הם שדות חובה'); return
    }
    setSending(true)
    try {
      const tagsArr = form.tags.split(',').map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.rpc('submit_discount_deal', {
        p_club_name:       form.club_name.trim(),
        p_business_name:   form.business_name.trim(),
        p_title:           form.title.trim(),
        p_description:     form.description.trim() || null,
        p_discount_type:   form.discount_type,
        p_discount_value:  form.discount_value ? Number(form.discount_value) : null,
        p_promo_code:      form.promo_code.trim() || null,
        p_external_link:   form.external_link.trim() || null,
        p_tags:            tagsArr,
        p_start_date:      form.start_date || null,
        p_expiration_date: form.expiration_date || null,
      })
      if (error) throw error
      setSent(true)
    } catch (e: any) {
      toast.error(e.message || t('app.error'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-3xl w-full max-w-2xl flex flex-col max-h-[92dvh]"
        onClick={e => e.stopPropagation()}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t('discounts.submit.title')}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {sent ? (
          /* Success state */
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center gap-4">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center text-3xl">✅</div>
            <p className="font-semibold text-gray-800 dark:text-white text-lg">{t('discounts.submit.sent')}</p>
            <button onClick={onClose} className="mt-2 px-6 py-2.5 bg-green-600 text-white rounded-2xl text-sm font-semibold">
              {t('app.close')}
            </button>
          </div>
        ) : (
          <>
            {/* Scrollable body */}
            <div className="overflow-y-auto flex-1 px-5 pb-4 space-y-3">
              <p className="text-sm text-gray-500 dark:text-gray-400">{t('discounts.submit.sub')}</p>

              {/* Required fields */}
              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                  {t('discounts.submit.club')} *
                </label>
                <input
                  className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="לדוגמה: ויזה כאל / מועדון YES"
                  value={form.club_name}
                  onChange={e => setForm(f => ({ ...f, club_name: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                  {t('discounts.submit.business')} *
                </label>
                <input
                  className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="לדוגמה: ארומה / זארה / שופרסל"
                  value={form.business_name}
                  onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1 block">
                  תיאור ההנחה *
                </label>
                <input
                  className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  placeholder="לדוגמה: 20% הנחה על כל הקנייה לחברי ויזה כאל"
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                />
              </div>

              {/* Discount type + value */}
              <div className="flex gap-2">
                <select
                  className="flex-1 border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                  value={form.discount_type}
                  onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as typeof form.discount_type }))}
                >
                  {DISCOUNT_TYPES.map(dt => (
                    <option key={dt.value} value={dt.value}>{dt.label}</option>
                  ))}
                </select>
                {(form.discount_type === 'percent' || form.discount_type === 'fixed') && (
                  <input
                    type="number" min="0"
                    className="w-24 border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                    placeholder={form.discount_type === 'percent' ? '%' : '₪'}
                    value={form.discount_value}
                    onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))}
                    dir="ltr"
                  />
                )}
              </div>

              {/* Promo code */}
              <input
                className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                placeholder="קוד פרומו (אם יש)"
                value={form.promo_code}
                onChange={e => setForm(f => ({ ...f, promo_code: e.target.value }))}
                dir="ltr"
              />

              {/* Advanced toggle */}
              <button
                type="button"
                onClick={() => setShowAdvanced(v => !v)}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                פרטים נוספים (תיאור, קישור, תאריכים, תגיות)
              </button>

              {showAdvanced && (
                <div className="space-y-3 pt-1">
                  <textarea
                    className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400 resize-none h-20"
                    placeholder="תיאור מפורט (אופציונלי)"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  />
                  <input
                    className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                    placeholder="קישור לעמוד ההנחה (אופציונלי)"
                    value={form.external_link}
                    onChange={e => setForm(f => ({ ...f, external_link: e.target.value }))}
                    dir="ltr"
                  />
                  <input
                    className="w-full border dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm bg-white dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-400"
                    placeholder="תגיות (קפה, מסעדה, אופנה...)"
                    value={form.tags}
                    onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">תאריך התחלה</label>
                      <input type="date" className="w-full border dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">תאריך תפוגה</label>
                      <input type="date" className="w-full border dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 dark:text-white" value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Sticky footer */}
            <div className="px-5 pb-6 pt-3 shrink-0 border-t border-gray-100 dark:border-gray-700">
              <button
                onClick={handleSubmit}
                disabled={sending || !form.club_name.trim() || !form.business_name.trim() || !form.title.trim()}
                className="w-full py-3 bg-green-600 text-white rounded-2xl font-semibold text-sm disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {sending
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <Plus className="w-4 h-4" />
                }
                {t('discounts.submit')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function DiscountsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const location = useLocation()
  const targetDealId = (location.state as { dealId?: string } | null)?.dealId
  const { user } = useAuth()
  const {
    deals, userClubIds, loading,
    searchQuery, activeTags, myOnly,
    fetchDeals, fetchClubs,
    setSearchQuery, setActiveTags, setMyOnly,
  } = useDiscounts()

  const [localSearch, setLocalSearch] = useState(searchQuery)
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    fetchClubs()
    fetchDeals(searchQuery || undefined, activeTags.length > 0 ? activeTags : undefined, myOnly)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to and expand a specific deal when arriving from search results
  useEffect(() => {
    if (!targetDealId || loading) return
    const el = document.getElementById(`deal-${targetDealId}`)
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150)
  }, [targetDealId, loading])

  function handleSearch(value: string) {
    setLocalSearch(value)
    setSearchQuery(value)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      fetchDeals(value || undefined, activeTags.length > 0 ? activeTags : undefined, myOnly)
    }, 350)
  }

  function clearSearch() {
    setLocalSearch('')
    setSearchQuery('')
    fetchDeals(undefined, activeTags.length > 0 ? activeTags : undefined, myOnly)
  }

  function toggleTag(tag: string) {
    const next = activeTags.includes(tag)
      ? activeTags.filter(t => t !== tag)
      : [...activeTags, tag]
    setActiveTags(next)
    fetchDeals(localSearch || undefined, next.length > 0 ? next : undefined, myOnly)
  }

  function switchTab(mine: boolean) {
    setMyOnly(mine)
    fetchDeals(localSearch || undefined, activeTags.length > 0 ? activeTags : undefined, mine)
  }

  const hasNoClubs = userClubIds.length === 0

  const visibleDeals = useMemo(() => {
    if (myOnly) return deals.filter(d => d.is_my_club)
    return deals
  }, [deals, myOnly])

  return (
    <div className="flex flex-col min-h-0 flex-1" dir="rtl">
      {/* ── Header ── */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5 text-green-600" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">{t('discounts.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-300 border border-green-200 dark:border-green-700 px-3 py-1.5 rounded-full"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('discounts.submit')}
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label={t('settings.my_clubs')}
          >
            <Settings2 className="w-5 h-5 text-gray-500" />
          </button>
        </div>
      </div>

      {/* ── Search bar ── */}
      <div className="px-4 mb-3">
        <div className="relative">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={localSearch}
            onChange={e => handleSearch(e.target.value)}
            placeholder={t('discounts.search.placeholder')}
            className="w-full bg-gray-100 dark:bg-gray-700 border-none rounded-2xl py-2.5 pr-9 pl-9 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-400"
          />
          {localSearch && (
            <button onClick={clearSearch} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Tag chips ── */}
      <div className="px-4 mb-3 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {ALL_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                activeTags.includes(tag)
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-green-400'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* ── No-clubs prompt ── */}
      {hasNoClubs && (
        <div className="mx-4 mb-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-amber-800 dark:text-amber-200 leading-snug flex-1">
            {t('discounts.setup_clubs')}
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="shrink-0 text-xs font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-800/40 px-3 py-1.5 rounded-lg"
          >
            {t('discounts.setup_clubs.cta')}
          </button>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="px-4 mb-4 flex gap-1 bg-gray-100 dark:bg-gray-700/50 rounded-2xl p-1">
        <button
          onClick={() => switchTab(false)}
          className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
            !myOnly
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {t('discounts.all_tab')}
        </button>
        <button
          onClick={() => switchTab(true)}
          className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
            myOnly
              ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm'
              : 'text-gray-500 dark:text-gray-400'
          }`}
        >
          {t('discounts.my_tab')}
          {userClubIds.length > 0 && (
            <span className="ms-1.5 inline-flex items-center justify-center w-4 h-4 bg-green-500 text-white text-[9px] font-bold rounded-full">
              ✓
            </span>
          )}
        </button>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-green-500" />
          </div>
        ) : visibleDeals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <Percent className="w-7 h-7 text-gray-300" />
            </div>
            <p className="font-semibold text-gray-700 dark:text-gray-300">{t('discounts.no_deals')}</p>
            <p className="text-sm text-gray-400">{t('discounts.no_deals.sub')}</p>
            {user && (
              <button
                onClick={() => setShowSubmitModal(true)}
                className="mt-2 flex items-center gap-2 text-sm font-semibold text-green-600 bg-green-50 border border-green-200 px-4 py-2.5 rounded-2xl"
              >
                <Plus className="w-4 h-4" />
                {t('discounts.submit')}
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleDeals.map(deal => (
              <DealCard key={deal.deal_id} deal={deal} initiallyExpanded={deal.deal_id === targetDealId} />
            ))}
          </div>
        )}
      </div>

      {/* ── Submit modal ── */}
      {showSubmitModal && <SubmitDealModal onClose={() => setShowSubmitModal(false)} />}
    </div>
  )
}
