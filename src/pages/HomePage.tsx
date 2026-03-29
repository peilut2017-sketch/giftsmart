import { useState, useMemo, useRef, useEffect } from 'react'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import VoucherCard from '../components/VoucherCard'
import VoucherForm from '../components/VoucherForm'
import type { Voucher } from '../types'
import { Search, SlidersHorizontal, Archive, X, WifiOff, CheckSquare, Trash2, Square, LayoutGrid, List, ArrowUpDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { formatCurrency, getExpiryStatus } from '../utils/helpers'
import { sendUsageNotification } from '../hooks/useNotifications'
import { useNavigate } from 'react-router-dom'
import ConfirmDialog from '../components/ConfirmDialog'

type SortKey = 'expiry' | 'balance' | 'store' | 'added'
type FilterTab = 'all' | 'expiring' | 'shared' | 'shared_with_me'
type ViewMode = 'grid' | 'rows'
type SortDir = 'asc' | 'desc'

export default function HomePage() {
  const navigate = useNavigate()
  const { vouchers, superVouchers, sharedWithMe, loading, walletError, isOnline, addVoucher, updateVoucher, deleteVoucher, archiveVoucher, archiveExpired } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const [showForm, setShowForm] = useState(false)
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

  const expiredCount = vouchers.filter(v => getExpiryStatus(v.expiry_date) === 'expired').length

  const filtered = useMemo(() => {
    if (filterTab === 'shared_with_me') return [...sharedWithMe]

    let result = [...vouchers]

    if (filterTab === 'expiring') {
      result = result.filter(v => {
        const s = getExpiryStatus(v.expiry_date)
        return s === 'warning' || s === 'critical'
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
          const directMatch =
            v.store_name.toLowerCase().includes(q) ||
            v.code.toLowerCase().includes(q) ||
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
  }, [vouchers, filterTab, filterCats, search, sortKey, sortDir, superVouchers])

  // Filter out pending-delete vouchers from display
  const displayVouchers = useMemo(
    () => filtered.filter(v => !hiddenIds.has(v.id)),
    [filtered, hiddenIds]
  )

  async function handleSave(vData: any) {
    if (editingVoucher) {
      const usedAmount = editingVoucher.balance - vData.balance
      await updateVoucher(editingVoucher.id, vData)
      toast.success('שובר עודכן')

      if (usedAmount > 0) {
        sendUsageNotification(editingVoucher.store_name, usedAmount, vData.balance)
      }

      if (vData.balance <= 0) {
        const vId = editingVoucher.id
        const vName = editingVoucher.store_name
        setConfirm({
          title: 'השובר מומש במלואו',
          message: `יתרת "${vName}" הגיעה לאפס. להעביר לארכיון?`,
          onConfirm: async () => {
            setConfirm(null)
            await archiveVoucher(vId)
            toast.success('שובר הועבר לארכיון')
          },
        })
      }
    } else {
      try {
        await addVoucher(vData)
        toast.success('שובר נוסף!')
      } catch (err: any) {
        toast.error(err?.message || 'שגיאה בשמירת השובר')
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
      (t) => (
        <span>
          שובר נמחק{' '}
          <button
            onClick={() => {
              clearTimeout(pendingDeletesRef.current.get(id))
              pendingDeletesRef.current.delete(id)
              setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              toast.dismiss(t.id)
            }}
            className="underline font-semibold text-blue-600 mr-1"
          >
            ביטול
          </button>
        </span>
      ),
      { duration: 5000, icon: '🗑️' }
    )
  }

  function handleArchiveExpired() {
    setConfirm({
      title: 'ארכוב שוברים פגים',
      message: `להעביר ${expiredCount} שוברים פגי תוקף לארכיון?`,
      onConfirm: async () => { setConfirm(null); await archiveExpired(); toast.success('שוברים פגי תוקף הועברו לארכיון') },
    })
  }

  function requestDelete(id: string) {
    setConfirm({
      title: 'מחיקת שובר',
      message: 'פעולה זו אינה ניתנת לביטול.',
      onConfirm: () => { setConfirm(null); handleDelete(id) },
    })
  }

  function requestArchive(id: string) {
    setConfirm({
      title: 'העברה לארכיון',
      message: 'להעביר את השובר לארכיון?',
      onConfirm: async () => { setConfirm(null); await archiveVoucher(id); toast.success('הועבר לארכיון') },
    })
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
      title: 'ארכוב מרובה',
      message: `להעביר ${count} שוברים לארכיון?`,
      onConfirm: async () => {
        setConfirm(null)
        for (const id of selectedIds) await archiveVoucher(id)
        toast.success(`${count} שוברים הועברו לארכיון`)
        setSelectedIds(new Set()); setIsSelectMode(false)
      },
    })
  }

  function bulkDelete() {
    const count = selectedIds.size
    setConfirm({
      title: 'מחיקה מרובה',
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
      (t) => (
        <span>
          {count} שוברים נמחקו{' '}
          <button
            onClick={() => {
              timers.forEach((_, i) => {
                const id = ids[i]
                clearTimeout(pendingDeletesRef.current.get(id))
                pendingDeletesRef.current.delete(id)
                setHiddenIds(prev => { const s = new Set(prev); s.delete(id); return s })
              })
              toast.dismiss(t.id)
            }}
            className="underline font-semibold text-blue-600 mr-1"
          >
            ביטול
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

  return (
    <div className="flex-1 bg-gray-50">
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
      {/* Header */}
      <div className="bg-white border-b sticky top-0 z-30">
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h1 className="text-xl font-bold text-gray-900">השוברים שלי</h1>
              <p className="text-xs text-gray-500">{formatCurrency(totalBalance)} יתרה כוללת</p>
            </div>
            <div className="flex items-center gap-2">
              {!isOnline && <WifiOff className="w-4 h-4 text-orange-500" />}
              {expiredCount > 0 && !isSelectMode && (
                <button
                  onClick={handleArchiveExpired}
                  className="flex items-center gap-1 text-xs bg-orange-50 text-orange-600 px-3 py-1.5 rounded-full font-medium border border-orange-200"
                >
                  <Archive className="w-3.5 h-3.5" />
                  ארכב פגויים ({expiredCount})
                </button>
              )}
              {!isSelectMode ? (
                <button
                  onClick={() => setIsSelectMode(true)}
                  className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full font-medium hover:bg-gray-200"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  בחר
                </button>
              ) : (
                <button
                  onClick={exitSelectMode}
                  className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-full font-medium"
                >
                  <X className="w-3.5 h-3.5" />
                  ביטול
                </button>
              )}
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש לפי חנות, קוד, קטגוריה..."
              className="w-full pr-10 pl-9 py-2.5 bg-gray-100 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-gray-400 text-white flex items-center justify-center hover:bg-gray-500 transition-colors"
                aria-label="נקה חיפוש"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        {!isSelectMode && (
          <div className="flex items-center px-4 pb-2 gap-2 overflow-x-auto no-scrollbar">
            {([
              { key: 'all', label: `הכל (${vouchers.length})` },
              { key: 'expiring', label: '⚠️ פג בקרוב' },
              { key: 'shared', label: '👥 משותף' },
              { key: 'shared_with_me', label: `🤝 שותף איתי${sharedWithMe.length > 0 ? ` (${sharedWithMe.length})` : ''}` },
            ] as { key: FilterTab; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterTab(key)}
                className={`text-xs px-3 py-1.5 rounded-full font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                  filterTab === key ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={() => setViewMode(v => v === 'grid' ? 'rows' : 'grid')}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-full font-medium bg-gray-100 text-gray-500 hover:bg-gray-200"
              title={viewMode === 'grid' ? 'עבור לתצוגת שורות' : 'עבור לתצוגת רשת'}
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
              סינון
              {filterCats.length > 0 && <span className="bg-green-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs">{filterCats.length}</span>}
            </button>
          </div>
        )}

        {/* Select mode header */}
        {isSelectMode && (
          <div className="flex items-center px-4 pb-2 gap-2">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium bg-gray-100 text-gray-600"
            >
              {selectedIds.size === displayVouchers.length ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
              {selectedIds.size === displayVouchers.length ? 'בטל הכל' : 'בחר הכל'}
            </button>
            <span className="text-xs text-gray-500">{selectedIds.size} נבחרו</span>
          </div>
        )}

        {/* Filters panel */}
        {showFilters && !isSelectMode && (
          <div className="px-4 pb-3 border-t pt-3 bg-gray-50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-gray-600">קטגוריות</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-600 ml-2">מיון:</span>
                <select
                  value={sortKey}
                  onChange={e => setSortKey(e.target.value as SortKey)}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none"
                >
                  <option value="expiry">📅 תפוגה</option>
                  <option value="balance">₪ יתרה</option>
                  <option value="store">🏪 חנות</option>
                  <option value="added">🕐 הוספה</option>
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
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1,2,3,4].map(i => (
              <div key={i} className="h-32 bg-white rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : displayVouchers.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🎁</div>
            <p className="text-gray-500 font-medium">
              {search || filterCats.length > 0 || filterTab !== 'all' ? 'לא נמצאו שוברים' : 'אין שוברים עדיין'}
            </p>
            <p className="text-sm text-gray-400 mt-1">
              {!search && filterCats.length === 0 && filterTab === 'all' && 'לחץ + כדי להוסיף שובר ראשון'}
            </p>
          </div>
        ) : (
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
      </div>

      {/* Bulk action bar */}
      {isSelectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-20 left-0 right-0 z-40 px-4">
          <div className="bg-gray-900 text-white rounded-2xl p-3 flex items-center gap-3 shadow-xl">
            <span className="text-sm font-medium flex-1">{selectedIds.size} שוברים נבחרו</span>
            <button
              onClick={bulkArchive}
              className="flex items-center gap-1.5 px-4 py-2 bg-gray-700 rounded-xl text-sm font-medium hover:bg-gray-600"
            >
              <Archive className="w-4 h-4" />
              ארכיון
            </button>
            <button
              onClick={bulkDelete}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-600 rounded-xl text-sm font-medium hover:bg-red-500"
            >
              <Trash2 className="w-4 h-4" />
              מחיקה
            </button>
          </div>
        </div>
      )}

      {/* FAB */}
      {!isSelectMode && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 sm:left-auto sm:translate-x-0 sm:right-6 z-40 flex flex-col items-center gap-1">
          {limits.maxVouchers < Infinity && vouchers.length >= limits.maxVouchers - 3 && (
            <button
              onClick={() => openUpgradeSheet()}
              className="text-xs font-semibold px-3 py-1 rounded-full bg-amber-100 text-amber-700 border border-amber-200 shadow"
            >
              {vouchers.length}/{limits.maxVouchers} שוברים
            </button>
          )}
          <button
            onClick={() => {
              if (vouchers.length >= limits.maxVouchers) {
                openUpgradeSheet(`הגעת למגבלת ${limits.maxVouchers} השוברים בחינמי`)
                return
              }
              setEditingVoucher(undefined)
              setShowForm(true)
            }}
            className="w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full shadow-xl flex items-center justify-center hover:shadow-2xl transition-all active:scale-95"
          >
            <svg viewBox="0 0 28 28" className="w-7 h-7" fill="none">
              {/* diamond / gift-tag frame */}
              <rect x="6" y="6" width="16" height="16" rx="3" transform="rotate(45 14 14)" stroke="white" strokeWidth="2" fill="none"/>
              {/* plus sign */}
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
    </div>
  )
}
