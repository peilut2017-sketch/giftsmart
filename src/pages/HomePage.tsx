import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useAuth } from '../contexts/AuthContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useE2EE } from '../contexts/E2EEContext'
import { useMarketplace } from '../contexts/MarketplaceContext'
import { useT } from '../lib/i18n'
import { Shield } from 'lucide-react'
import VoucherCard from '../components/VoucherCard'
import VoucherForm from '../components/VoucherForm'
import type { Voucher, DiscountDeal } from '../types'
import { Search, SlidersHorizontal, Archive, X, WifiOff, CheckSquare, Trash2, Square, LayoutGrid, List, ArrowUpDown, Tag, ShoppingBag, Store, AlertTriangle, Users, Handshake, Gift, Lightbulb, Percent } from 'lucide-react'
import { supabase } from '../lib/supabase'
import InStoreMode from '../components/InStoreMode'
import toast from 'react-hot-toast'
import { formatCurrency, formatDate, getExpiryStatus, getDaysUntilExpiry } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'

type SortKey = 'expiry' | 'balance' | 'store' | 'added'
type FilterTab = 'all' | 'expiring' | 'shared' | 'shared_with_me'
type ViewMode = 'grid' | 'rows'
type SortDir = 'asc' | 'desc'

export default function HomePage() {
  const navigate = useNavigate()
  const { t } = useT()
  const { user } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, sharedWithMe, loading, walletError, isOnline, walletName, addVoucher, updateVoucher, deleteVoucher, archiveVoucher, archiveExpired } = useVouchers()
  const { listings } = useMarketplace()
  const { limits, openUpgradeSheet } = useSubscription()
  const { hasVault, hint, isVaultUnlocked, unlockVault, lockVault, decryptedMap } = useE2EE()
  const [showVaultModal, setShowVaultModal] = useState(false)
  const [vaultPassInput, setVaultPassInput] = useState('')
  const [vaultUnlocking, setVaultUnlocking] = useState(false)
  const [vaultError, setVaultError] = useState('')

  async function handleVaultUnlock() {
    if (!vaultPassInput) return
    setVaultUnlocking(true)
    setVaultError('')
    const ok = await unlockVault(vaultPassInput)
    setVaultUnlocking(false)
    if (ok) { setShowVaultModal(false); setVaultPassInput('') }
    else setVaultError(t('vault.wrong.password'))
  }
  const [searchParams, setSearchParams] = useSearchParams()
  const [showForm, setShowForm] = useState(() => searchParams.get('add') === '1')
  const openForm = useCallback(() => {
    setShowForm(true)
    if (searchParams.has('add')) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])
  const [editingVoucher, setEditingVoucher] = useState<Voucher | undefined>()
  const [search, setSearch] = useState(() => localStorage.getItem('hpSearch') || '')
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem('hpSortKey') as SortKey) || 'store')
  const [filterTab, setFilterTab] = useState<FilterTab>(() => (localStorage.getItem('hpFilterTab') as FilterTab) || 'all')
  const [filterCats, setFilterCats] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('hpFilterCats') || '[]') } catch { return [] }
  })
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() => (localStorage.getItem('hpViewMode') as ViewMode) || 'grid')
  const [sortDir, setSortDir] = useState<SortDir>(() => (localStorage.getItem('hpSortDir') as SortDir) || 'asc')

  // Undo delete
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const pendingDeletesRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Bulk select
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  type Confirm = { title: string; message?: string; onConfirm: () => void }
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  // Dedicated archive-with-reason state (single voucher)
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null)
  const [archiveReason, setArchiveReason] = useState('')

  // Clear all pending undo-delete timers when unmounting to avoid stale async ops
  useEffect(() => () => { pendingDeletesRef.current.forEach(clearTimeout) }, [])

  // Persist display preferences
  useEffect(() => { localStorage.setItem('hpViewMode', viewMode) }, [viewMode])
  useEffect(() => { localStorage.setItem('hpSortKey', sortKey) }, [sortKey])
  useEffect(() => { localStorage.setItem('hpSortDir', sortDir) }, [sortDir])
  useEffect(() => { localStorage.setItem('hpSearch', search) }, [search])
  useEffect(() => { localStorage.setItem('hpFilterTab', filterTab) }, [filterTab])
  useEffect(() => { localStorage.setItem('hpFilterCats', JSON.stringify(filterCats)) }, [filterCats])

  const allCategories = useMemo(() => {
    const cats = new Set<string>()
    vouchers.forEach(v => v.categories.forEach(c => cats.add(c)))
    return [...cats]
  }, [vouchers])

  const EXPIRY_FILTER_DAYS = 30

  const expiredCount  = vouchers.filter(v => getExpiryStatus(v.expiry_date) === 'expired').length
  const expiringCount = useMemo(() => vouchers.filter(v => {
    if (!v.expiry_date) return false
    const days = getDaysUntilExpiry(v.expiry_date)
    return days !== null && days >= 0 && days <= EXPIRY_FILTER_DAYS
  }).length, [vouchers])

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
            v.tags.some(t => t.toLowerCase().includes(q)) ||
            (v.notes && v.notes.toLowerCase().includes(q))
          const superMatch = !directMatch && sv && (
            sv.name.toLowerCase().includes(q) ||
            sv.stores.some(s => s.toLowerCase().includes(q))
          )
          return { v, score: directMatch ? 0 : superMatch ? 1 : -1 }
        })
        .filter(x => x.score >= 0)
      // Stable sort: score is primary, regular sort order preserved within same score
      result = withScore.sort((a, b) => a.score - b.score).map(x => x.v)
    }
    return result
  }, [vouchers, filterTab, filterCats, search, sortKey, sortDir, superVouchers, decryptedMap])

  // Filter out pending-delete vouchers from display
  const displayVouchers = useMemo(
    () => filtered.filter(v => !hiddenIds.has(v.id)),
    [filtered, hiddenIds]
  )

  // When search is active, also search archived vouchers and marketplace listings
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

  async function handleSave(vData: any) {
    if (editingVoucher) {
      const usedAmount = editingVoucher.balance - vData.balance
      const { _storeUsed, ...voucherData } = vData
      await updateVoucher(editingVoucher.id, voucherData, _storeUsed ?? null)
      toast.success(t('voucher.updated'))

      if (usedAmount > 0) {
        sendUsageNotification(editingVoucher.store_name, usedAmount, vData.balance, undefined, user?.id)
      }

      if (vData.balance <= 0 && !vData.item_name) {
        const vId = editingVoucher.id
        const vName = editingVoucher.store_name
        setConfirm({
          title: t('voucher.redeemed.title'),
          message: `יתרת "${vName}" הגיעה לאפס. להעביר לארכיון?`,
          onConfirm: async () => {
            setConfirm(null)
            await archiveVoucher(vId)
            toast.success(t('voucher.archived'))
          },
        })
      }
    } else {
      try {
        await addVoucher(vData)
        toast.success(t('voucher.added'))
      } catch (err: any) {
        toast.error(err?.message || t('voucher.save.error'))
        throw err
      }
    }
  }

  async function handleDelete(id: string) {
    // Hide immediately (optimistic)
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
            className="underline font-semibold text-blue-600 mr-1"
          >
            {t('app.cancel')}
          </button>
        </span>
      ),
      { duration: 5000, icon: '🗑️' }
    )
  }

  function handleArchiveExpired() {
    setConfirm({
      title: t('confirm.archive.expired.title'),
      message: `להעביר ${expiredCount} שוברים פגי תוקף לארכיון?`,
      onConfirm: async () => { setConfirm(null); await archiveExpired(); toast.success(t('confirm.archive.expired.success')) },
    })
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

  // Bulk actions
  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === displayVouchers.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(displayVouchers.map(v => v.id)))
    }
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
      message: `למחוק ${count} שוברים? הפעולה אינה ניתנת לביטול.`,
      onConfirm: () => { setConfirm(null); executeBulkDelete() },
    })
  }

  async function executeBulkDelete() {
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
            className="underline font-semibold text-blue-600 mr-1"
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

  const totalBalance = vouchers.reduce((s, v) => s + v.balance, 0)
  const filteredBalance = displayVouchers.reduce((s, v) => s + v.balance, 0)
  const isFiltered = search !== '' || filterTab !== 'all' || filterCats.length > 0
  const forSaleCount = vouchers.filter(v => v.is_locked && v.lock_reason === 'for_sale').length
  const [searchOpen, setSearchOpen] = useState(false)
  const [showInStoreMode, setShowInStoreMode] = useState(false)
  const [searchedDeals, setSearchedDeals] = useState<DiscountDeal[]>([])

  // Search deals from backend with debounce when search query is active
  useEffect(() => {
    if (!search || search.trim().length < 2) {
      setSearchedDeals([])
      return
    }
    const q = search.trim()
    const timer = setTimeout(async () => {
      try {
        const { data } = await supabase.rpc('get_my_deals', {
          p_search: q,
          p_tags: null,
          p_limit: 5,
          p_offset: 0,
        })
        setSearchedDeals((data as DiscountDeal[]) || [])
      } catch {
        setSearchedDeals([])
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Smart FAB state
  const [fabOpen, setFabOpen] = useState(false)
  const fabRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)

  useEffect(() => {
    if (!fabOpen) return
    function onOutside(e: MouseEvent | TouchEvent) {
      if (fabRef.current && !fabRef.current.contains(e.target as Node)) {
        setFabOpen(false)
      }
    }
    document.addEventListener('mousedown', onOutside)
    document.addEventListener('touchstart', onOutside)
    return () => {
      document.removeEventListener('mousedown', onOutside)
      document.removeEventListener('touchstart', onOutside)
    }
  }, [fabOpen])

  function openAddForm() {
    if (vouchers.length >= limits.maxVouchers) {
      openUpgradeSheet(t('upgrade.limit.reached', { max: limits.maxVouchers }))
      return
    }
    setFabOpen(false)
    setEditingVoucher(undefined)
    openForm()
  }

  function handleFabPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId)
    longPressFired.current = false
    longPressTimer.current = setTimeout(() => {
      longPressFired.current = true
      openAddForm()
    }, 500)
  }

  function handleFabPointerUp() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
    if (!longPressFired.current) {
      if (fabOpen) openAddForm()
      else setFabOpen(true)
    }
  }

  function handleFabPointerLeave() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
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
            className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 mt-1"
            dir="rtl"
          />
        </ConfirmDialog>
      )}

      {/* ── Vault unlock modal ── */}
      {showVaultModal && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-6" onClick={() => { setShowVaultModal(false); setVaultPassInput(''); setVaultError('') }}>
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-2xl bg-indigo-100 flex items-center justify-center">
                <Shield className="w-5 h-5 text-indigo-500" />
              </div>
              <div>
                <p className="font-bold text-gray-900 text-sm">{t('vault.open.title')}</p>
                <p className="text-xs text-gray-400">{t('vault.open.subtitle')}</p>
              </div>
            </div>
            {hint && (
              <p className="text-xs text-indigo-500 mb-3 text-center flex items-center justify-center gap-1"><Lightbulb className="w-3.5 h-3.5" /> {t('vault.hint')}: <span className="font-medium">{hint}</span></p>
            )}
            <form onSubmit={e => { e.preventDefault(); handleVaultUnlock() }}>
              <input
                type="password"
                value={vaultPassInput}
                onChange={e => setVaultPassInput(e.target.value)}
                placeholder={t('vault.password.placeholder')}
                className="w-full px-4 py-3 border border-gray-200 rounded-2xl text-base mb-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
                dir="ltr"
                autoFocus
                autoComplete="current-password"
                name="vault-password"
              />
              {vaultError && <p className="text-xs text-red-500 mb-2">{vaultError}</p>}
              <div className="flex gap-2 mt-1">
                <button
                  type="submit"
                  disabled={vaultUnlocking || !vaultPassInput}
                  className="flex-1 py-2.5 bg-indigo-600 text-white rounded-2xl text-sm font-semibold disabled:opacity-50"
                >
                  {vaultUnlocking ? '...' : t('vault.open.button')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowVaultModal(false); setVaultPassInput(''); setVaultError('') }}
                  className="flex-1 py-2.5 bg-gray-100 text-gray-600 rounded-2xl text-sm"
                >
                  {t('app.cancel')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Gradient Hero Header ── */}
      <div style={{
        background: 'linear-gradient(160deg, var(--c-primary-dark) 0%, var(--c-primary) 60%, #1a9e90 100%)',
        padding: '20px 20px 24px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Decorative circles */}
        <div style={{ position: 'absolute', top: -40, left: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.05)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -20, right: -20, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.04)', pointerEvents: 'none' }} />

        {/* Top row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <img src="/logo.png" alt="GiftSmart" style={{ width: 26, height: 26, objectFit: 'contain' }} />
            </div>
            <div>
              <div style={{ fontSize: 14, color: '#fff', fontWeight: 800, letterSpacing: '-0.3px' }}>GiftSmart</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.65)', fontWeight: 500 }}>{walletName || t('wallet.main')}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {!isOnline && <WifiOff size={18} color="rgba(255,255,255,0.7)" />}
            {expiredCount > 0 && !isSelectMode && (
              <button
                onClick={handleArchiveExpired}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', fontFamily: 'Heebo, sans-serif' }}
              >
                <Archive size={13} color="#fbbf24" />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fbbf24' }}>{t('home.expired.label')} ({expiredCount})</span>
              </button>
            )}
            {hasVault && (
              <button
                onClick={() => isVaultUnlocked ? lockVault() : setShowVaultModal(true)}
                style={{ background: isVaultUnlocked ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                aria-label={isVaultUnlocked ? t('e2ee.lock') : t('e2ee.unlock')}
                title={isVaultUnlocked ? t('e2ee.lock') : t('e2ee.unlock')}
              >
                <Shield size={17} color={isVaultUnlocked ? '#a5b4fc' : 'rgba(255,255,255,0.65)'} />
              </button>
            )}
            <button
              onClick={() => setSearchOpen(s => !s)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}
              aria-label={t('app.search')}
            >
              <Search size={20} color={searchOpen ? '#fff' : 'rgba(255,255,255,0.75)'} />
            </button>
            {isSelectMode && (
              <button
                onClick={exitSelectMode}
                style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 20, padding: '5px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'Heebo, sans-serif' }}
              >
                <X size={14} color="#fff" />
                <span style={{ fontSize: 11, fontWeight: 600, color: '#fff' }}>{t('app.cancel')}</span>
              </button>
            )}
          </div>
        </div>

        {/* Balance display */}
        <div style={{ marginBottom: 14, position: 'relative' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', marginBottom: 4, fontWeight: 500 }}>
            {isFiltered ? t('home.balance.filtered') : t('home.balance.total')}
          </div>
          <div style={{ fontSize: 40, fontWeight: 900, color: '#fff', letterSpacing: '-1px', lineHeight: 1 }}>
            {formatCurrency(isFiltered ? filteredBalance : totalBalance)}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 5 }}>
            {isFiltered ? `${displayVouchers.length} ${t('home.of')} ${vouchers.length} ${t('home.vouchers')}` : `${vouchers.length} ${t('home.active.vouchers')}`}
          </div>
        </div>

        {/* Quick stats */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', position: 'relative' }}>
          {expiringCount > 0 && filterTab !== 'expiring' && (
            <button
              onClick={() => setFilterTab('expiring')}
              style={{ background: 'rgba(255,255,255,0.12)', border: 'none', borderRadius: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontFamily: 'Heebo, sans-serif' }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{expiringCount} {t('home.tab.expiring')}</span>
            </button>
          )}
          {forSaleCount > 0 && (
            <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tag size={12} color="rgba(255,255,255,0.8)" />
              <span style={{ fontSize: 12, color: '#fff', fontWeight: 600 }}>{forSaleCount} {t('home.for.sale')}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Collapsible Search Bar ── */}
      {searchOpen && (
        <div style={{ background: 'var(--c-surface)', padding: '10px 16px', borderBottom: '1px solid var(--c-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--c-bg)', borderRadius: 12, padding: '0 12px' }}>
            <Search size={16} color="var(--c-text3)" />
            <input
              autoFocus
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('app.search')}
              style={{ flex: 1, height: 42, border: 'none', background: 'transparent', fontSize: 15, color: 'var(--c-text)', fontFamily: 'Heebo, sans-serif', outline: 'none', direction: 'rtl' }}
            />
            {search && (
              <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 2 }}>
                <X size={15} color="var(--c-text3)" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Sticky filter bar ── */}
      <div data-guide="filter-bar" className="sticky top-0 z-30" style={{ background: 'var(--c-surface)', borderBottom: '1px solid var(--c-border)' }}>
        {/* Tabs */}
        {!isSelectMode && (
          <div className="flex items-center px-4 py-2 gap-2 overflow-x-auto no-scrollbar">
            {([
              { key: 'all',           label: `${t('home.tab.all')} (${vouchers.length})`,                                                        icon: null },
              { key: 'expiring',      label: t('home.tab.expiring'),                                                                              icon: AlertTriangle },
              { key: 'shared',        label: t('home.tab.shared'),                                                                                icon: Users },
              { key: 'shared_with_me', label: `${t('home.shared.with.me')}${sharedWithMe.length > 0 ? ` (${sharedWithMe.length})` : ''}`,       icon: Handshake },
            ] as { key: FilterTab; label: string; icon: React.ElementType | null }[]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setFilterTab(key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap flex-shrink-0 flex items-center gap-1 ${
                  filterTab === key ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {Icon && <Icon className="w-3 h-3" />}
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setViewMode(v => v === 'grid' ? 'rows' : 'grid')}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium bg-gray-100 text-gray-500 hover:bg-gray-200"
              title={viewMode === 'grid' ? t('home.view.rows') : t('home.view.grid')}
            >
              {viewMode === 'grid' ? <List className="w-3.5 h-3.5" /> : <LayoutGrid className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full font-medium transition-all ${
                showFilters || filterCats.length > 0 ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              {t('home.filter')}
              {filterCats.length > 0 && <span className="bg-green-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">{filterCats.length}</span>}
            </button>
          </div>
        )}

        {/* Select mode header */}
        {isSelectMode && (
          <div className="flex items-center px-4 py-2 gap-2">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600"
            >
              {selectedIds.size === displayVouchers.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {selectedIds.size === displayVouchers.length ? t('home.deselect.all') : t('home.select.all')}
            </button>
            <span className="text-xs text-gray-500">{selectedIds.size} {t('home.selected')}</span>
          </div>
        )}

        {/* Filters panel */}
        {showFilters && !isSelectMode && (
          <div className="px-4 pb-3 border-t pt-3" style={{ background: 'var(--c-bg)' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">קטגוריות</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 ml-2">מיון:</span>
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
                >
                  <option value="expiry">תפוגה</option>
                  <option value="balance">₪ יתרה</option>
                  <option value="store">חנות</option>
                  <option value="added">הוספה</option>
                </select>
                <button
                  onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-all ${sortDir === 'desc' ? 'bg-green-100 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-500'}`}
                  title={sortDir === 'asc' ? 'סדר עולה' : 'סדר יורד'}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allCategories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilterCats(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat])}
                  className={`text-xs px-3 py-1 rounded-full transition-all ${
                    filterCats.includes(cat) ? 'bg-green-100 text-green-700 border border-green-300' : 'bg-white text-gray-600 border border-gray-200'
                  }`}
                >
                  {cat}
                </button>
              ))}
              {filterCats.length > 0 && (
                <button
                  onClick={() => setFilterCats([])}
                  className="text-xs px-3 py-1 rounded-full bg-red-50 text-red-500 border border-red-200"
                >
                  <X className="w-3 h-3 inline" /> נקה
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Voucher Grid */}
      <div className="p-4 pb-36" onTouchStart={() => { (document.activeElement as HTMLElement)?.blur() }}>
        {walletError && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            <p className="font-semibold mb-1">שגיאה בהגדרת הארנק</p>
            <p>{walletError}</p>
          </div>
        )}
        {/* Search results count breakdown */}
        {search && (displayVouchers.length > 0 || searchedArchived.length > 0 || searchedListings.length > 0 || searchedDeals.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-3 text-xs text-gray-500">
            {displayVouchers.length > 0 && (
              <span className="flex items-center gap-1 bg-green-50 text-green-700 px-2.5 py-1 rounded-full font-medium">
                <Gift className="w-3 h-3" /> {displayVouchers.length} פעילים
              </span>
            )}
            {searchedArchived.length > 0 && (
              <span className="flex items-center gap-1 bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full font-medium">
                <Archive className="w-3 h-3" /> {searchedArchived.length} ארכיון
              </span>
            )}
            {searchedListings.length > 0 && (
              <span className="flex items-center gap-1 bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full font-medium">
                <ShoppingBag className="w-3 h-3" /> {searchedListings.length} בשוק
              </span>
            )}
            {searchedDeals.length > 0 && (
              <span className="flex items-center gap-1 bg-purple-50 text-purple-600 px-2.5 py-1 rounded-full font-medium">
                <Percent className="w-3 h-3" /> {searchedDeals.length} הנחות
              </span>
            )}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-32 gs-skeleton" style={{ borderRadius: 18 }} />
            ))}
          </div>
        ) : displayVouchers.length === 0 && searchedArchived.length === 0 && searchedListings.length === 0 && searchedDeals.length === 0 ? (
          <div className="text-center py-16">
            <Gift className="w-14 h-14 mx-auto mb-4" style={{ color: 'var(--c-border)' }} />
            <p className="text-gray-500 font-medium">
              {search || filterCats.length > 0 || filterTab !== 'all' ? 'לא נמצאו שוברים' : 'אין שוברים עדיין'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {!search && filterCats.length === 0 && filterTab === 'all' && 'לחץ + כדי להוסיף שובר ראשון'}
            </p>
          </div>
        ) : (
          <>
            {/* Active vouchers */}
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

            {/* Archived search results */}
            {searchedArchived.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Archive className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-400">מהארכיון</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedArchived.map(v => (
                    <button
                      key={v.id}
                      onClick={() => navigate(`/checkout/${v.id}`)}
                      className="flex items-center gap-3 text-right w-full opacity-60"
                      style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: '12px 14px' }}
                    >
                      <div className="w-9 h-9 rounded-xl bg-gray-200 flex items-center justify-center flex-shrink-0 text-gray-500 font-bold text-sm">
                        {(v.store_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--c-text)' }}>{v.store_name}</p>
                        {v.categories?.[0] && <p className="text-xs truncate" style={{ color: 'var(--c-text3)' }}>{v.categories[0]}</p>}
                      </div>
                      <div className="text-left flex-shrink-0">
                        <div className="text-sm font-bold" style={{ color: 'var(--c-text2)' }}>{formatCurrency(v.balance)}</div>
                        {v.expiry_date && <div className="text-xs text-gray-400">{formatDate(v.expiry_date)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Marketplace search results */}
            {searchedListings.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-xs font-medium text-blue-500">בשוק</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedListings.map(l => (
                    <button
                      key={l.id}
                      onClick={() => navigate(`/market/listing/${l.id}`)}
                      className="flex items-center gap-3 text-right w-full"
                      style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: '12px 14px' }}
                    >
                      <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 text-blue-600 font-bold text-sm">
                        {(l.store_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--c-text)' }}>{l.store_name}</p>
                        {l.description && <p className="text-xs truncate" style={{ color: 'var(--c-text3)' }}>{l.description}</p>}
                      </div>
                      <div className="text-left flex-shrink-0">
                        <div className="text-sm font-bold text-blue-600">{formatCurrency(l.asking_price)}</div>
                        {l.balance && <div className="text-xs text-gray-400">יתרה: {formatCurrency(l.balance)}</div>}
                        {l.expiry_date && <div className="text-xs text-gray-400">{formatDate(l.expiry_date)}</div>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Discount deals search results */}
            {searchedDeals.length > 0 && (
              <div className="mt-4">
                <div className="flex items-center gap-2 mb-2">
                  <Percent className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs font-medium text-purple-500">הנחות תואמות</span>
                </div>
                <div className="flex flex-col gap-2">
                  {searchedDeals.map(deal => (
                    <button
                      key={deal.deal_id}
                      onClick={() => navigate('/discounts', { state: { dealId: deal.deal_id } })}
                      className="flex items-center gap-3 text-right w-full"
                      style={{ background: 'var(--c-surface)', borderRadius: 'var(--r-card)', boxShadow: 'var(--shadow-card)', padding: '12px 14px' }}
                    >
                      <div
                        className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 text-sm font-bold"
                        style={{ background: '#8b5cf622', color: '#8b5cf6' }}
                      >
                        {(deal.business_name || '?')[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--c-text)' }}>{deal.business_name}</p>
                        <p className="text-xs truncate" style={{ color: 'var(--c-text3)' }}>{deal.club_name} · {deal.title}</p>
                      </div>
                      <div className="flex-shrink-0">
                        {deal.discount_type === 'percent' && deal.discount_value ? (
                          <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">{deal.discount_value}% הנחה</span>
                        ) : deal.discount_type === 'fixed' && deal.discount_value ? (
                          <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-1 rounded-full">₪{deal.discount_value} הנחה</span>
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

      {/* Bulk action bar */}
      {isSelectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="bg-gray-900 text-white rounded-2xl p-3 flex items-center gap-2 shadow-xl">
            <span className="text-sm font-medium flex-1">{selectedIds.size} נבחרו</span>
            <button
              onClick={() => navigate('/market/bulk', { state: { voucherIds: [...selectedIds] } })}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-600 rounded-xl text-sm font-medium hover:bg-green-500"
            >
              <ShoppingBag className="w-4 h-4" />
              מכירה
            </button>
            <button
              onClick={bulkArchive}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 rounded-xl text-sm font-medium hover:bg-gray-600"
            >
              <Archive className="w-4 h-4" />
              ארכיון
            </button>
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-600 rounded-xl text-sm font-medium hover:bg-red-500"
            >
              <Trash2 className="w-4 h-4" />
              מחיקה
            </button>
          </div>
        </div>
      )}

      {/* Smart FAB */}
      {!isSelectMode && (
        <div ref={fabRef} className="fixed bottom-24 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 z-40 flex flex-col items-center gap-2">

          {/* Speed-dial actions */}
          {fabOpen && (
            <div className="flex flex-col items-center gap-2 mb-1">
              {[
                { icon: <Search className="w-4 h-4" />,       label: 'חיפוש',        delay: '0.12s', action: () => { setSearchOpen(true); setFabOpen(false) } },
                { icon: <Store className="w-4 h-4" />,        label: 'אני בחנות',    delay: '0.06s', action: () => { setShowInStoreMode(true); setFabOpen(false) } },
                { icon: <CheckSquare className="w-4 h-4" />,  label: 'בחירה מרובה', delay: '0s',    action: () => { setIsSelectMode(true); setFabOpen(false) } },
              ].map(({ icon, label, delay, action }) => (
                <button
                  key={label}
                  onClick={action}
                  className="speed-dial-item flex items-center gap-2 bg-white rounded-full shadow-lg px-4 py-2.5 text-gray-700 text-sm font-medium hover:bg-gray-50 active:scale-95 transition-transform"
                  style={{ animationDelay: delay }}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* Upgrade badge */}
          {limits.maxVouchers < Infinity && vouchers.length >= limits.maxVouchers - 3 && !fabOpen && (
            <button
              onClick={() => openUpgradeSheet()}
              className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shadow"
            >
              {vouchers.length}/{limits.maxVouchers} שוברים
            </button>
          )}

          {/* Main FAB — tap to open menu (or confirm add when menu open); long-press to add directly */}
          <button
            data-guide="fab"
            onPointerDown={handleFabPointerDown}
            onPointerUp={handleFabPointerUp}
            onPointerLeave={handleFabPointerLeave}
            onContextMenu={e => e.preventDefault()}
            className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full shadow-xl flex items-center justify-center hover:shadow-2xl transition-all active:scale-95 select-none"
            style={{ touchAction: 'manipulation' }}
            aria-label={fabOpen ? 'הוסף שובר' : 'פתח תפריט'}
          >
            <svg viewBox="0 0 28 28" className="w-7 h-7" fill="none">
              <rect x="6" y="6" width="16" height="16" rx="3" transform="rotate(45 14 14)" stroke="white" strokeWidth="2" fill="none"/>
              <line x1="14" y1="9" x2="14" y2="19" stroke="white" strokeWidth="2" strokeLinecap="round"/>
              <line x1="9" y1="14" x2="19" y2="14" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <VoucherForm
          voucher={editingVoucher}
          onClose={() => { setShowForm(false); setEditingVoucher(undefined) }}
          onSave={handleSave}
        />
      )}

      {/* In-Store Mode */}
      {showInStoreMode && (
        <InStoreMode
          vouchers={vouchers}
          superVouchers={superVouchers}
          onUpdate={async (id, balance, storeUsed) => {
            await updateVoucher(id, { balance }, storeUsed)
          }}
          onNavigate={id => { setShowInStoreMode(false); navigate(`/checkout/${id}`) }}
          onClose={() => setShowInStoreMode(false)}
        />
      )}
    </div>
  )
}
