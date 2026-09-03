import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useAuth } from '../contexts/AuthContext'
import { useT } from '../lib/i18n'
import DealCard from '../components/DealCard'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import Icon from '../components/ui/Icon'
import Button from '../components/ui/Button'
import BottomSheet from '../components/ui/BottomSheet'
import { usePageView } from '../hooks/usePageView'

const ALL_TAGS = [
  'מסעדות', 'קפה', 'קניות', 'אופנה', 'סופר', 'בריאות',
  'בידור', 'ילדים', 'נסיעות', 'אלקטרוניקה', 'יופי', 'ספורט',
]

const DISCOUNT_TYPES = [
  { value: 'percent',   labelKey: 'deals.type.percent' },
  { value: 'fixed',     labelKey: 'deals.type.fixed' },
  { value: 'free_item', labelKey: 'discounts.free_item' },
  { value: 'other',     labelKey: 'deal.report.reason.other' },
] as const

// ── Submit Deal Modal ────────────────────────────────────────────────────────
function SubmitDealModal({ onClose }: { onClose: () => void }) {
  const { t } = useT()

  const [form, setForm] = useState({
    club_name: '', business_name: '', title: '',
    description: '', discount_type: 'percent' as 'percent' | 'fixed' | 'free_item' | 'other',
    discount_value: '', promo_code: '', external_link: '',
    tags: '', start_date: '', expiration_date: '',
  })
  const MAX_DEAL_IMAGE_BYTES = 5 * 1024 * 1024
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  async function handleSubmit() {
    if (!form.club_name.trim() || !form.business_name.trim() || !form.title.trim()) {
      toast.error(t('deals.submit.required')); return
    }
    setSending(true)
    try {
      const tagsArr = form.tags.split(',').map(s => s.trim()).filter(Boolean)

      // Upload image first if one was selected
      let uploadedImageUrl: string | null = null
      if (imageFile) {
        const ext = imageFile.name.split('.').pop() || 'jpg'
        const path = `${Date.now()}.${ext}`
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('discount-images')
          .upload(path, imageFile, { cacheControl: '3600', upsert: false })
        if (uploadError) throw uploadError
        const { data: { publicUrl } } = supabase.storage.from('discount-images').getPublicUrl(uploadData.path)
        uploadedImageUrl = publicUrl
      }

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
        p_image_url:       uploadedImageUrl,
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
    <BottomSheet open onClose={onClose} title={sent ? undefined : t('discounts.submit.title')} className="max-h-[92dvh]">
      {sent ? (
        <div className="flex flex-col items-center justify-center py-8 text-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center text-primary">
            <Icon name="check_circle" size={36} filled />
          </div>
          <p className="font-semibold text-text text-lg">{t('discounts.submit.sent')}</p>
          <Button onClick={onClose}>{t('app.close')}</Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-text3">{t('discounts.submit.sub')}</p>

          <div>
            <label className="text-xs font-semibold text-text2 mb-1 block">{t('discounts.submit.club')} *</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={t('deals.submit.club.ph')}
              value={form.club_name}
              onChange={e => setForm(f => ({ ...f, club_name: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text2 mb-1 block">{t('discounts.submit.business')} *</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={t('deals.submit.business.ph')}
              value={form.business_name}
              onChange={e => setForm(f => ({ ...f, business_name: e.target.value }))}
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-text2 mb-1 block">{t('deals.submit.deal_title')} *</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              placeholder={t('deals.submit.deal_title.ph')}
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          {/* min-w-0 on the flex/grid children throughout this form: form controls
              (especially <select> and <input type="date">) have an intrinsic minimum
              width larger than their container, and flex/grid items default to
              min-width:auto — so without this they refuse to shrink and push the whole
              sheet wider than the viewport. */}
          <div className="flex gap-2">
            <select
              className="flex-1 min-w-0 border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={form.discount_type}
              onChange={e => setForm(f => ({ ...f, discount_type: e.target.value as typeof form.discount_type }))}
            >
              {DISCOUNT_TYPES.map(dt => (
                <option key={dt.value} value={dt.value}>{t(dt.labelKey)}</option>
              ))}
            </select>
            {(form.discount_type === 'percent' || form.discount_type === 'fixed') && (
              <input
                type="number" inputMode="decimal" min="0"
                className="w-24 shrink-0 border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={form.discount_type === 'percent' ? '%' : '₪'}
                value={form.discount_value}
                onChange={e => setForm(f => ({ ...f, discount_value: e.target.value }))}
                dir="ltr"
              />
            )}
          </div>

          <input
            className="w-full border border-border rounded-xl px-3 py-2.5 text-sm font-mono tracking-widest bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            placeholder={t('deals.submit.promo.ph')}
            value={form.promo_code}
            onChange={e => setForm(f => ({ ...f, promo_code: e.target.value }))}
            dir="ltr"
          />

          <div>
            <label className="text-xs font-semibold text-text2 mb-1 block">
              {t('deals.submit.image')} <span className="font-normal text-text3">{t('deals.optional')}</span>
            </label>
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl py-4 cursor-pointer hover:border-primary transition-colors">
              {imagePreview ? (
                <div className="w-full relative">
                  <img src={imagePreview} alt={t('deals.submit.image.preview')} className="w-full max-h-40 object-cover rounded-lg" />
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); setImageFile(null); setImagePreview(null) }}
                    className="absolute top-1 left-1 bg-surface rounded-full p-1 shadow text-text3"
                  >
                    <Icon name="close" size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Icon name="add" size={20} color="var(--c-text3)" />
                  <span className="text-xs text-text3 mt-1">{t('deals.submit.image.upload')}</span>
                </>
              )}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (!f) return
                  // accept="image/*" is only a picker hint — validate for real.
                  // Uploads land in a PUBLIC bucket and count against storage +
                  // egress quota, so reject non-images and oversized files.
                  if (!f.type.startsWith('image/')) { toast.error(t('deals.submit.image.invalid')); return }
                  if (f.size > MAX_DEAL_IMAGE_BYTES) { toast.error(t('deals.submit.image.too.large')); return }
                  setImageFile(f)
                  setImagePreview(URL.createObjectURL(f))
                }}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="flex items-center gap-1 text-xs text-text3"
          >
            <Icon name={showAdvanced ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={14} />
            {t('deals.submit.advanced')}
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-1">
              <textarea
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none h-20"
                placeholder={t('deals.submit.desc.ph')}
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
              <input
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={t('deals.submit.link.ph')}
                value={form.external_link}
                onChange={e => setForm(f => ({ ...f, external_link: e.target.value }))}
                dir="ltr"
              />
              <input
                className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                placeholder={t('deals.submit.tags.ph')}
                value={form.tags}
                onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="min-w-0">
                  <label className="text-xs text-text3 mb-1 block">{t('discounts.start.date')}</label>
                  <input type="date" className="w-full min-w-0 border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                </div>
                <div className="min-w-0">
                  <label className="text-xs text-text3 mb-1 block">{t('deals.submit.expiry')}</label>
                  <input type="date" className="w-full min-w-0 border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text" value={form.expiration_date} onChange={e => setForm(f => ({ ...f, expiration_date: e.target.value }))} />
                </div>
              </div>
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={sending || !form.club_name.trim() || !form.business_name.trim() || !form.title.trim()}
            loading={sending}
            fullWidth
          >
            <Icon name="add" size={16} />
            {t('discounts.submit')}
          </Button>
        </div>
      )}
    </BottomSheet>
  )
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function DiscountsPage() {
  const { t } = useT()
  usePageView('discounts')
  const navigate = useNavigate()
  const location = useLocation()
  const targetDealId = (location.state as { dealId?: string } | null)?.dealId
  const { user } = useAuth()
  const {
    deals, userClubIds, likedDealIds, loading,
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
    let list = myOnly
      ? deals.filter(d => d.is_my_club || likedDealIds.has(d.deal_id))
      : deals
    // Liked deals appear first
    if (likedDealIds.size > 0) {
      list = [
        ...list.filter(d => likedDealIds.has(d.deal_id)),
        ...list.filter(d => !likedDealIds.has(d.deal_id)),
      ]
    }
    return list
  }, [deals, myOnly, likedDealIds])

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-bg" dir="rtl">
      {/* Header */}
      <div className="px-4 pt-5 pb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="percent" size={20} color="var(--c-primary)" />
          <h1 className="text-xl font-bold text-text">{t('discounts.title')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <button
              onClick={() => setShowSubmitModal(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-primary bg-primary-light border border-primary/20 px-3 py-1.5 rounded-full"
            >
              <Icon name="add" size={14} />
              {t('discounts.submit')}
            </button>
          )}
          <button
            onClick={() => navigate('/settings')}
            className="p-2 rounded-full bg-bg text-text3"
            aria-label={t('settings.my_clubs')}
          >
            <Icon name="tune" size={20} />
          </button>
        </div>
      </div>

      {/* Search bar */}
      <div className="px-4 mb-3">
        <div className="flex items-center gap-2 bg-surface rounded-full px-3.5 border border-border">
          <Icon name="search" size={16} color="var(--c-text3)" />
          <input
            type="text"
            value={localSearch}
            onChange={e => handleSearch(e.target.value)}
            placeholder={t('discounts.search.placeholder')}
            className="flex-1 h-10 bg-transparent border-none outline-none text-[15px] text-text placeholder:text-text3"
          />
          {localSearch && (
            <button onClick={clearSearch} className="text-text3">
              <Icon name="close" size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Tag chips */}
      <div className="px-4 mb-3 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {ALL_TAGS.map(tag => (
            <button
              key={tag}
              onClick={() => toggleTag(tag)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors whitespace-nowrap ${
                activeTags.includes(tag)
                  ? 'bg-primary text-white border-primary'
                  : 'bg-surface text-text2 border-border'
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* No-clubs prompt */}
      {hasNoClubs && (
        <div className="mx-4 mb-3 bg-warning/10 border border-warning/30 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-sm text-warning leading-snug flex-1">{t('discounts.setup_clubs')}</p>
          <button
            onClick={() => navigate('/settings')}
            className="shrink-0 text-xs font-bold text-warning bg-warning/15 px-3 py-1.5 rounded-lg"
          >
            {t('discounts.setup_clubs.cta')}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="px-4 mb-4 flex gap-1 bg-surface rounded-2xl p-1 border border-border">
        <button
          onClick={() => switchTab(false)}
          className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
            !myOnly ? 'bg-bg text-text shadow-card' : 'text-text3'
          }`}
        >
          {t('discounts.all_tab')}
        </button>
        <button
          onClick={() => switchTab(true)}
          className={`flex-1 py-2 text-sm font-semibold rounded-xl transition-colors ${
            myOnly ? 'bg-bg text-text shadow-card' : 'text-text3'
          }`}
        >
          {t('discounts.my_tab')}
          {userClubIds.length > 0 && (
            <span className="ms-1.5 inline-flex items-center justify-center w-4 h-4 bg-primary text-white text-[9px] font-bold rounded-full">
              ✓
            </span>
          )}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Icon name="progress_activity" size={32} color="var(--c-primary)" className="animate-spin" />
          </div>
        ) : visibleDeals.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
            <div className="w-16 h-16 rounded-full bg-surface border border-border flex items-center justify-center">
              <Icon name="percent" size={28} color="var(--c-border)" />
            </div>
            <p className="font-semibold text-text2">{t('discounts.no_deals')}</p>
            <p className="text-sm text-text3">{t('discounts.no_deals.sub')}</p>
            {user && (
              <Button variant="secondary" size="sm" onClick={() => setShowSubmitModal(true)}>
                <Icon name="add" size={14} />
                {t('discounts.submit')}
              </Button>
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

      {showSubmitModal && <SubmitDealModal onClose={() => setShowSubmitModal(false)} />}
    </div>
  )
}
