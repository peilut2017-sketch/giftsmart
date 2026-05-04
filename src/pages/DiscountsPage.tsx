import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Search, X, Percent, Settings2, Loader2 } from 'lucide-react'
import { useDiscounts } from '../contexts/DiscountsContext'
import { useT } from '../lib/i18n'
import DealCard from '../components/DealCard'

const ALL_TAGS = [
  'מסעדות', 'קפה', 'קניות', 'אופנה', 'סופר', 'בריאות',
  'בידור', 'ילדים', 'נסיעות', 'אלקטרוניקה', 'יופי', 'ספורט',
]

export default function DiscountsPage() {
  const { t } = useT()
  const navigate = useNavigate()
  const {
    deals,
    userClubIds,
    loading,
    searchQuery,
    activeTags,
    myOnly,
    fetchDeals,
    fetchClubs,
    setSearchQuery,
    setActiveTags,
    setMyOnly,
  } = useDiscounts()

  const [localSearch, setLocalSearch] = useState(searchQuery)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load on mount
  useEffect(() => {
    fetchClubs()
    fetchDeals(searchQuery || undefined, activeTags.length > 0 ? activeTags : undefined, myOnly)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search
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
        <button
          onClick={() => navigate('/settings')}
          className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label={t('settings.my_clubs')}
        >
          <Settings2 className="w-5 h-5 text-gray-500" />
        </button>
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
            <button
              onClick={clearSearch}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
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
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visibleDeals.map(deal => (
              <DealCard key={deal.deal_id} deal={deal} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
