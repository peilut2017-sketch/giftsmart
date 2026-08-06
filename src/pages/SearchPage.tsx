import { useState, useMemo, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useVouchers } from '../contexts/VoucherContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useE2EE } from '../contexts/E2EEContext'
import { useT } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { formatCurrency, formatDate, getDaysUntilExpiry } from '../utils/helpers'
import VoucherCard from '../components/VoucherCard'
import VoucherForm from '../components/VoucherForm'
import InStoreMode from '../components/InStoreMode'
import ConfirmDialog from '../components/ConfirmDialog'
import Icon from '../components/ui/Icon'
import { usePageView } from '../hooks/usePageView'
import type { Voucher, DiscountDeal } from '../types'
import toast from 'react-hot-toast'

type SortKey = 'expiry' | 'balance' | 'store' | 'added'
type FilterTab = 'all' | 'expiring' | 'shared' | 'shared_with_me'
type ViewMode = 'grid' | 'rows'
type SortDir = 'asc' | 'desc'

const EXPIRY_FILTER_DAYS = 30

/**
 * The full voucher list — search, filters, sort, multi-select — that used to live on
 * HomePage. Moved here per the redesign's new 4-tab bottom nav (Wallet/Search/Stats/
 * Profile), where HomePage becomes a lighter dashboard and this screen owns "find/manage
 * a voucher." Also absorbs the old FAB speed-dial's "אני בחנות" and "בחירה מרובה" entry
 * points, since those are both list-oriented actions with no other natural home once the
 * speed-dial itself is gone (the FAB is now a direct add-voucher shortcut in BottomNav).
 */
export default function SearchPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useT()
  usePageView('search')
  const { vouchers, archivedVouchers, superVouchers, sharedWithMe, loading, updateVoucher, deleteVoucher, archiveVoucher } = useVouchers()
  const { listings } = useMarketplace()
  const { decryptedMap } = useE2EE()

  // Search/filter state survives navigation within the session (sessionStorage) —
  // redeeming a voucher and coming back must not force the user to re-search the
  // same store. Cleared naturally when the tab/PWA session ends.
  const [search, setSearch] = useState(() => sessionStorage.getItem('searchQuery') || '')
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem('hpSortKey') as SortKey) || 'store')
  const [filterTab, setFilterTab] = useState<FilterTab>(() => (sessionStorage.getItem('searchFilterTab') as FilterTab) || 'all')
  const [filterCats, setFilterCats] = useState<string[]>(() => {
    try { return JSON.parse(sessionStorage.getItem('searchFilterCats') || '[]') } catch { return [] }
  })
  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => { sessionStorage.setItem('searchQuery', search) }, [search])
  useEffect(() => { sessionStorage.setItem('searchFilterTab', filterTab) }, [filterTab])
  useEffect(() => { sessionStorage.setItem('searchFilterCats', JSON.stringify(filterCats)) }, [filterCats])

  // A category tap on HomePage arrives here as router state so the list opens
  // already filtered to that one category, instead of dumping the user into the
  // unfiltered "all vouchers" view. Watches location.state (not just mount) so
  // tapping a different category while already on this page re-applies too.
  useEffect(() => {
    const preset = (location.state as { presetCategory?: string } | null)?.presetCategory
    if (preset) {
      setFilterCats([preset])
      setShowFilters(true)
    }
  }, [location.state])
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('hpViewMode') as ViewMode) || 'grid')
  const [sortDir, setSortDir] = useState<SortDir>(() => (localStorage.getItem('hpSortDir') as SortDir) || 'asc')

  const [editingVoucher, setEditingVoucher] = useState<Voucher | undefined>()
  const [showForm, setShowForm] = useState(false)
  const [showInStoreMode, setShowInStoreMode] = useState(false)

  // Undo delete
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Bulk select
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null)
  const [archiveReason, setArchiveReason] = useState('')

  useEffect(() => () => { pendingDeletesRef.current.forEach(clearTimeout) }, [])
  useEffect(() => { localStorage.setItem('hpViewMode', viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem('hpSortKey', sortKey) }, [sortKey])
  useEffect(() => { localStorage.setItem('hpSortDir', sortDir) }, [sortDir])

  const allCategories = useMemo(() => {
    const cats = new Set<string>()
    vouchers.forEach(v => v.categories.forEach(c => cats.add(c)))
    return [...cats]
  }, [vouchers])

  const filtered = useMemo(() => {
    if (filterTab === 'shared_with_me') return [...sharedWithMe]

    let result = [...vouchers]

    if (filterTab === 'expiring') {
      result = result.filter(v => {
        if (!v.expiry_date) return false
        const days = getDaysUntilExpiry(v.expiry_date)
        return days !== null && days >= 0 && days <= EXPIRY_FILTER_DAYS
      })
    } else if (filterTab === 'shared') {
      result = result.filter(v => v.is_shared)
    }

    if (filterCats.length > 0) {
      result = result.filter(v => filterCats.some(cat => v.categories.includes(cat)))
    }

    const dir = sortDir === 'asc' ? 1 : -1
    result.sort((a, b) => {
      switch (sortKey) {
        case 'expiry':
          if (!a.expiry_date && !b.expiry_date) return 0
          if (!a.expiry_date) return dir
          if (!b.expiry_date) return -dir
          return dir * (new Date(a.expiry_date).getTime() - new Date(b.expiry_date).getTime())
        case 'balance':
          return dir * (a.balance - b.balance)
        case 'store': {
          const cmp = a.store_name.localeCompare(b.store_name, 'he')
          if (cmp !== 0) return dir * cmp
          return a.balance - b.balance
        }
        case 'added':
          return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        default:
          return 0
      }
    })

    if (search) {
      const q = search.toLowerCase()
      const withScore = result
        .map(v => {
          const sv = superVouchers.find(s => s.id === v.super_voucher_id)
          const decryptedCode = v.is_e2ee ? (decryptedMap.get(v.id)?.code ?? '') : v.code
          const directMatch =
            v.store_name.toLowerCase().includes(q) ||
            decryptedCode.toLowerCase().includes(q) ||
            v.categories.some(c => c.toLowerCase().includes(q)) ||
            v.tags.some(tag => tag.toLowerCase().includes(q)) ||
            (v.notes && v.notes.toLowerCase().includes(q))
          const superMatch = !directMatch && sv && (
            sv.name.toLowerCase().includes(q) ||
            sv.stores.some(s => s.toLowerCase().includes(q))
          )
          return { v, score: directMatch ? 0 : superMatch ? 1 : -1 }
        })
        .filter(x => x.score >= 0)
      result = withScore.sort((a, b) => a.score - b.score).map(x => x.v)
    }
    return result
  }, [vouchers, filterTab, filterCats, search, sortKey, sortDir, superVouchers, decryptedMap, sharedWithMe])

  const displayVouchers = useMemo(
    () => filtered.filter(v => !hiddenIds.has(v.id)),
    [filtered, hiddenIds]
  )

  const searchedArchived = useMemo(() => {
    if (!search) return []
    const q = search.toLowerCase()
    return archivedVouchers.filter(v => {
      const decryptedCode = v.is_e2ee ? (decryptedMap.get(v.id)?.code ?? '') : v.code
      return (
        v.store_name.toLowerCase().includes(q) ||
        decryptedCode.toLowerCase().includes(q) ||
        v.categories.some(c => c.toLowerCase().includes(q)) ||
        v.tags.some(tag => tag.toLowerCase().includes(q)) ||
        (v.notes && v.notes.toLowerCase().includes(q)) ||
        (v.source && v.source.toLowerCase().includes(q))
      )
    })
  }, [search, archivedVouchers, decryptedMap])

  const searchedListings = useMemo(() => {
    if (!search) return []
    const q = search.toLowerCase()
    return listings.filter(l =>
      (l.store_name && l.store_name.toLowerCase().includes(q)) ||
      (l.description && l.description.toLowerCase().includes(q))
    )
  }, [search, listings])

  const [searchedDeals, setSearchedDeals] = useState<DiscountDeal[]>([])
  useEffect(() => {
    if (!search || search.trim().length < 2) {
      setSearchedDeals([])
      return
    }
    const q = search.trim()
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('get_my_deals', { p_search: q, p_tags: null, p_limit: 5, p_offset: 0 })
        setSearchedDeals((data as DiscountDeal[]) || [])
      } catch {
        setSearchedDeals([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  function handleDelete(id: string) {
    setHiddenIds(prev => new Set([...prev, id]))
    const timer = setTimeout(async () => {
      await deleteVoucher(id)
      setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
      pendingDeletesRef.current.delete(id)
    }, 5000)
    pendingDeletesRef.current.set(id, timer)

    toast(
      (toastItem) => (
        <span>
          {t('voucher.deleted')}{' '}
          <button
            onClick={() => {
              clearTimeout(pendingDeletesRef.current.get(id))
              pendingDeletesRef.current.delete(id)
              setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              toast.dismiss(toastItem.id)
            }}
            className="underline font-semibold text-primary mr-1"
          >
            {t('app.cancel')}
          </button>
        </span>
      ),
      { duration: 5000, icon: '🗑️' }
    )
  }

  function requestDelete(id: string) {
    setConfirm({
      title: t('confirm.delete.title'),
      message: t('confirm.delete.message'),
      onConfirm: () => { setConfirm(null); handleDelete(id) },
    })
  }

  function requestArchive(id: string) {
    const v = vouchers.find(vch => vch.id === id) ?? sharedWithMe.find(vch => vch.id === id)
    setArchiveReason(v && v.balance <= 0 ? t('archive.reason.full') : '')
    setArchiveTarget(id)
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === displayVouchers.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(displayVouchers.map(v => v.id)))
  }

  function bulkArchive() {
    const count = selectedIds.size
    setConfirm({
      title: t('confirm.bulk.archive.title'),
      message: `להעביר ${count} שוברים לארכיון?`,
      onConfirm: async () => {
        setConfirm(null)
        for (const id of selectedIds) await archiveVoucher(id)
        toast.success(`${count} ${t('confirm.bulk.archive.success')}`)
        setSelectedIds(new Set()); setIsSelectMode(false)
      },
    })
  }

  function bulkDelete() {
    const count = selectedIds.size
    setConfirm({
      title: t('confirm.bulk.delete.title'),
      message: `${count} ${t('search.bulk.delete.confirm')}`,
      onConfirm: () => { setConfirm(null); executeBulkDelete() },
    })
  }

  function executeBulkDelete() {
    const count = selectedIds.size
    setIsSelectMode(false)
    const ids = [...selectedIds]
    setSelectedIds(new Set())
    ids.forEach(id => setHiddenIds(prev => new Set([...prev, id])))

    const timers = ids.map(id => {
      const timer = setTimeout(async () => {
        await deleteVoucher(id)
        setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
        pendingDeletesRef.current.delete(id)
      }, 5000)
      pendingDeletesRef.current.set(id, timer)
      return timer
    })

    toast(
      (toastItem) => (
        <span>
          {count} {t('vouchers.deleted')}{' '}
          <button
            onClick={() => {
              timers.forEach((_, i) => {
                const id = ids[i]
                clearTimeout(pendingDeletesRef.current.get(id))
                pendingDeletesRef.current.delete(id)
                setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              })
              toast.dismiss(toastItem.id)
            }}
            className="underline font-semibold text-primary mr-1"
          >
            {t('app.cancel')}
          </button>
        </span>
      ),
      { duration: 5000, icon: '🗑️' }
    )
  }

  function exitSelectMode() {
    setIsSelectMode(false)
    setSelectedIds(new Set())
  }

  const hasAnyResults = displayVouchers.length > 0 || searchedArchived.length > 0 || searchedListings.length > 0 || searchedDeals.length > 0
  const isFiltered = search !== '' || filterTab !== 'all' || filterCats.length > 0

  return (
    <div className="flex-1 bg-bg">
      {confirm && (
        <ConfirmDialog title={confirm.title} message={confirm.message} danger onConfirm={confirm.onConfirm} onCancel={() => setConfirm(null)} />
      )}

      {archiveTarget && (
        <ConfirmDialog
          title={t('confirm.archive.title')}
          onConfirm={async () => {
            const id = archiveTarget
            setArchiveTarget(null)
            await archiveVoucher(id, archiveReason || undefined)
            toast.success(t('confirm.archive.success'))
          }}
          onCancel={() => { setArchiveTarget(null); setArchiveReason('') }}
        >
          <input
            type="text"
            value={archiveReason}
            onChange={e => setArchiveReason(e.target.value)}
            placeholder={t('archive.reason.placeholder')}
            className="w-full px-3 py-2.5 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 mt-1"
            dir="rtl"
          />
        </ConfirmDialog>
      )}

      {/* Header + search bar */}
      <div className="px-5 pt-5 pb-3 bg-surface border-b border-border">
        <h1 className="text-lg font-extrabold text-text text-center mb-3">{t('search.page.title')}</h1>
        <div className="flex items-center gap-2.5 bg-bg rounded-2xl px-3.5">
          <Icon name="search" size={20} color="var(--c-text3)" />
          <input
            autoFocus={search === ''}
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('search.placeholder')}
            className="flex-1 h-11 border-none bg-transparent text-[15px] text-text outline-none"
            dir="rtl"
          />
          {search && (
            <button onClick={() => setSearch('')} aria-label={t('app.cancel')}>
              <Icon name="close" size={18} color="var(--c-text3)" />
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="sticky top-0 z-30 bg-surface border-b border-border">
        {!isSelectMode ? (
          <div className="flex items-center px-4 py-2 gap-2 overflow-x-auto no-scrollbar">
            {([
              { key: 'all',            label: `${t('home.tab.all')} (${vouchers.length})` },
              { key: 'expiring',       label: t('home.tab.expiring') },
              { key: 'shared',         label: t('home.tab.shared') },
              { key: 'shared_with_me', label: `${t('home.shared.with.me')}${sharedWithMe.length > 0 ? ` (${sharedWithMe.length})` : ''}` },
            ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterTab(key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap flex-shrink-0 transition ${
                  filterTab === key ? 'bg-primary-light text-primary-dark' : 'bg-bg text-text2'
                }`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setShowInStoreMode(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium bg-bg text-text2 flex-shrink-0"
              title={t('instore.title')}
            >
              <Icon name="storefront" size={15} />
            </button>
            <button
              onClick={() => setIsSelectMode(true)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium bg-bg text-text2 flex-shrink-0"
              title={t('home.select.all')}
            >
              <Icon name="checklist" size={15} />
            </button>
            <button
              onClick={() => setViewMode(v => v === 'grid' ? 'rows' : 'grid')}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium bg-bg text-text2 flex-shrink-0"
            >
              <Icon name={viewMode === 'grid' ? 'view_list' : 'grid_view'} size={15} />
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium flex-shrink-0 ${
                showFilters || filterCats.length > 0 ? 'bg-primary-light text-primary-dark' : 'bg-bg text-text2'
              }`}
            >
              <Icon name="tune" size={15} />
              {t('home.filter')}
              {filterCats.length > 0 && <span className="bg-primary text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px]">{filterCats.length}</span>}
            </button>
          </div>
        ) : (
          <div className="flex items-center px-4 py-2 gap-2">
            <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium bg-bg text-text2">
              <Icon name={selectedIds.size === displayVouchers.length ? 'check_box' : 'check_box_outline_blank'} size={15} />
              {selectedIds.size === displayVouchers.length ? t('home.deselect.all') : t('home.select.all')}
            </button>
            <span className="text-xs text-text3">{selectedIds.size} {t('home.selected')}</span>
            <div className="flex-1" />
            <button onClick={exitSelectMode} className="text-xs px-3 py-1.5 rounded-full bg-bg text-text2 font-medium">{t('app.cancel')}</button>
          </div>
        )}

        {showFilters && !isSelectMode && (
          <div className="px-4 pb-3 pt-3 border-t border-border bg-bg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text2">{t('search.categories')}</span>
              <div className="flex items-center gap-2">
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-surface text-text outline-none"
                >
                  <option value="expiry">{t('search.sort.expiry')}</option>
                  <option value="balance">{t('search.sort.balance')}</option>
                  <option value="store">{t('search.sort.store')}</option>
                  <option value="added">{t('search.sort.added')}</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className={`flex items-center px-2 py-1 rounded-lg border text-xs ${sortDir === 'desc' ? 'bg-primary-light border-primary text-primary-dark' : 'bg-surface border-border text-text2'}`}
                >
                  <Icon name="swap_vert" size={15} />
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                  className={`text-xs px-3 py-1 rounded-full border transition ${
                    filterCats.includes(cat) ? 'bg-primary-light text-primary-dark border-primary' : 'bg-surface text-text2 border-border'
                  }`}
                >
                  {cat}
                </button>
              ))}
              {filterCats.length > 0 && (
                <button onClick={() => setFilterCats([])} className="text-xs px-3 py-1 rounded-full bg-error/10 text-error">
                  {t('search.clear')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 pb-40">
        {search && hasAnyResults && (
          <div className="flex flex-wrap gap-2 mb-3 text-xs">
            {displayVouchers.length > 0 && (
              <span className="flex items-center gap-1 bg-primary-light text-primary-dark px-2.5 py-1 rounded-full font-medium">
                <Icon name="redeem" size={13} /> {displayVouchers.length} {t('search.result.active')}
              </span>
            )}
            {searchedArchived.length > 0 && (
              <span className="flex items-center gap-1 bg-bg text-text2 px-2.5 py-1 rounded-full font-medium">
                <Icon name="archive" size={13} /> {searchedArchived.length} {t('search.result.archive')}
              </span>
            )}
            {searchedListings.length > 0 && (
              <span className="flex items-center gap-1 bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-medium">
                <Icon name="storefront" size={13} /> {searchedListings.length} {t('search.result.market')}
              </span>
            )}
            {searchedDeals.length > 0 && (
              <span className="flex items-center gap-1 bg-purple-50 text-purple-600 px-2.5 py-1 rounded-full font-medium">
                <Icon name="percent" size={13} /> {searchedDeals.length} {t('search.result.deals')}
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-32 gs-skeleton rounded-card" />)}
          </div>
        ) : !hasAnyResults ? (
          <div className="text-center py-16">
            <Icon name="redeem" size={56} color="var(--c-border)" />
            <p className="text-text2 font-medium mt-4">{isFiltered ? t('search.empty.filtered') : t('search.empty.default')}</p>
          </div>
        ) : (
          <>
            {displayVouchers.length > 0 && (
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : 'flex flex-col gap-2'}>
                {displayVouchers.map(v => {
                  const sv = superVouchers.find(s => s.id === v.super_voucher_id)
                  return (
                    <VoucherCard
                      key={v.id}
                      voucher={v}
                      superVoucherName={sv?.name}
                      onClick={() => navigate(`/checkout/${v.id}`)}
                      onEdit={() => { setEditingVoucher(v); setShowForm(true) }}
                      onDelete={() => requestDelete(v.id)}
                      onArchive={() => requestArchive(v.id)}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(v.id)}
                      onSelect={() => toggleSelect(v.id)}
                      rowMode={viewMode === 'rows'}
                    />
                  )
                })}
              </div>
            )}

            {searchedArchived.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="archive" size={14} color="var(--c-text3)" />
                  <span className="text-xs font-medium text-text3">{t('search.result.archive')}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedArchived.map(v => (
                    <button key={v.id} onClick={() => navigate(`/checkout/${v.id}`)} className="flex items-center gap-3 text-right w-full opacity-60 bg-surface rounded-card shadow-card p-3">
                      <div className="w-9 h-9 rounded-xl bg-bg flex items-center justify-center flex-shrink-0 text-text2 font-bold text-sm">
                        {(v.store_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate text-text">{v.store_name}</p>
                        {v.categories?.[0] && <p className="text-xs truncate text-text3">{v.categories[0]}</p>}
                      </div>
                      <div className="text-left flex-shrink-0">
                        <div className="text-sm font-bold text-text2">{formatCurrency(v.balance)}</div>
                        {v.expiry_date && <div className="text-xs text-text3">{formatDate(v.expiry_date)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchedListings.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="storefront" size={14} color="#60a5fa" />
                  <span className="text-xs font-medium text-blue-500">{t('search.result.market')}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedListings.map(l => (
                    <button key={l.id} onClick={() => navigate(`/market/listing/${l.id}`)} className="flex items-center gap-3 text-right w-full bg-surface rounded-card shadow-card p-3">
                      <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-600 font-bold text-sm">
                        {(l.store_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate text-text">{l.store_name}</p>
                        {l.description && <p className="text-xs truncate text-text3">{l.description}</p>}
                      </div>
                      <div className="text-left flex-shrink-0">
                        <div className="text-sm font-bold text-blue-600">{formatCurrency(l.asking_price)}</div>
                        {l.expiry_date && <div className="text-xs text-text3">{formatDate(l.expiry_date)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {searchedDeals.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="percent" size={14} color="#a78bfa" />
                  <span className="text-xs font-medium text-purple-500">{t('search.result.deals')}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedDeals.map(deal => (
                    <button key={deal.deal_id} onClick={() => navigate('/discounts', { state: { dealId: deal.deal_id } })} className="flex items-center gap-3 text-right w-full bg-surface rounded-card shadow-card p-3">
                      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold" style={{ background: '#8b5cf622', color: '#8b5cf6' }}>
                        {(deal.business_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate text-text">{deal.business_name}</p>
                        <p className="text-xs truncate text-text3">{deal.club_name} · {deal.title}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {deal.discount_type === 'percent' && deal.discount_value ? (
                          <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">{deal.discount_value}%</span>
                        ) : deal.discount_type === 'fixed' && deal.discount_value ? (
                          <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">₪{deal.discount_value}</span>
                        ) : (
                          <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">{deal.title}</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {isSelectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-24 left-0 right-0 z-40 px-4">
          <div className="bg-gray-900 text-white rounded-2xl p-3 flex items-center gap-2 shadow-xl">
            <span className="text-sm font-medium flex-1">{selectedIds.size} {t('home.selected')}</span>
            <button onClick={() => navigate('/market/bulk', { state: { voucherIds: [...selectedIds] } })} className="flex items-center gap-1.5 px-3 py-2 bg-primary rounded-xl text-sm font-medium">
              <Icon name="sell" size={16} /> {t('checkout.sell')}
            </button>
            <button onClick={bulkArchive} className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 rounded-xl text-sm font-medium">
              <Icon name="archive" size={16} /> {t('nav.archive')}
            </button>
            <button onClick={bulkDelete} className="flex items-center gap-1.5 px-3 py-2 bg-error rounded-xl text-sm font-medium">
              <Icon name="delete" size={16} /> {t('app.delete')}
            </button>
          </div>
        </div>
      )}

      {showForm && (
        <VoucherForm voucher={editingVoucher} onClose={() => { setShowForm(false); setEditingVoucher(undefined) }} onSave={async vData => {
          if (editingVoucher) {
            const { _storeUsed, ...voucherData } = vData
            await updateVoucher(editingVoucher.id, voucherData, _storeUsed ?? null)
            toast.success(t('voucher.updated'))
          }
        }} />
      )}

      {showInStoreMode && (
        <InStoreMode
          vouchers={vouchers}
          superVouchers={superVouchers}
          onUpdate={async (id, balance, storeUsed) => { await updateVoucher(id, { balance }, storeUsed) }}
          onNavigate={id => { setShowInStoreMode(false); navigate(`/checkout/${id}`) }}
          onClose={() => setShowInStoreMode(false)}
        />
      )}
    </div>
  )
}
