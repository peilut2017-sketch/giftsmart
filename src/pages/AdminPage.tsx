import { useState, useEffect, useMemo } from 'react'
import { useT } from '../lib/i18n'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, getExpiryStatus, formatDate } from '../utils/helpers'
import { Shield, Users, Star, Download, Edit2, Trash2, Plus, Globe, BarChart2, Zap, ChevronDown, ChevronUp, Crown, Ticket, MessageSquare, Send, CheckCheck, Eye, Bell, ToggleLeft, ToggleRight, Image, GripVertical, Link, Flag, ShoppingBag, BadgeCheck, Percent, CreditCard, Tag, Building2, X, UserCheck, Activity } from 'lucide-react'
import toast from 'react-hot-toast'
import type { SuperVoucher, DiscountClub, DiscountBusiness, DiscountDeal, DiscountSubmission } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { SUPER_VOUCHER_STORES } from '../types'
import { usePageView } from '../hooks/usePageView'


interface UserRow {
  id: string
  email: string
  name?: string
  created_at: string
  pro_expires_at?: string | null
}

interface SystemStats {
  total_vouchers: number
  total_archived: number
  total_balance: number
  total_wallets: number
  total_users: number
}

interface Coupon {
  id: string
  code: string
  name: string
  type: 'general' | 'private'
  discount_type: 'months_free' | 'days_free' | 'percent' | 'fixed'
  discount_value: number
  stripe_coupon_code: string | null
  max_uses: number | null
  uses_count: number
  valid_until: string | null
  restricted_to_email: string | null
  first_time_only: boolean
  is_active: boolean
  created_at: string
}

interface SupportMessage {
  id: string
  user_id: string
  user_email: string | null
  user_name: string | null
  subject: string
  body: string
  category: string
  status: 'unread' | 'read' | 'replied'
  admin_reply: string | null
  replied_at: string | null
  created_at: string
  user_read_at: string | null
}

const CATEGORY_LABELS_KEYS: Record<string, string> = {
  billing: 'admin.category.billing',
  bug: 'admin.category.bug',
  feature: 'admin.category.feature',
  general: 'admin.category.general',
}

type Confirm = { title: string; message?: string; onConfirm: () => void }

export default function AdminPage() {
  const { t } = useT()
  const { user, profile, isAdmin } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, walletName, addSuperVoucher, updateSuperVoucher, deleteSuperVoucher, updateWalletName } = useVouchers()
  usePageView('admin')

  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [proCount, setProCount] = useState<number | null>(null)
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
  const [usersRefreshing, setUsersRefreshing] = useState(false)
  const [showUsers, setShowUsers] = useState(false)
  const [editingWalletName, setEditingWalletName] = useState(false)
  const [newWalletName, setNewWalletName] = useState(walletName)
  const [editingSV, setEditingSV] = useState<SuperVoucher | null>(null)
  const [showAddSV, setShowAddSV] = useState(false)
  const [svName, setSvName] = useState('')
  const [svStores, setSvStores] = useState('')
  const [svDesc, setSvDesc] = useState('')
  const [svGlobal, setSvGlobal] = useState(false)
  const [svBalanceUrl, setSvBalanceUrl] = useState('')
  const [showQuickSV, setShowQuickSV] = useState(false)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null)
  // Coupons
  const [coupons, setCoupons] = useState<Coupon[]>([])
  const [showCoupons, setShowCoupons] = useState(false)
  const [showAddCoupon, setShowAddCoupon] = useState(false)
  const [couponForm, setCouponForm] = useState({
    code: '', name: '', type: 'general' as 'general' | 'private',
    discount_type: 'months_free' as 'months_free' | 'days_free' | 'percent' | 'fixed',
    discount_value: 1, max_uses: '', valid_until: '',
    restricted_to_email: '', first_time_only: false,
    stripe_coupon_code: '',
  })
  // Messages
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [showMessages, setShowMessages] = useState(false)
  const [expandedMsgId, setExpandedMsgId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [sendingReply, setSendingReply] = useState<string | null>(null)
  const [msgReplies, setMsgReplies] = useState<Record<string, { id: string; sender: string; body: string; created_at: string }[]>>({})
  // Broadcasts
  const [showBroadcasts, setShowBroadcasts] = useState(false)
  const [broadcasts, setBroadcasts] = useState<{ id: string; subject: string; body: string; created_at: string }[]>([])
  const [broadcastForm, setBroadcastForm] = useState({ subject: '', body: '' })
  const [pushForm, setPushForm] = useState({ title: '', body: '' })
  const [sendingBroadcast, setSendingBroadcast] = useState(false)
  const [sendingPush, setSendingPush] = useState(false)
  // Reply editing
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null)
  const [editingReplyText, setEditingReplyText] = useState('')
  // Broadcast management
  const [editingBroadcastId, setEditingBroadcastId] = useState<string | null>(null)
  const [editingBroadcastForm, setEditingBroadcastForm] = useState({ subject: '', body: '' })
  const [broadcastViewers, setBroadcastViewers] = useState<Record<string, { user_email: string; viewed_at: string }[]>>({})
  const [loadingViewersFor, setLoadingViewersFor] = useState<string | null>(null)
  const [showViewersFor, setShowViewersFor] = useState<string | null>(null)
  // Premium flag
  const [premiumEnabled, setPremiumEnabled] = useState<boolean | null>(null)
  const [premiumToggling, setPremiumToggling] = useState(false)
  // Login banners
  const [showBanners, setShowBanners] = useState(false)
  const [banners, setBanners] = useState<{ id: string; image_url: string; is_active: boolean; display_duration: number; skip_allowed: boolean; display_order: number; created_at: string }[]>([])
  const [bannersLoaded, setBannersLoaded] = useState(false)
  const [uploadingBanner, setUploadingBanner] = useState(false)
  const [dragBannerId, setDragBannerId] = useState<string | null>(null)
  const [dragOverBannerId, setDragOverBannerId] = useState<string | null>(null)
  const [editingBannerId, setEditingBannerId] = useState<string | null>(null)
  const [bannerEditDuration, setBannerEditDuration] = useState(5)
  const [bannerEditSkip, setBannerEditSkip] = useState(true)
  // Operators (balance check)
  const [showOperators, setShowOperators] = useState(false)
  const [operators, setOperators] = useState<{ id: string; name: string; url: string }[]>([])
  const [operatorsLoaded, setOperatorsLoaded] = useState(false)
  const [showAddOperator, setShowAddOperator] = useState(false)
  const [operatorForm, setOperatorForm] = useState({ name: '', url: '' })
  const [editingOperator, setEditingOperator] = useState<{ id: string; name: string; url: string } | null>(null)
  // Operator picker in SV forms
  const [showSVOperatorPicker, setShowSVOperatorPicker] = useState(false)
  const [showEditSVOperatorPicker, setShowEditSVOperatorPicker] = useState(false)
  // Reports
  const [showReports, setShowReports] = useState(false)
  const [reports, setReports] = useState<{
    report_id: string
    reporter_email: string
    reported_email: string
    reason: string
    details: string | null
    status: string
    created_at: string
    purchase_id: string | null
    listing_id: string | null
    deal_id: string | null
    source: string | null
  }[]>([])
  const [reportsLoaded, setReportsLoaded] = useState(false)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [updatingReport, setUpdatingReport] = useState<string | null>(null)
  // Marketplace settings
  const [showMktSettings, setShowMktSettings] = useState(false)
  const [mktSettings, setMktSettings] = useState({ free_listing_days: 30, pro_listing_days: 60, verified_min_rating: 4.0, verified_min_sales: 5, watchlist_pro_only: true })
  const [mktSettingsLoaded, setMktSettingsLoaded] = useState(false)
  const [savingMktSettings, setSavingMktSettings] = useState(false)
  // Verified sellers
  const [showVerifiedSellers, setShowVerifiedSellers] = useState(false)
  const [verifiedSellers, setVerifiedSellers] = useState<{ user_id: string; name: string; email: string; is_verified: boolean; total_sales: number; avg_rating: number }[]>([])
  const [verifiedSellersLoaded, setVerifiedSellersLoaded] = useState(false)
  const [togglingVerified, setTogglingVerified] = useState<string | null>(null)
  // Marketplace access control
  const [marketplaceMode, setMarketplaceMode] = useState<'enabled' | 'disabled' | 'selective' | null>(null)
  const [settingMktMode, setSettingMktMode] = useState(false)
  const [showMktAccess, setShowMktAccess] = useState(false)
  const [accessRequests, setAccessRequests] = useState<{ user_id: string; user_email: string | null; user_name: string | null; message: string | null; status: string; updated_at: string }[]>([])
  const [accessRequestsLoaded, setAccessRequestsLoaded] = useState(false)
  const [handlingAccess, setHandlingAccess] = useState<string | null>(null)

  // ── Discount Matcher admin state ─────────────────────────────────────────
  const [showDiscounts, setShowDiscounts] = useState(false)
  const [discountTab, setDiscountTab] = useState<'clubs' | 'businesses' | 'deals' | 'submissions'>('deals')

  // Clubs
  const [adminClubs, setAdminClubs] = useState<DiscountClub[]>([])
  const [clubsLoaded, setClubsLoaded] = useState(false)
  const [showClubForm, setShowClubForm] = useState(false)
  const [editingClub, setEditingClub] = useState<DiscountClub | null>(null)
  const [clubForm, setClubForm] = useState({ name: '', logo_url: '', type: 'loyalty_club' as 'credit_card' | 'loyalty_club', is_active: true })

  // Businesses
  const [adminBusinesses, setAdminBusinesses] = useState<DiscountBusiness[]>([])
  const [businessesLoaded, setBusinessesLoaded] = useState(false)
  const [showBusinessForm, setShowBusinessForm] = useState(false)
  const [editingBusiness, setEditingBusiness] = useState<DiscountBusiness | null>(null)
  const [businessForm, setBusinessForm] = useState({ name: '', logo_url: '', website: '', tags: '' })

  // Deals
  const [adminDeals, setAdminDeals] = useState<DiscountDeal[]>([])
  const [dealsLoaded, setDealsLoaded] = useState(false)
  const [showDealForm, setShowDealForm] = useState(false)
  const [editingDeal, setEditingDeal] = useState<DiscountDeal | null>(null)
  const [dealForm, setDealForm] = useState({
    club_id: '', business_id: '', title: '', description: '',
    discount_type: 'percent' as 'percent' | 'fixed' | 'free_item' | 'other',
    discount_value: '', promo_code: '', external_link: '', tags: '',
    start_date: '', expiration_date: '', is_active: true,
  })
  const [savingDiscount, setSavingDiscount] = useState(false)

  // Quick-add inline (inside deal form)
  const [showQuickClub, setShowQuickClub] = useState(false)
  const [quickClubForm, setQuickClubForm] = useState({ name: '', type: 'loyalty_club' as 'credit_card' | 'loyalty_club' })
  const [showQuickBiz, setShowQuickBiz] = useState(false)
  const [quickBizForm, setQuickBizForm] = useState({ name: '', tags: '' })
  const [savingQuick, setSavingQuick] = useState(false)

  // Submissions
  const [submissions, setSubmissions] = useState<DiscountSubmission[]>([])
  const [submissionsLoaded, setSubmissionsLoaded] = useState(false)
  const [submissionFilter, setSubmissionFilter] = useState<'pending' | 'all'>('pending')
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectNote, setRejectNote] = useState<Record<string, string>>({})
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null)
  const [editingSubmission, setEditingSubmission] = useState<string | null>(null)
  const [editSubForm, setEditSubForm] = useState({
    club_name: '', business_name: '', title: '', description: '',
    discount_type: 'percent' as 'percent' | 'fixed' | 'free_item' | 'other',
    discount_value: '', promo_code: '', external_link: '',
    tags: '', start_date: '', expiration_date: '',
  })
  const [savingEdit, setSavingEdit] = useState(false)

  // ── Page views ───────────────────────────────────────────────────────────
  const [showPageViews, setShowPageViews] = useState(false)
  const [pageViewsFilter, setPageViewsFilter] = useState<'day' | 'week' | 'month' | 'custom'>('week')
  const [pageViewsFrom, setPageViewsFrom] = useState('')
  const [pageViewsTo, setPageViewsTo] = useState('')
  const [pageViewsData, setPageViewsData] = useState<{ page: string; views: number; unique_users: number }[]>([])
  const [pageViewsLoading, setPageViewsLoading] = useState(false)

  // ── Admin seller profiles ────────────────────────────────────────────────
  const [showSellerProfiles, setShowSellerProfiles] = useState(false)
  const [sellerProfilesList, setSellerProfilesList] = useState<{
    user_id: string; user_email: string | null; full_name: string; phone: string;
    email: string; id_number: string; verification_status: string; admin_note: string | null; created_at: string
  }[]>([])
  const [sellerProfilesLoaded, setSellerProfilesLoaded] = useState(false)
  const [updatingSellerProfile, setUpdatingSellerProfile] = useState<string | null>(null)
  const [rejectNoteInputs, setRejectNoteInputs] = useState<Record<string, string>>({})
  const [showRejectNoteFor, setShowRejectNoteFor] = useState<string | null>(null)

  async function loadSellerProfiles() {
    const { data } = await supabase.rpc('admin_get_seller_profiles')
    if (data) setSellerProfilesList(data)
    setSellerProfilesLoaded(true)
  }

  async function handleSellerProfileDecision(userId: string, status: 'verified' | 'rejected') {
    setUpdatingSellerProfile(userId)
    try {
      const note = rejectNoteInputs[userId] ?? null
      const { error } = await supabase.rpc('admin_update_seller_verification', {
        p_user_id: userId,
        p_status: status,
        p_note: status === 'rejected' ? note : null,
      })
      if (error) throw error
      toast.success(status === 'verified' ? t('admin.sellers.approved') : t('admin.sellers.rejected'))
      setSellerProfilesList(prev => prev.map(p => p.user_id === userId ? { ...p, verification_status: status, admin_note: status === 'rejected' ? note : null } : p))
      setShowRejectNoteFor(null)
    } catch {
      toast.error(t('admin.error'))
    } finally {
      setUpdatingSellerProfile(null)
    }
  }

  async function loadPageViews() {
    setPageViewsLoading(true)
    try {
      const now = new Date()
      let from: string
      let to: string = now.toISOString()
      if (pageViewsFilter === 'day') {
        const d = new Date(now); d.setHours(0, 0, 0, 0); from = d.toISOString()
      } else if (pageViewsFilter === 'week') {
        const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString()
      } else if (pageViewsFilter === 'month') {
        const d = new Date(now); d.setMonth(d.getMonth() - 1); from = d.toISOString()
      } else {
        from = pageViewsFrom ? new Date(pageViewsFrom).toISOString() : new Date(now.setMonth(now.getMonth() - 1)).toISOString()
        to = pageViewsTo ? new Date(pageViewsTo + 'T23:59:59').toISOString() : new Date().toISOString()
      }
      const { data } = await supabase.rpc('admin_get_page_views', { p_from: from, p_to: to })
      if (data) setPageViewsData(data)
    } finally {
      setPageViewsLoading(false)
    }
  }

  async function loadAdminClubs() {
    const { data } = await supabase.rpc('admin_get_all_clubs')
    if (data) setAdminClubs(data as DiscountClub[])
    setClubsLoaded(true)
  }
  async function loadAdminBusinesses() {
    const { data } = await supabase.rpc('admin_get_all_businesses')
    if (data) setAdminBusinesses(data as DiscountBusiness[])
    setBusinessesLoaded(true)
  }
  async function loadAdminDeals() {
    const { data } = await supabase.rpc('admin_get_all_deals')
    if (data) setAdminDeals(data as DiscountDeal[])
    setDealsLoaded(true)
  }

  async function handleSaveClub() {
    setSavingDiscount(true)
    try {
      const { error } = await supabase.rpc('admin_upsert_club', {
        p_id: editingClub?.id ?? null,
        p_name: clubForm.name,
        p_logo_url: clubForm.logo_url || null,
        p_type: clubForm.type,
        p_is_active: clubForm.is_active,
      })
      if (error) throw error
      toast.success(editingClub ? 'מועדון עודכן' : 'מועדון נוסף')
      setShowClubForm(false); setEditingClub(null)
      setClubForm({ name: '', logo_url: '', type: 'loyalty_club', is_active: true })
      await loadAdminClubs()
    } catch (e: any) { toast.error(e.message || t('admin.save.error')) }
    finally { setSavingDiscount(false) }
  }

  async function handleDeleteClub(id: string) {
    if (!window.confirm('למחוק מועדון זה? כל העסקאות המשויכות אליו יימחקו גם כן.')) return
    const { error } = await supabase.rpc('admin_delete_club', { p_id: id })
    if (error) { toast.error(error.message); return }
    toast.success('מועדון נמחק')
    setAdminClubs(prev => prev.filter(c => c.id !== id))
  }

  async function handleSaveBusiness() {
    setSavingDiscount(true)
    try {
      const tagsArr = businessForm.tags.split(',').map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.rpc('admin_upsert_business', {
        p_id: editingBusiness?.id ?? null,
        p_name: businessForm.name,
        p_logo_url: businessForm.logo_url || null,
        p_website: businessForm.website || null,
        p_tags: tagsArr,
        p_store_id: null,
      })
      if (error) throw error
      toast.success(editingBusiness ? 'עסק עודכן' : 'עסק נוסף')
      setShowBusinessForm(false); setEditingBusiness(null)
      setBusinessForm({ name: '', logo_url: '', website: '', tags: '' })
      await loadAdminBusinesses()
    } catch (e: any) { toast.error(e.message || t('admin.save.error')) }
    finally { setSavingDiscount(false) }
  }

  async function handleDeleteBusiness(id: string) {
    if (!window.confirm('למחוק עסק זה?')) return
    const { error } = await supabase.rpc('admin_delete_business', { p_id: id })
    if (error) { toast.error(error.message); return }
    toast.success('עסק נמחק')
    setAdminBusinesses(prev => prev.filter(b => b.id !== id))
  }

  async function handleSaveDeal() {
    if (!dealForm.club_id || !dealForm.business_id || !dealForm.title) {
      toast.error('מועדון, עסק וכותרת הם שדות חובה'); return
    }
    setSavingDiscount(true)
    try {
      const tagsArr = dealForm.tags.split(',').map(s => s.trim()).filter(Boolean)
      const { error } = await supabase.rpc('admin_upsert_deal', {
        p_id: editingDeal?.deal_id ?? null,
        p_club_id: dealForm.club_id,
        p_business_id: dealForm.business_id,
        p_title: dealForm.title,
        p_description: dealForm.description || null,
        p_discount_type: dealForm.discount_type,
        p_discount_value: dealForm.discount_value ? Number(dealForm.discount_value) : null,
        p_promo_code: dealForm.promo_code || null,
        p_external_link: dealForm.external_link || null,
        p_tags: tagsArr,
        p_start_date: dealForm.start_date || null,
        p_expiration_date: dealForm.expiration_date || null,
        p_is_active: dealForm.is_active,
      })
      if (error) throw error
      toast.success(editingDeal ? 'עסקה עודכנה' : 'עסקה נוספה')
      setShowDealForm(false); setEditingDeal(null)
      setDealForm({ club_id: '', business_id: '', title: '', description: '', discount_type: 'percent', discount_value: '', promo_code: '', external_link: '', tags: '', start_date: '', expiration_date: '', is_active: true })
      await loadAdminDeals()
    } catch (e: any) { toast.error(e.message || t('admin.save.error')) }
    finally { setSavingDiscount(false) }
  }

  async function handleDeleteDeal(id: string) {
    if (!window.confirm('למחוק עסקה זו?')) return
    const { error } = await supabase.rpc('admin_delete_deal', { p_id: id })
    if (error) { toast.error(error.message); return }
    toast.success('עסקה נמחקה')
    setAdminDeals(prev => prev.filter(d => d.deal_id !== id))
  }

  async function handleQuickAddClub() {
    if (!quickClubForm.name.trim()) return
    setSavingQuick(true)
    try {
      const { data, error } = await supabase.rpc('admin_upsert_club', {
        p_id: null, p_name: quickClubForm.name.trim(),
        p_logo_url: null, p_type: quickClubForm.type, p_is_active: true,
      })
      if (error) throw error
      await loadAdminClubs()
      setDealForm(f => ({ ...f, club_id: data as string }))
      setShowQuickClub(false)
      setQuickClubForm({ name: '', type: 'loyalty_club' })
      toast.success('מועדון נוסף ונבחר')
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingQuick(false) }
  }

  async function handleQuickAddBiz() {
    if (!quickBizForm.name.trim()) return
    setSavingQuick(true)
    try {
      const tagsArr = quickBizForm.tags.split(',').map(s => s.trim()).filter(Boolean)
      const { data, error } = await supabase.rpc('admin_upsert_business', {
        p_id: null, p_name: quickBizForm.name.trim(), p_logo_url: null,
        p_website: null, p_tags: tagsArr, p_store_id: null,
      })
      if (error) throw error
      await loadAdminBusinesses()
      setDealForm(f => ({ ...f, business_id: data as string }))
      setShowQuickBiz(false)
      setQuickBizForm({ name: '', tags: '' })
      toast.success('עסק נוסף ונבחר')
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingQuick(false) }
  }

  async function loadSubmissions() {
    setSubmissionsLoaded(false)
    const { data } = await supabase.rpc('admin_get_submissions',
      { p_status: submissionFilter === 'pending' ? 'pending' : null }
    )
    if (data) setSubmissions(data as DiscountSubmission[])
    setSubmissionsLoaded(true)
  }

  async function handleApproveSubmission(sub: DiscountSubmission) {
    setApprovingId(sub.id)
    try {
      const { error } = await supabase.rpc('admin_approve_submission', {
        p_id: sub.id, p_club_id: null, p_business_id: null, p_admin_notes: null,
      })
      if (error) throw error
      toast.success('עסקה אושרה ופורסמה!')
      await loadSubmissions()
      // Refresh deals list if open
      if (dealsLoaded) await loadAdminDeals()
    } catch (e: any) { toast.error(e.message) }
    finally { setApprovingId(null) }
  }

  async function handleRejectSubmission(id: string) {
    const note = rejectNote[id] || ''
    const { error } = await supabase.rpc('admin_reject_submission', {
      p_id: id, p_admin_notes: note || null,
    })
    if (error) { toast.error(error.message); return }
    toast.success('הגשה נדחתה')
    setShowRejectInput(null)
    setRejectNote(prev => { const n = { ...prev }; delete n[id]; return n })
    await loadSubmissions()
  }

  async function handleDeleteSubmission(id: string) {
    if (!window.confirm('למחוק הגשה זו?')) return
    const { error } = await supabase.rpc('admin_delete_submission', { p_id: id })
    if (error) { toast.error(error.message); return }
    toast.success('הגשה נמחקה')
    setSubmissions(prev => prev.filter(s => s.id !== id))
  }

  function openEditSubmission(sub: DiscountSubmission) {
    setEditingSubmission(sub.id)
    setShowRejectInput(null)
    setEditSubForm({
      club_name: sub.club_name,
      business_name: sub.business_name,
      title: sub.title,
      description: sub.description || '',
      discount_type: sub.discount_type,
      discount_value: sub.discount_value != null ? String(sub.discount_value) : '',
      promo_code: sub.promo_code || '',
      external_link: sub.external_link || '',
      tags: (sub.tags || []).join(', '),
      start_date: sub.start_date || '',
      expiration_date: sub.expiration_date || '',
    })
  }

  async function handleSaveEditSubmission(id: string) {
    setSavingEdit(true)
    try {
      const { error } = await supabase.rpc('admin_update_submission', {
        p_id: id,
        p_club_name: editSubForm.club_name,
        p_business_name: editSubForm.business_name,
        p_title: editSubForm.title,
        p_description: editSubForm.description || null,
        p_discount_type: editSubForm.discount_type,
        p_discount_value: editSubForm.discount_value ? Number(editSubForm.discount_value) : null,
        p_promo_code: editSubForm.promo_code || null,
        p_external_link: editSubForm.external_link || null,
        p_tags: editSubForm.tags.split(',').map(tag => tag.trim()).filter(Boolean),
        p_start_date: editSubForm.start_date || null,
        p_expiration_date: editSubForm.expiration_date || null,
      })
      if (error) throw error
      toast.success(t('admin.submissions.edit_saved'))
      setEditingSubmission(null)
      await loadSubmissions()
    } catch (e: any) { toast.error(e.message) }
    finally { setSavingEdit(false) }
  }

  function openEditClub(club: DiscountClub) {
    setEditingClub(club)
    setClubForm({ name: club.name, logo_url: club.logo_url || '', type: club.type, is_active: club.is_active })
    setShowClubForm(true)
  }

  function openEditBusiness(b: DiscountBusiness) {
    setEditingBusiness(b)
    setBusinessForm({ name: b.name, logo_url: b.logo_url || '', website: b.website || '', tags: b.tags.join(', ') })
    setShowBusinessForm(true)
  }

  function openEditDeal(d: DiscountDeal) {
    setEditingDeal(d)
    setDealForm({
      club_id: d.club_id, business_id: d.business_id, title: d.title,
      description: d.description || '', discount_type: d.discount_type,
      discount_value: d.discount_value != null ? String(d.discount_value) : '',
      promo_code: d.promo_code || '', external_link: d.external_link || '',
      tags: d.tags.join(', '),
      start_date: d.start_date || '', expiration_date: d.expiration_date || '',
      is_active: true,
    })
    setShowDealForm(true)
  }

  async function loadAccessRequests() {
    setAccessRequestsLoaded(false)
    const { data } = await supabase.rpc('admin_get_marketplace_requests')
    if (data) setAccessRequests(data)
    setAccessRequestsLoaded(true)
  }

  async function handleSetMarketplaceMode(mode: 'enabled' | 'disabled' | 'selective') {
    setSettingMktMode(true)
    try {
      await supabase.rpc('admin_set_marketplace_mode', { p_mode: mode })
      setMarketplaceMode(mode)
      toast.success(t('admin.market.mode.updated'))
    } catch {
      toast.error(t('admin.save.error'))
    } finally {
      setSettingMktMode(false)
    }
  }

  async function handleAccessDecision(userId: string, status: 'approved' | 'rejected') {
    setHandlingAccess(userId)
    try {
      await supabase.rpc('admin_set_marketplace_access', { p_user_id: userId, p_status: status })
      setAccessRequests(prev => prev.map(r => r.user_id === userId ? { ...r, status } : r))
      toast.success(status === 'approved' ? t('admin.access.approved') : t('admin.access.rejected'))
    } catch {
      toast.error(t('admin.error'))
    } finally {
      setHandlingAccess(null)
    }
  }

  const accessByUser = useMemo(
    () => new Map(accessRequests.map(r => [r.user_id, r.status])),
    [accessRequests]
  )

  // Load access requests when users list is expanded in selective mode
  useEffect(() => {
    if (showUsers && marketplaceMode === 'selective' && !accessRequestsLoaded) {
      loadAccessRequests()
    }
  }, [showUsers, marketplaceMode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadReports() {
    setReportsLoaded(false)
    setReportsError(null)
    const { data, error } = await supabase.rpc('admin_get_reports')
    if (error) {
      console.error('[admin] loadReports:', error)
      setReportsError(error.message || 'שגיאה לא ידועה')
    } else {
      setReports((data as typeof reports) || [])
    }
    setReportsLoaded(true)
  }

  async function updateReportStatus(reportId: string, status: string) {
    setUpdatingReport(reportId)
    try {
      const { error } = await supabase.rpc('admin_update_report_status', {
        p_report_id: reportId,
        p_status: status,
      })
      if (error) throw error
      setReports(prev => prev.map(r => r.report_id === reportId ? { ...r, status } : r))
      toast.success(t('admin.status.updated'))
    } catch {
      toast.error(t('admin.update.error'))
    } finally {
      setUpdatingReport(null)
    }
  }

  async function loadMktSettings() {
    if (mktSettingsLoaded) return
    const { data } = await supabase.rpc('get_marketplace_settings')
    if (data) setMktSettings({ free_listing_days: data.free_listing_days, pro_listing_days: data.pro_listing_days, verified_min_rating: Number(data.verified_min_rating), verified_min_sales: data.verified_min_sales, watchlist_pro_only: data.watchlist_pro_only })
    setMktSettingsLoaded(true)
  }

  async function saveMktSettings() {
    setSavingMktSettings(true)
    try {
      const { error } = await supabase.rpc('update_marketplace_settings', {
        p_free_listing_days: mktSettings.free_listing_days,
        p_pro_listing_days: mktSettings.pro_listing_days,
        p_verified_min_rating: mktSettings.verified_min_rating,
        p_verified_min_sales: mktSettings.verified_min_sales,
        p_watchlist_pro_only: mktSettings.watchlist_pro_only,
      })
      if (error) throw error
      toast.success(t('admin.mkt.settings.updated'))
    } catch {
      toast.error(t('admin.save.error'))
    } finally {
      setSavingMktSettings(false)
    }
  }

  async function loadVerifiedSellers() {
    if (verifiedSellersLoaded) return
    const { data } = await supabase.rpc('admin_get_verified_sellers')
    if (data) setVerifiedSellers(data)
    setVerifiedSellersLoaded(true)
  }

  async function handleSetVerified(userId: string, verified: boolean) {
    setTogglingVerified(userId)
    try {
      const { error } = await supabase.rpc('admin_set_verified_seller', { p_user_id: userId, p_verified: verified })
      if (error) throw error
      setVerifiedSellers(prev => prev.map(s => s.user_id === userId ? { ...s, is_verified: verified } : s))
      toast.success(verified ? t('admin.seller.verified') : t('admin.seller.unverified'))
    } catch {
      toast.error(t('admin.error'))
    } finally {
      setTogglingVerified(null)
    }
  }

  async function loadUsers(showSpinner = false) {
    if (showSpinner) setUsersRefreshing(true)
    try {
      const [{ data, error }, { data: subs }] = await Promise.all([
        supabase.rpc('get_all_users'),
        supabase.from('subscriptions').select('user_id, current_period_end').eq('plan', 'pro').eq('status', 'active'),
      ])
      if (error) {
        console.error('[admin] get_all_users error:', error)
        if (showSpinner) toast.error('שגיאה בטעינת משתמשים: ' + error.message)
        return
      }
      if (!data) return
      const subMap = new Map((subs ?? []).map((s: { user_id: string; current_period_end: string | null }) => [s.user_id, s.current_period_end]))
      setAllUsers(data.map((u: UserRow) => ({ ...u, pro_expires_at: subMap.has(u.id) ? subMap.get(u.id) ?? null : undefined })))
    } finally {
      if (showSpinner) setUsersRefreshing(false)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    supabase.rpc('get_system_stats').then(({ data }) => { if (data) setSystemStats(data) })
    loadUsers()
    supabase.rpc('admin_get_pro_count').then(({ data }) => { if (data !== null) setProCount(data) })
    supabase.rpc('get_premium_enabled').then(({ data }) => { setPremiumEnabled(data !== false) })
    supabase.rpc('get_marketplace_mode').then(({ data }) => { if (data) setMarketplaceMode(data as 'enabled' | 'disabled' | 'selective') })
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime on profiles is blocked by RLS (users see only their own row).
  // Instead: re-fetch when the admin returns to the tab, and poll every 60s.
  useEffect(() => {
    if (!isAdmin) return
    const onVisible = () => { if (document.visibilityState === 'visible') loadUsers() }
    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(() => loadUsers(), 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleTogglePremium() {
    if (premiumEnabled === null) return
    const next = !premiumEnabled
    setPremiumToggling(true)
    const { error } = await supabase.rpc('admin_set_premium_enabled', { p_enabled: next })
    setPremiumToggling(false)
    if (error) { toast.error(t('admin.error') + ': ' + error.message); return }
    setPremiumEnabled(next)
    toast.success(next ? t('admin.premium.enabled') : t('admin.premium.disabled'))
  }

  async function loadBanners() {
    if (bannersLoaded) return
    const { data } = await supabase.rpc('admin_get_banners')
    if (data) setBanners(data)
    setBannersLoaded(true)
  }

  async function handleUploadBanner(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error(t('admin.banner.image.required')); return }
    setUploadingBanner(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `banner-${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('banners').upload(path, file, { upsert: true })
      if (uploadErr) { toast.error(t('admin.banner.upload.error') + ': ' + uploadErr.message); return }
      const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path)
      const { data, error } = await supabase.rpc('admin_add_banner', {
        p_image_url: publicUrl,
        p_display_duration: 5,
        p_skip_allowed: true,
      })
      if (error) { toast.error(t('admin.save.error') + ': ' + error.message); return }
      if (data) setBanners(prev => [data, ...prev])
      toast.success(t('admin.banner.uploaded'))
    } finally {
      setUploadingBanner(false)
      e.target.value = ''
    }
  }

  async function handleToggleBanner(id: string, active: boolean) {
    await supabase.rpc('admin_toggle_banner', { p_id: id, p_active: active })
    setBanners(prev => prev.map(b => b.id === id ? { ...b, is_active: active } : b))
  }

  async function handleDeleteBanner(id: string, imageUrl: string) {
    setConfirm({
      title: t('admin.banner.delete.title'),
      message: t('admin.banner.delete.message'),
      onConfirm: async () => {
        setConfirm(null)
        // Delete from storage
        const path = imageUrl.split('/banners/').pop()
        if (path) await supabase.storage.from('banners').remove([path])
        await supabase.rpc('admin_delete_banner', { p_id: id })
        setBanners(prev => prev.filter(b => b.id !== id))
        toast.success(t('admin.banner.deleted'))
      },
    })
  }

  async function handleUpdateBannerSettings(id: string, duration: number, skip: boolean) {
    await supabase.rpc('admin_update_banner_settings', { p_id: id, p_display_duration: duration, p_skip_allowed: skip })
    setBanners(prev => prev.map(b => b.id === id ? { ...b, display_duration: duration, skip_allowed: skip } : b))
    setEditingBannerId(null)
    toast.success(t('admin.banner.settings.updated'))
  }

  async function handleReorderBanners(newOrder: typeof banners) {
    setBanners(newOrder)
    await supabase.rpc('admin_reorder_banners', { p_ids: newOrder.map(b => b.id) })
  }

  function handleBannerDragStart(id: string) {
    setDragBannerId(id)
  }

  function handleBannerDragOver(e: React.DragEvent, targetId: string) {
    e.preventDefault()
    setDragOverBannerId(targetId)
  }

  function handleBannerDrop(targetId: string) {
    if (!dragBannerId || dragBannerId === targetId) { setDragBannerId(null); setDragOverBannerId(null); return }
    const from = banners.findIndex(b => b.id === dragBannerId)
    const to = banners.findIndex(b => b.id === targetId)
    if (from === -1 || to === -1) return
    const reordered = [...banners]
    const [moved] = reordered.splice(from, 1)
    reordered.splice(to, 0, moved)
    setDragBannerId(null)
    setDragOverBannerId(null)
    handleReorderBanners(reordered)
  }

  async function loadOperators() {
    if (operatorsLoaded) return
    const { data } = await supabase.rpc('get_balance_operators')
    if (data) setOperators(data)
    setOperatorsLoaded(true)
  }

  async function handleCreateOperator() {
    if (!operatorForm.name.trim() || !operatorForm.url.trim()) return toast.error(t('admin.operator.required'))
    const { data, error } = await supabase.rpc('admin_create_operator', { p_name: operatorForm.name.trim(), p_url: operatorForm.url.trim() })
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    if (data) setOperators(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'he')))
    setOperatorForm({ name: '', url: '' })
    setShowAddOperator(false)
    toast.success(t('admin.operator.added'))
  }

  async function handleUpdateOperator() {
    if (!editingOperator) return
    await supabase.rpc('admin_update_operator', { p_id: editingOperator.id, p_name: editingOperator.name, p_url: editingOperator.url })
    setOperators(prev => prev.map(o => o.id === editingOperator.id ? editingOperator : o).sort((a, b) => a.name.localeCompare(b.name, 'he')))
    setEditingOperator(null)
    toast.success(t('admin.operator.updated'))
  }

  async function handleDeleteOperator(id: string, name: string) {
    setConfirm({
      title: t('admin.operator.delete.title'),
      message: t('admin.operator.delete.message', { name }),
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_operator', { p_id: id })
        setOperators(prev => prev.filter(o => o.id !== id))
        toast.success(t('admin.operator.deleted'))
      },
    })
  }

  // Realtime: notify admin when a new support message or thread reply arrives
  useEffect(() => {
    if (!isAdmin) return
    const channel = supabase
      .channel('admin-incoming-messages')
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'support_messages',
      }, (payload) => {
        const msg = payload.new as SupportMessage
        setMessages(prev => [msg, ...prev])
        if (Notification.permission === 'granted') {
          new Notification(t('admin.new.message'), {
            body: `${msg.user_email || t('admin.user')}: ${msg.subject}`,
            icon: '/logo.png',
          })
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'support_message_replies',
      }, (payload) => {
        const reply = payload.new as { id: string; message_id: string; sender: string; body: string; created_at: string }
        if (reply.sender === 'user') {
          // User replied — append to thread if expanded, mark message as unread
          setMsgReplies(prev => {
            const existing = prev[reply.message_id] || []
            if (existing.some(r => r.id === reply.id)) return prev
            return { ...prev, [reply.message_id]: [...existing, reply] }
          })
          setMessages(prev => prev.map(m => m.id === reply.message_id ? { ...m, status: 'unread' } : m))
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [isAdmin])

  useEffect(() => {
    if (!showCoupons || coupons.length > 0) return
    supabase.rpc('admin_get_coupons').then(({ data }) => { if (data) setCoupons(data) })
  }, [showCoupons])

  useEffect(() => {
    if (!showMessages || messages.length > 0) return
    supabase.rpc('admin_get_messages').then(({ data }) => { if (data) setMessages(data) })
  }, [showMessages])

  async function handleCreateCoupon() {
    if (!couponForm.code || !couponForm.name) return toast.error(t('admin.coupon.required'))
    const { data, error } = await supabase.rpc('admin_create_coupon', {
      p_code: couponForm.code,
      p_name: couponForm.name,
      p_type: couponForm.type,
      p_discount_type: couponForm.discount_type,
      p_discount_value: couponForm.discount_value,
      p_max_uses: couponForm.max_uses ? parseInt(couponForm.max_uses) : null,
      p_valid_until: couponForm.valid_until ? new Date(couponForm.valid_until).toISOString() : null,
      p_restricted_email: couponForm.restricted_to_email || null,
      p_first_time_only: couponForm.first_time_only,
      p_stripe_coupon_code: couponForm.stripe_coupon_code || null,
    })
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    setCoupons(prev => [data, ...prev])
    setShowAddCoupon(false)
    setCouponForm({ code: '', name: '', type: 'general', discount_type: 'months_free', discount_value: 1, max_uses: '', valid_until: '', restricted_to_email: '', first_time_only: false, stripe_coupon_code: '' })
    toast.success(t('admin.coupon.created'))
  }

  async function handleToggleCoupon(id: string, active: boolean) {
    await supabase.rpc('admin_toggle_coupon', { p_id: id, p_active: active })
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, is_active: active } : c))
  }

  async function handleDeleteCoupon(id: string, code: string) {
    setConfirm({
      title: t('admin.coupon.delete.title'),
      message: t('admin.coupon.delete.message', { code }),
      onConfirm: async () => {
        setConfirm(null)
        const { error } = await supabase.rpc('admin_delete_coupon', { p_id: id })
        if (error) { toast.error(t('admin.delete.error') + ': ' + error.message); return }
        setCoupons(prev => prev.filter(c => c.id !== id))
        toast.success(t('admin.coupon.deleted'))
      },
    })
  }

  async function handleExpandMessage(msg: SupportMessage) {
    const isNowOpen = expandedMsgId === msg.id
    setExpandedMsgId(isNowOpen ? null : msg.id)
    if (!isNowOpen) {
      if (msg.status === 'unread') {
        await supabase.rpc('admin_mark_message_read', { p_id: msg.id })
        setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'read' } : m))
      }
      // Load thread replies
      const { data } = await supabase.rpc('admin_get_message_replies', { p_message_id: msg.id })
      if (data) setMsgReplies(prev => ({ ...prev, [msg.id]: data }))
    }
  }

  async function handleSendReply(msg: SupportMessage) {
    const reply = replyTexts[msg.id]?.trim()
    if (!reply) return
    setSendingReply(msg.id)
    const { error } = await supabase.rpc('admin_reply_message', { p_id: msg.id, p_reply: reply })
    setSendingReply(null)
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    const newReply = { id: crypto.randomUUID(), sender: 'admin', body: reply, created_at: new Date().toISOString() }
    setMsgReplies(prev => ({ ...prev, [msg.id]: [...(prev[msg.id] || []), newReply] }))
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'replied', admin_reply: reply } : m))
    setReplyTexts(prev => ({ ...prev, [msg.id]: '' }))
    toast.success(t('admin.reply.sent'))
  }

  async function handleEditReply(replyId: string, msgId: string) {
    const newBody = editingReplyText.trim()
    if (!newBody) return
    const { error } = await supabase.rpc('admin_edit_reply', { p_reply_id: replyId, p_body: newBody })
    if (error) return toast.error(t('admin.edit.error') + ': ' + error.message)
    setMsgReplies(prev => ({
      ...prev,
      [msgId]: (prev[msgId] || []).map(r => r.id === replyId ? { ...r, body: newBody } : r),
    }))
    setEditingReplyId(null)
    toast.success(t('admin.reply.updated'))
  }

  async function handleDeleteReply(replyId: string, msgId: string) {
    setConfirm({
      title: t('admin.reply.delete.title'),
      message: t('admin.reply.delete.message'),
      onConfirm: async () => {
        setConfirm(null)
        const { error } = await supabase.rpc('admin_delete_reply', { p_reply_id: replyId })
        if (error) return toast.error(t('admin.delete.error') + ': ' + error.message)
        setMsgReplies(prev => ({
          ...prev,
          [msgId]: (prev[msgId] || []).filter(r => r.id !== replyId),
        }))
        toast.success(t('admin.reply.deleted'))
      },
    })
  }

  async function handleDeleteBroadcast(id: string) {
    setConfirm({
      title: t('admin.broadcast.delete.title'),
      message: t('admin.broadcast.delete.message'),
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_broadcast', { p_id: id })
        setBroadcasts(prev => prev.filter(b => b.id !== id))
        toast.success(t('admin.broadcast.deleted'))
      },
    })
  }

  async function handleSaveEditBroadcast(id: string) {
    const { subject, body } = editingBroadcastForm
    if (!subject.trim() || !body.trim()) return toast.error(t('admin.broadcast.required'))
    const { error } = await supabase.rpc('admin_edit_broadcast', { p_id: id, p_subject: subject.trim(), p_body: body.trim() })
    if (error) return toast.error(t('admin.update.error') + ': ' + error.message)
    setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, subject: subject.trim(), body: body.trim() } : b))
    setEditingBroadcastId(null)
    toast.success(t('admin.broadcast.updated'))
  }

  async function handleLoadBroadcastViewers(id: string) {
    if (showViewersFor === id) { setShowViewersFor(null); return }
    setLoadingViewersFor(id)
    const { data, error } = await supabase.rpc('admin_get_broadcast_views', { p_broadcast_id: id })
    setLoadingViewersFor(null)
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    setBroadcastViewers(prev => ({ ...prev, [id]: data || [] }))
    setShowViewersFor(id)
  }

  async function handleCreateBroadcast() {
    if (!broadcastForm.subject.trim() || !broadcastForm.body.trim()) return toast.error(t('admin.broadcast.required'))
    setSendingBroadcast(true)
    const { data, error } = await supabase.rpc('admin_create_broadcast', {
      p_subject: broadcastForm.subject.trim(),
      p_body: broadcastForm.body.trim(),
    })
    setSendingBroadcast(false)
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    setBroadcasts(prev => [data, ...prev])
    setBroadcastForm({ subject: '', body: '' })
    toast.success(t('admin.broadcast.sent'))
  }

  async function handleCreatePushBroadcast() {
    if (!pushForm.title.trim() || !pushForm.body.trim()) return toast.error(t('admin.push.required'))
    setSendingPush(true)
    const { data, error } = await supabase.rpc('admin_create_push_broadcast', {
      p_title: pushForm.title.trim(),
      p_body: pushForm.body.trim(),
    })
    setSendingPush(false)
    if (error) return toast.error(t('admin.error') + ': ' + error.message)
    if (data) setBroadcasts(prev => prev) // push broadcasts are separate
    setPushForm({ title: '', body: '' })
    toast.success(t('admin.push.sent'))
  }

  useEffect(() => {
    if (!showBroadcasts) return
    supabase.rpc('admin_get_broadcasts').then(({ data }) => { if (data) setBroadcasts(data) })
  }, [showBroadcasts])

  if (!isAdmin) {
    // Profile is still being fetched — don't flash "access restricted" for a real admin
    if (user && !profile) {
      return (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      )
    }
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center p-8">
          <Shield className="w-16 h-16 text-gray-200 mx-auto mb-4" />
          <p className="text-gray-500">גישה מוגבלת למנהל ראשי</p>
        </div>
      </div>
    )
  }

  const expiringSoon = vouchers.filter(v => ['warning', 'critical'].includes(getExpiryStatus(v.expiry_date))).length

  async function handleSaveWalletName() {
    await updateWalletName(newWalletName)
    setEditingWalletName(false)
    toast.success(t('admin.wallet.name.updated'))
  }

  async function handleAddSV() {
    if (!svName) return
    await addSuperVoucher({
      name: svName,
      description: svDesc,
      stores: svStores.split(/[,\n]/).map(s => s.trim()).filter(Boolean),
      is_global: svGlobal,
      balance_check_url: svBalanceUrl.trim() || undefined,
    })
    toast.success(svGlobal ? t('admin.sv.global.added') : t('admin.sv.added'))
    setSvName(''); setSvStores(''); setSvDesc(''); setSvGlobal(false); setSvBalanceUrl('')
    setShowAddSV(false)
  }

  async function handleQuickAddSV(name: string, stores: string[]) {
    const alreadyExists = superVouchers.some(sv => sv.name === name)
    if (alreadyExists) return toast(t('admin.sv.already.exists', { name }), { icon: 'ℹ️' })
    await addSuperVoucher({ name, stores, is_global: true })
    toast.success(t('admin.sv.quick.added', { name }))
  }

  function handleDeleteSV(id: string, name: string) {
    setConfirm({
      title: t('admin.sv.delete.title'),
      message: t('admin.sv.delete.message', { name }),
      onConfirm: async () => {
        setConfirm(null)
        await deleteSuperVoucher(id)
        toast.success(t('admin.sv.deleted'))
      },
    })
  }

  async function handleClearUserData(u: UserRow) {
    setDeleteTarget(null)
    const { error } = await supabase.rpc('admin_clear_user_data', { target_user_id: u.id })
    if (error) { toast.error('שגיאה: ' + error.message); return }
    toast.success(`נתוני ${u.email} נמחקו — המשתמש צריך להתנתק ולהתחבר מחדש`, { duration: 5000 })
  }

  async function handleDeleteUser(u: UserRow) {
    setDeleteTarget(null)
    const { error } = await supabase.rpc('admin_delete_user', { target_user_id: u.id })
    if (error) { toast.error('שגיאה: ' + error.message); return }
    setAllUsers(prev => prev.filter(x => x.id !== u.id))
    setSystemStats(prev => prev ? { ...prev, total_users: prev.total_users - 1 } : prev)
    toast.success(`${u.email} נמחק`)
  }

  async function exportCSV() {
    const all = [...vouchers, ...archivedVouchers]
    const rows = [
      ['חנות', 'קוד', 'יתרה', 'סכום מקורי', 'תפוגה', 'קטגוריות', 'תגיות', 'ארכיון'],
      ...all.map(v => [
        v.store_name, v.code, v.balance, v.amount,
        v.expiry_date || '', v.categories.join(';'), v.tags.join(';'),
        v.is_archived ? 'כן' : 'לא'
      ])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'vouchers.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('קובץ CSV הורד!')
  }

  async function exportUsersCSV() {
    if (!allUsers.length) return toast.error('אין נתוני משתמשים')
    const rows = [
      ['מייל', 'שם', 'תאריך הרשמה'],
      ...allUsers.map(u => [u.email, u.name || '', formatDate(u.created_at)])
    ]
    const csv = rows.map(r => r.join(',')).join('\n')
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'users.csv'; a.click()
    URL.revokeObjectURL(url)
    toast.success('רשימת משתמשים הורדה!')
  }

  const usersCount = systemStats?.total_users ?? null

  // Inbox counts (fetched on every load)
  const [inboxCounts, setInboxCounts] = useState<{ support_unread: number; reports_pending: number; submissions_pending: number } | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    supabase.rpc('admin_get_inbox_counts').then(({ data }) => {
      if (data) setInboxCounts(data as typeof inboxCounts)
    })
  }, [isAdmin]) // eslint-disable-line react-hooks/exhaustive-deps

  const inboxTotal = (inboxCounts?.support_unread ?? 0) + (inboxCounts?.reports_pending ?? 0) + (inboxCounts?.submissions_pending ?? 0)

  return (
    <div className="flex-1 bg-gray-50">
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 z-[90] flex items-center justify-center p-4" onClick={() => setDeleteTarget(null)}>
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900 mb-1">פעולה על משתמש</h3>
            <p className="text-sm text-gray-500 mb-1">{deleteTarget.email}</p>
            <p className="text-xs text-gray-400 mb-5">בחר פעולה — לא ניתן לשחזר</p>
            <div className="space-y-2">
              <button
                onClick={() => handleClearUserData(deleteTarget)}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-medium text-sm transition-colors"
              >
                מחק נתונים בלבד (שמור חשבון)
              </button>
              <button
                onClick={() => handleDeleteUser(deleteTarget)}
                className="w-full py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl font-medium text-sm transition-colors"
              >
                מחק משתמש לגמרי כולל נתונים
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-full py-3 bg-gray-100 text-gray-700 rounded-2xl font-medium text-sm transition-colors"
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          danger
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="bg-white border-b px-4 py-4">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <Shield className="w-5 h-5 text-green-600" />
          פאנל מנהל
        </h1>
      </div>

      <div className="p-4 pb-24 space-y-4">

        {/* ── Inbox summary banner ── */}
        {inboxCounts !== null && inboxTotal > 0 && (
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-amber-200">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span className="text-sm font-bold text-gray-800">
                {inboxTotal} פריטים ממתינים לטיפול
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {inboxCounts.support_unread > 0 && (
                <button
                  onClick={() => { setShowMessages(true); setTimeout(() => document.getElementById('admin-messages')?.scrollIntoView({ behavior: 'smooth' }), 100) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">{inboxCounts.support_unread}</span>
                  הודעות תמיכה
                </button>
              )}
              {inboxCounts.reports_pending > 0 && (
                <button
                  onClick={() => { setShowReports(true); setTimeout(() => document.getElementById('admin-reports')?.scrollIntoView({ behavior: 'smooth' }), 100) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-red-600 text-white flex items-center justify-center text-[10px] font-bold">{inboxCounts.reports_pending}</span>
                  דיווחי משתמשים
                </button>
              )}
              {inboxCounts.submissions_pending > 0 && (
                <button
                  onClick={() => { setShowDiscounts(true); setDiscountTab('submissions'); setTimeout(() => document.getElementById('admin-discounts')?.scrollIntoView({ behavior: 'smooth' }), 100) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100 transition-colors"
                >
                  <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">{inboxCounts.submissions_pending}</span>
                  הגשות הנחות
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Premium feature flag ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${premiumEnabled ? 'bg-amber-50' : 'bg-green-50'}`}>
                <Crown className={`w-5 h-5 ${premiumEnabled ? 'text-amber-500' : 'text-green-600'}`} />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">מערך מנויים פרמיום</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {premiumEnabled === null
                    ? 'טוען...'
                    : premiumEnabled
                      ? 'פעיל — חלוקה בין Free ו-Pro'
                      : 'מושבת — כל המשתמשים עם כל הפיצ\'רים'}
                </p>
              </div>
            </div>
            <button
              onClick={handleTogglePremium}
              disabled={premiumToggling || premiumEnabled === null}
              className="flex items-center gap-1.5 disabled:opacity-50"
            >
              {premiumEnabled
                ? <ToggleRight className="w-9 h-9 text-amber-500" />
                : <ToggleLeft className="w-9 h-9 text-gray-300" />}
            </button>
          </div>
          {!premiumEnabled && (
            <p className="mt-2 text-xs text-green-700 bg-green-50 rounded-xl px-3 py-2">
              המנויים עדיין קיימים ב-DB — הפעלה מחדש תשחזר את ההגבלות
            </p>
          )}
        </div>

        {/* ── Marketplace Access Control ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-50">
              <ShoppingBag className="w-5 h-5 text-purple-500" />
            </div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">שוק השוברים</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {marketplaceMode === null ? 'טוען...' : marketplaceMode === 'enabled' ? 'פתוח לכולם' : marketplaceMode === 'disabled' ? 'סגור לכולם' : 'לפי הרשאה'}
              </p>
            </div>
          </div>

          {/* Mode selector */}
          <div className="flex gap-2 mb-3">
            {(['enabled', 'selective', 'disabled'] as const).map(mode => {
              const labels = { enabled: 'פתוח לכולם', selective: 'לפי הרשאה', disabled: 'סגור' }
              const colors = {
                enabled:   { active: 'bg-green-500 text-white', inactive: 'bg-gray-100 text-gray-500' },
                selective: { active: 'bg-purple-500 text-white', inactive: 'bg-gray-100 text-gray-500' },
                disabled:  { active: 'bg-red-500 text-white', inactive: 'bg-gray-100 text-gray-500' },
              }
              const isActive = marketplaceMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => handleSetMarketplaceMode(mode)}
                  disabled={settingMktMode || marketplaceMode === null}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold transition-all disabled:opacity-50 ${isActive ? colors[mode].active : colors[mode].inactive}`}
                >
                  {labels[mode]}
                </button>
              )
            })}
          </div>

          {/* Access requests toggle */}
          <button
            onClick={() => { setShowMktAccess(!showMktAccess); if (!showMktAccess && !accessRequestsLoaded) loadAccessRequests() }}
            className="w-full flex items-center justify-between text-sm text-gray-600 py-2"
          >
            <span className="font-medium">בקשות גישה</span>
            <div className="flex items-center gap-1">
              {accessRequests.filter(r => r.status === 'pending').length > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                  {accessRequests.filter(r => r.status === 'pending').length}
                </span>
              )}
              {showMktAccess ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>

          {showMktAccess && (
            <div className="mt-2 space-y-2">
              {!accessRequestsLoaded ? (
                <p className="text-xs text-gray-400 text-center py-3">טוען...</p>
              ) : accessRequests.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">אין בקשות גישה</p>
              ) : accessRequests.map(req => (
                <div key={req.user_id} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{req.user_name || req.user_email || req.user_id}</p>
                      {req.user_email && req.user_name && <p className="text-xs text-gray-400 truncate">{req.user_email}</p>}
                      {req.message && <p className="text-xs text-gray-500 mt-1 italic">"{req.message}"</p>}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      req.status === 'approved' ? 'bg-green-100 text-green-700'
                      : req.status === 'rejected' ? 'bg-red-100 text-red-600'
                      : 'bg-amber-100 text-amber-700'
                    }`}>
                      {req.status === 'approved' ? 'מאושר' : req.status === 'rejected' ? 'נדחה' : 'ממתין'}
                    </span>
                  </div>
                  {req.status === 'pending' && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={() => handleAccessDecision(req.user_id, 'approved')}
                        disabled={handlingAccess === req.user_id}
                        className="flex-1 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                      >
                        {handlingAccess === req.user_id ? '...' : 'אשר'}
                      </button>
                      <button
                        onClick={() => handleAccessDecision(req.user_id, 'rejected')}
                        disabled={handlingAccess === req.user_id}
                        className="flex-1 py-1.5 bg-red-100 text-red-600 text-xs font-semibold rounded-lg disabled:opacity-50"
                      >
                        דחה
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System Stats */}
        <div className="bg-gradient-to-br from-slate-700 to-slate-800 rounded-3xl p-5 text-white">
          <div className="flex items-center gap-2 mb-3">
            <BarChart2 className="w-4 h-4 text-slate-300" />
            <h3 className="text-sm text-slate-300 font-medium">סטטיסטיקות מערכת</h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">יתרה כוללת (כל הארנקים)</p>
              <p className="text-xl font-bold">
                {systemStats
                  ? formatCurrency(systemStats.total_balance)
                  : <span className="inline-block w-24 h-6 bg-slate-600 rounded-lg animate-pulse" />}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">שוברים פעילים</p>
              <p className="text-xl font-bold">
                {systemStats
                  ? systemStats.total_vouchers
                  : <span className="inline-block w-10 h-6 bg-slate-600 rounded-lg animate-pulse" />}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארכיון</p>
              <p className="text-xl font-bold">
                {systemStats
                  ? systemStats.total_archived
                  : <span className="inline-block w-10 h-6 bg-slate-600 rounded-lg animate-pulse" />}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארנקים</p>
              <p className="text-xl font-bold">
                {systemStats
                  ? systemStats.total_wallets
                  : <span className="inline-block w-8 h-6 bg-slate-600 rounded-lg animate-pulse" />}
              </p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-600 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">
                משתמשים:&nbsp;
                <span className="font-bold text-white">
                  {usersCount === null
                    ? <span className="inline-block w-8 h-4 bg-slate-600 rounded animate-pulse align-middle" />
                    : usersCount}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-300">
                מנויי Pro:&nbsp;
                <span className="font-bold text-amber-300">
                  {proCount === null
                    ? <span className="inline-block w-8 h-4 bg-slate-600 rounded animate-pulse align-middle" />
                    : proCount}
                </span>
              </span>
            </div>
          </div>
          {expiringSoon > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <span className="text-xs bg-orange-400/20 text-orange-300 px-2 py-1 rounded-lg">
                {expiringSoon} שוברים פגים בקרוב
              </span>
            </div>
          )}
        </div>

        {/* Registered Users List */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowUsers(v => { if (!v) loadUsers(true); return !v })}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              רשימת משתמשים ({allUsers.length || usersCount || '...'})
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={e => { e.stopPropagation(); loadUsers(true) }}
                className="text-xs text-blue-500 bg-blue-50 px-2.5 py-1 rounded-lg flex items-center gap-1"
                title="רענן רשימת משתמשים"
              >
                {usersRefreshing
                  ? <div className="w-3 h-3 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                  : '↺'}
                רענן
              </button>
              {allUsers.length > 0 && (
                <button
                  onClick={e => { e.stopPropagation(); exportUsersCSV() }}
                  className="text-xs text-green-600 bg-green-50 px-2.5 py-1 rounded-lg"
                >
                  ייצוא
                </button>
              )}
              {showUsers ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>
          {showUsers && (
            <div className="border-t divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {allUsers.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">
                  הרץ את <code className="bg-gray-100 px-1 rounded text-xs">supabase-admin-functions.sql</code> כדי לראות נתונים
                </p>
              ) : allUsers.map(u => {
                const mktStatus = marketplaceMode === 'selective' ? (accessByUser.get(u.id) ?? 'none') : null
                return (
                <div key={u.id} className="flex items-center justify-between px-4 py-2.5 gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">{u.email}</p>
                    {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {u.pro_expires_at !== undefined && (
                      <div className="text-right">
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Pro ★</span>
                        {u.pro_expires_at && (
                          <p className="text-[10px] text-gray-400 mt-0.5">
                            עד {new Date(u.pro_expires_at).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </p>
                        )}
                      </div>
                    )}
                    {mktStatus !== null && (
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          mktStatus === 'approved' ? 'bg-green-100 text-green-700' :
                          mktStatus === 'pending'  ? 'bg-amber-100 text-amber-700' :
                          mktStatus === 'rejected' ? 'bg-red-100 text-red-600' :
                                                     'bg-gray-100 text-gray-500'
                        }`}>
                          {mktStatus === 'approved' ? '✓ שוק' :
                           mktStatus === 'pending'  ? '⏳ ממתין' :
                           mktStatus === 'rejected' ? '✗ נדחה' : '— שוק'}
                        </span>
                        {mktStatus !== 'approved' ? (
                          <button
                            onClick={() => handleAccessDecision(u.id, 'approved')}
                            disabled={handlingAccess === u.id}
                            className="text-[10px] bg-green-500 text-white px-2 py-0.5 rounded-full disabled:opacity-50"
                            title="אשר גישה לשוק"
                          >
                            אשר
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAccessDecision(u.id, 'rejected')}
                            disabled={handlingAccess === u.id}
                            className="text-[10px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full disabled:opacity-50"
                            title="בטל גישה לשוק"
                          >
                            בטל
                          </button>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-gray-400">{formatDate(u.created_at)}</p>
                    {u.id !== user?.id && (
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                        title="מחק משתמש"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Wallet name */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">שם הארנק</h3>
          {!editingWalletName ? (
            <div className="flex items-center justify-between">
              <span className="text-gray-800">{walletName}</span>
              <button onClick={() => { setEditingWalletName(true); setNewWalletName(walletName) }} className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-xl">
                שנה
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input value={newWalletName} onChange={e => setNewWalletName(e.target.value)} className="flex-1 px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <button onClick={handleSaveWalletName} className="px-4 py-2 bg-green-500 text-white rounded-xl text-sm">שמור</button>
              <button onClick={() => setEditingWalletName(false)} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-xl text-sm">ביטול</button>
            </div>
          )}
        </div>

        {/* Super Vouchers */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> שוברי-על ({superVouchers.length})
            </h3>
            <div className="flex gap-2">
              <button
                onClick={() => setShowQuickSV(v => !v)}
                className="text-sm text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl flex items-center gap-1"
              >
                <Zap className="w-3.5 h-3.5" /> מהיר
              </button>
              <button onClick={() => setShowAddSV(true)} className="text-sm text-green-600 bg-green-50 px-3 py-1.5 rounded-xl flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> הוסף
              </button>
            </div>
          </div>

          {/* Quick add from presets */}
          {showQuickSV && (
            <div className="bg-blue-50 rounded-2xl p-3 mb-3">
              <p className="text-xs text-blue-700 font-medium mb-2">הוסף שוברי-על ידועים (גלובלי אוטומטי):</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(SUPER_VOUCHER_STORES).map(([name, stores]) => {
                  const exists = superVouchers.some(sv => sv.name === name)
                  return (
                    <button
                      key={name}
                      onClick={() => handleQuickAddSV(name, stores)}
                      disabled={exists}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                        exists
                          ? 'bg-gray-200 text-gray-400 cursor-default'
                          : 'bg-white border border-blue-200 text-blue-700 hover:bg-blue-100'
                      }`}
                    >
                      {exists ? '✓ ' : ''}{name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {showAddSV && (
            <div className="bg-gray-50 rounded-2xl p-4 mb-3 space-y-2">
              <input value={svName} onChange={e => setSvName(e.target.value)} placeholder="שם שובר-על" className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <input value={svDesc} onChange={e => setSvDesc(e.target.value)} placeholder="תיאור (אופציונלי)" className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300" />
              <textarea value={svStores} onChange={e => setSvStores(e.target.value)} placeholder="חנויות מכבדות (כל חנות בשורה נפרדת או מופרדות בפסיק)" rows={3} className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 resize-y" />
              <div className="relative">
                <div className="flex gap-1.5">
                  <input value={svBalanceUrl} onChange={e => setSvBalanceUrl(e.target.value)} placeholder="לינק לבדיקת יתרה (אופציונלי)" type="url" className="flex-1 px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 min-w-0" dir="ltr" />
                  <button
                    type="button"
                    onClick={() => { setShowSVOperatorPicker(v => !v); if (!operatorsLoaded) loadOperators() }}
                    className="flex-shrink-0 px-2 py-2 bg-teal-50 border border-teal-200 text-teal-600 rounded-xl text-xs font-medium flex items-center gap-1 whitespace-nowrap"
                  >
                    <Link className="w-3 h-3" /> מפעיל
                  </button>
                </div>
                {showSVOperatorPicker && operators.length > 0 && (
                  <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                    {operators.map(op => (
                      <button
                        key={op.id}
                        type="button"
                        onClick={() => { setSvBalanceUrl(op.url); setShowSVOperatorPicker(false) }}
                        className="w-full text-right px-3 py-2 text-sm hover:bg-teal-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                      >
                        <span className="font-medium text-gray-800">{op.name}</span>
                        <span className="text-xs text-gray-400 truncate max-w-[120px]" dir="ltr">{op.url}</span>
                      </button>
                    ))}
                  </div>
                )}
                {showSVOperatorPicker && operators.length === 0 && operatorsLoaded && (
                  <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow p-3 z-20">
                    <p className="text-xs text-gray-400 text-center">אין מפעילים — הוסף דרך "מפעילי שוברים"</p>
                  </div>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input type="checkbox" checked={svGlobal} onChange={e => setSvGlobal(e.target.checked)} className="w-4 h-4 accent-green-500" />
                <Globe className="w-4 h-4 text-blue-500" />
                גלובלי — יוצג לכל המשתמשים
              </label>
              <div className="flex gap-2">
                <button onClick={handleAddSV} className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm">הוסף</button>
                <button onClick={() => setShowAddSV(false)} className="flex-1 bg-gray-200 py-2 rounded-xl text-sm">ביטול</button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {superVouchers.map(sv => (
              <div key={sv.id} className="border border-gray-100 rounded-2xl p-3">
                {editingSV?.id === sv.id ? (
                  <div className="space-y-2">
                    <input
                      value={editingSV.name}
                      onChange={e => setEditingSV({ ...editingSV, name: e.target.value })}
                      className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                    <textarea
                      value={editingSV.stores.join('\n')}
                      onChange={e => setEditingSV({ ...editingSV, stores: e.target.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean) })}
                      rows={3}
                      className="w-full px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 resize-none"
                    />
                    <div className="relative">
                      <div className="flex gap-1.5">
                        <input
                          type="url"
                          value={editingSV.balance_check_url || ''}
                          onChange={e => setEditingSV({ ...editingSV, balance_check_url: e.target.value })}
                          placeholder="לינק לבדיקת יתרה (אופציונלי)"
                          className="flex-1 px-3 py-2 border rounded-xl text-base focus:outline-none focus:ring-2 focus:ring-green-300 min-w-0"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={() => { setShowEditSVOperatorPicker(v => !v); if (!operatorsLoaded) loadOperators() }}
                          className="flex-shrink-0 px-2 py-2 bg-teal-50 border border-teal-200 text-teal-600 rounded-xl text-xs font-medium flex items-center gap-1 whitespace-nowrap"
                        >
                          <Link className="w-3 h-3" /> מפעיל
                        </button>
                      </div>
                      {showEditSVOperatorPicker && operators.length > 0 && (
                        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-40 overflow-y-auto">
                          {operators.map(op => (
                            <button
                              key={op.id}
                              type="button"
                              onClick={() => { setEditingSV({ ...editingSV, balance_check_url: op.url }); setShowEditSVOperatorPicker(false) }}
                              className="w-full text-right px-3 py-2 text-sm hover:bg-teal-50 flex items-center justify-between gap-2 border-b border-gray-50 last:border-0"
                            >
                              <span className="font-medium text-gray-800">{op.name}</span>
                              <span className="text-xs text-gray-400 truncate max-w-[120px]" dir="ltr">{op.url}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {showEditSVOperatorPicker && operators.length === 0 && operatorsLoaded && (
                        <div className="absolute top-full right-0 left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow p-3 z-20">
                          <p className="text-xs text-gray-400 text-center">אין מפעילים — הוסף דרך "מפעילי שוברים"</p>
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={editingSV.is_global ?? false} onChange={e => setEditingSV({ ...editingSV, is_global: e.target.checked })} className="w-4 h-4 accent-green-500" />
                      <Globe className="w-4 h-4 text-blue-500" />
                      גלובלי
                    </label>
                    <div className="flex gap-2">
                      <button onClick={() => { updateSuperVoucher(sv.id, editingSV); setEditingSV(null); toast.success('עודכן') }} className="flex-1 bg-green-500 text-white py-2 rounded-xl text-sm">שמור</button>
                      <button onClick={() => setEditingSV(null)} className="flex-1 bg-gray-100 py-2 rounded-xl text-sm">ביטול</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-gray-800 text-sm">{sv.name}</p>
                        {sv.is_global && <Globe className="w-3.5 h-3.5 text-blue-400" aria-label="גלובלי" />}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{sv.stores.length} חנויות</p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setEditingSV(sv)} className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteSV(sv.id, sv.name)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Coupons ── */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowCoupons(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Ticket className="w-4 h-4 text-purple-500" />
              קופונים ({coupons.length})
            </span>
            <div className="flex items-center gap-2">
              {showCoupons && (
                <button
                  onClick={e => { e.stopPropagation(); setShowAddCoupon(v => !v) }}
                  className="text-xs text-purple-600 bg-purple-50 px-2.5 py-1 rounded-lg flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> קופון חדש
                </button>
              )}
              {showCoupons ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>

          {showCoupons && (
            <div className="border-t">
              {showAddCoupon && (
                <div className="p-4 bg-purple-50 border-b space-y-2">
                  <p className="text-xs font-semibold text-purple-700 mb-2">קופון חדש</p>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      value={couponForm.code}
                      onChange={e => setCouponForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                      placeholder="קוד (SUMMER25)"
                      className="px-3 py-2 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                      dir="ltr"
                    />
                    <input
                      value={couponForm.name}
                      onChange={e => setCouponForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="שם פנימי"
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={couponForm.type}
                      onChange={e => setCouponForm(f => ({ ...f, type: e.target.value as any }))}
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    >
                      <option value="general">כללי</option>
                      <option value="private">פרטי</option>
                    </select>
                    <select
                      value={couponForm.discount_type}
                      onChange={e => setCouponForm(f => ({ ...f, discount_type: e.target.value as any }))}
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    >
                      <option value="months_free">חודשים חינם</option>
                      <option value="days_free">ימים חינם</option>
                      <option value="percent">% הנחה באחוזים</option>
                      <option value="fixed">₪ הנחה קבועה</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1 border rounded-xl px-3">
                      <input
                        type="number" min={1} max={couponForm.discount_type === 'percent' ? 100 : 999}
                        value={couponForm.discount_value}
                        onChange={e => setCouponForm(f => ({ ...f, discount_value: parseInt(e.target.value) || 1 }))}
                        className="w-full text-sm py-2 focus:outline-none"
                      />
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {couponForm.discount_type === 'months_free' ? 'חודשים' :
                         couponForm.discount_type === 'days_free' ? 'ימים' :
                         couponForm.discount_type === 'percent' ? '%' : '₪'}
                      </span>
                    </div>
                    <input
                      type="number" min={1}
                      value={couponForm.max_uses}
                      onChange={e => setCouponForm(f => ({ ...f, max_uses: e.target.value }))}
                      placeholder="מקס שימושים"
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </div>
                  {(couponForm.discount_type === 'percent' || couponForm.discount_type === 'fixed') && (
                    <input
                      value={couponForm.stripe_coupon_code}
                      onChange={e => setCouponForm(f => ({ ...f, stripe_coupon_code: e.target.value.toUpperCase() }))}
                      placeholder="קוד קופון Stripe (אופציונלי)"
                      className="w-full px-3 py-2 border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-300"
                      dir="ltr"
                    />
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="date"
                      value={couponForm.valid_until}
                      onChange={e => setCouponForm(f => ({ ...f, valid_until: e.target.value }))}
                      className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    {couponForm.type === 'private' && (
                      <input
                        value={couponForm.restricted_to_email}
                        onChange={e => setCouponForm(f => ({ ...f, restricted_to_email: e.target.value }))}
                        placeholder="אימייל מוגבל"
                        type="email"
                        className="px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                        dir="ltr"
                      />
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input type="checkbox" checked={couponForm.first_time_only}
                      onChange={e => setCouponForm(f => ({ ...f, first_time_only: e.target.checked }))}
                      className="w-4 h-4 accent-purple-500" />
                    חדשים בלבד (למי שמעולם לא היה Pro)
                  </label>
                  <div className="flex gap-2">
                    <button onClick={handleCreateCoupon} className="flex-1 bg-purple-600 text-white py-2 rounded-xl text-sm font-medium">
                      צור קופון
                    </button>
                    <button onClick={() => setShowAddCoupon(false)} className="flex-1 bg-gray-100 text-gray-600 py-2 rounded-xl text-sm">
                      ביטול
                    </button>
                  </div>
                </div>
              )}

              {coupons.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">אין קופונים עדיין</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {coupons.map(c => (
                    <div key={c.id} className="px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-bold text-purple-700">{c.code}</span>
                          <span className="text-xs text-gray-500">{c.name}</span>
                          {c.type === 'private' && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-md">פרטי</span>
                          )}
                          {c.first_time_only && (
                            <span className="text-xs bg-green-50 text-green-600 px-1.5 py-0.5 rounded-md">חדשים</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-400 flex-wrap">
                          <span>
                            {c.discount_type === 'months_free' ? `${c.discount_value} חודשי Pro` :
                             c.discount_type === 'days_free' ? `${c.discount_value} ימי Pro` :
                             c.discount_type === 'percent' ? `% ${c.discount_value}% הנחה` :
                             `₪ ${c.discount_value}₪ הנחה`}
                          </span>
                          <span>{c.uses_count}{c.max_uses ? `/${c.max_uses}` : ''} שימושים</span>
                          {c.valid_until && <span>⏰ עד {formatDate(c.valid_until)}</span>}
                          {c.stripe_coupon_code && <span className="font-mono text-purple-400">{c.stripe_coupon_code}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button
                          onClick={() => handleToggleCoupon(c.id, !c.is_active)}
                          className={`text-xs px-2.5 py-1 rounded-lg font-medium ${c.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}
                        >
                          {c.is_active ? 'פעיל' : 'כבוי'}
                        </button>
                        <button onClick={() => handleDeleteCoupon(c.id, c.code)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Support Messages ── */}
        <div id="admin-messages" className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowMessages(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-teal-500" />
              הודעות תמיכה
              {messages.filter(m => m.status === 'unread').length > 0 && (
                <span className="text-xs font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-full">
                  {messages.filter(m => m.status === 'unread').length}
                </span>
              )}
            </span>
            {showMessages ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showMessages && (
            <div className="border-t">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-gray-400 py-6">אין הודעות עדיין</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {messages.map(msg => {
                    const isExpanded = expandedMsgId === msg.id
                    const statusIcon = msg.status === 'unread'
                      ? <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0 mt-1.5" />
                      : msg.status === 'replied'
                      ? <CheckCheck className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                      : <Eye className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    return (
                      <div key={msg.id}>
                        <button
                          onClick={() => handleExpandMessage(msg)}
                          className="w-full flex items-start gap-3 px-4 py-3 text-right hover:bg-gray-50 transition-colors"
                        >
                          {statusIcon}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 justify-between">
                              <span className={`text-sm font-medium truncate ${msg.status === 'unread' ? 'text-gray-900' : 'text-gray-600'}`}>
                                {msg.subject}
                              </span>
                              <span className="text-xs text-gray-400 flex-shrink-0">{formatDate(msg.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-xs text-gray-400">{msg.user_email || msg.user_name || 'משתמש'}</span>
                              <span className="text-xs text-gray-300">·</span>
                              <span className="text-xs text-gray-400">{CATEGORY_LABELS_KEYS[msg.category] ? t(CATEGORY_LABELS_KEYS[msg.category]) : msg.category}</span>
                              {msg.user_read_at && (
                                <>
                                  <span className="text-xs text-gray-300">·</span>
                                  <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
                                    <Eye className="w-3 h-3" />נקרא ע"י המשתמש
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 space-y-2">
                            {/* Thread view */}
                            <div className="space-y-2 max-h-72 overflow-y-auto pb-1">
                              {/* Original message */}
                              <div className="flex justify-end">
                                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-3 py-2 max-w-[80%]">
                                  <p className="text-xs text-gray-500 font-medium mb-0.5">{msg.user_email || msg.user_name || 'משתמש'}</p>
                                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.body}</p>
                                  <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(msg.created_at)}</p>
                                </div>
                              </div>
                              {/* Thread replies */}
                              {(msgReplies[msg.id] || []).length === 0 && msg.admin_reply && (
                                /* Legacy: show admin_reply if no thread yet */
                                <div className="flex justify-start">
                                  <div className="bg-teal-50 rounded-2xl rounded-tr-sm px-3 py-2 max-w-[80%]">
                                    <p className="text-xs text-teal-600 font-medium mb-0.5">מנהל</p>
                                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{msg.admin_reply}</p>
                                  </div>
                                </div>
                              )}
                              {(msgReplies[msg.id] || []).map(r => (
                                <div key={r.id} className={`flex ${r.sender === 'admin' ? 'justify-start' : 'justify-end'}`}>
                                  <div className={`rounded-2xl px-3 py-2 max-w-[80%] ${
                                    r.sender === 'admin'
                                      ? 'bg-teal-50 text-gray-700 rounded-tr-sm'
                                      : 'bg-gray-100 text-gray-700 rounded-tl-sm'
                                  }`}>
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                      <p className={`text-xs font-medium ${r.sender === 'admin' ? 'text-teal-600' : 'text-gray-500'}`}>
                                        {r.sender === 'admin' ? 'מנהל' : (msg.user_email || 'משתמש')}
                                      </p>
                                      {r.sender === 'admin' && editingReplyId !== r.id && (
                                        <div className="flex items-center gap-0.5">
                                          <button
                                            onClick={() => { setEditingReplyId(r.id); setEditingReplyText(r.body) }}
                                            className="p-0.5 rounded hover:bg-teal-100 text-teal-400"
                                          >
                                            <Edit2 className="w-2.5 h-2.5" />
                                          </button>
                                          <button
                                            onClick={() => handleDeleteReply(r.id, msg.id)}
                                            className="p-0.5 rounded hover:bg-red-100 text-red-400"
                                          >
                                            <Trash2 className="w-2.5 h-2.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    {editingReplyId === r.id ? (
                                      <div className="space-y-1.5">
                                        <textarea
                                          value={editingReplyText}
                                          onChange={e => setEditingReplyText(e.target.value)}
                                          rows={3}
                                          className="w-full px-2 py-1.5 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none bg-white"
                                        />
                                        <div className="flex gap-1.5">
                                          <button
                                            onClick={() => handleEditReply(r.id, msg.id)}
                                            className="flex-1 bg-teal-500 text-white py-1 rounded-lg text-xs font-medium"
                                          >שמור</button>
                                          <button
                                            onClick={() => setEditingReplyId(null)}
                                            className="flex-1 bg-gray-200 text-gray-600 py-1 rounded-lg text-xs"
                                          >ביטול</button>
                                        </div>
                                      </div>
                                    ) : (
                                      <>
                                        <p className="text-sm whitespace-pre-wrap">{r.body}</p>
                                        <p className="text-[10px] text-gray-400 mt-0.5">{formatDate(r.created_at)}</p>
                                      </>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {/* Reply input */}
                            <div className="flex gap-2">
                              <textarea
                                value={replyTexts[msg.id] || ''}
                                onChange={e => setReplyTexts(prev => ({ ...prev, [msg.id]: e.target.value }))}
                                placeholder="כתוב תשובה..."
                                rows={2}
                                className="flex-1 px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300 resize-none"
                              />
                              <button
                                onClick={() => handleSendReply(msg)}
                                disabled={sendingReply === msg.id || !replyTexts[msg.id]?.trim()}
                                className="px-3 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium flex items-center gap-1 disabled:opacity-40"
                              >
                                <Send className="w-3.5 h-3.5" />
                                {sendingReply === msg.id ? '...' : 'שלח'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Broadcasts ── */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowBroadcasts(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-500" />
              שידורים לכלל המשתמשים
            </span>
            {showBroadcasts ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showBroadcasts && (
            <div className="border-t divide-y divide-gray-50">

              {/* Push notification form */}
              <div className="p-4 bg-amber-50 space-y-2">
                <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5" /> שלח התראת פוש לכולם
                </p>
                <input
                  value={pushForm.title}
                  onChange={e => setPushForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="כותרת ההתראה"
                  className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                <textarea
                  value={pushForm.body}
                  onChange={e => setPushForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="גוף ההתראה"
                  rows={2}
                  className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-amber-300 resize-none"
                />
                <button
                  onClick={handleCreatePushBroadcast}
                  disabled={sendingPush || !pushForm.title.trim() || !pushForm.body.trim()}
                  className="w-full bg-amber-500 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                >
                  {sendingPush ? '...' : 'שלח התראה לכולם'}
                </button>
              </div>

              {/* Message broadcast form */}
              <div className="p-4 bg-blue-50 space-y-2">
                <p className="text-xs font-semibold text-blue-700 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> שלח הודעה למשתמשים
                </p>
                <input
                  value={broadcastForm.subject}
                  onChange={e => setBroadcastForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="נושא ההודעה"
                  className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                />
                <textarea
                  value={broadcastForm.body}
                  onChange={e => setBroadcastForm(f => ({ ...f, body: e.target.value }))}
                  placeholder="גוף ההודעה"
                  rows={3}
                  className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                />
                <button
                  onClick={handleCreateBroadcast}
                  disabled={sendingBroadcast || !broadcastForm.subject.trim() || !broadcastForm.body.trim()}
                  className="w-full bg-blue-500 text-white py-2 rounded-xl text-sm font-medium disabled:opacity-40"
                >
                  {sendingBroadcast ? '...' : 'שלח לכל המשתמשים'}
                </button>
              </div>

              {/* Broadcast history */}
              {broadcasts.length > 0 && (
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                  {broadcasts.map(b => (
                    <div key={b.id} className="px-4 py-2.5">
                      {editingBroadcastId === b.id ? (
                        <div className="space-y-2">
                          <input
                            value={editingBroadcastForm.subject}
                            onChange={e => setEditingBroadcastForm(f => ({ ...f, subject: e.target.value }))}
                            placeholder="נושא ההודעה"
                            className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                          <textarea
                            value={editingBroadcastForm.body}
                            onChange={e => setEditingBroadcastForm(f => ({ ...f, body: e.target.value }))}
                            placeholder="גוף ההודעה"
                            rows={2}
                            className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleSaveEditBroadcast(b.id)}
                              className="flex-1 bg-blue-500 text-white py-1.5 rounded-xl text-xs font-medium"
                            >שמור</button>
                            <button
                              onClick={() => setEditingBroadcastId(null)}
                              className="flex-1 bg-gray-200 text-gray-600 py-1.5 rounded-xl text-xs"
                            >ביטול</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium text-gray-700 truncate">{b.subject}</p>
                            <div className="flex items-center gap-1 flex-shrink-0">
                              <span className="text-xs text-gray-400">{formatDate(b.created_at)}</span>
                              <button
                                onClick={() => handleLoadBroadcastViewers(b.id)}
                                title="מי צפה"
                                className={`p-1 rounded-lg hover:bg-blue-50 ${loadingViewersFor === b.id ? 'opacity-50' : ''}`}
                              >
                                <Users className="w-3.5 h-3.5 text-blue-400" />
                              </button>
                              <button
                                onClick={() => { setEditingBroadcastId(b.id); setEditingBroadcastForm({ subject: b.subject, body: b.body }) }}
                                title="ערוך"
                                className="p-1 rounded-lg hover:bg-gray-100"
                              >
                                <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                              </button>
                              <button
                                onClick={() => handleDeleteBroadcast(b.id)}
                                title="מחק"
                                className="p-1 rounded-lg hover:bg-red-50"
                              >
                                <Trash2 className="w-3.5 h-3.5 text-red-400" />
                              </button>
                            </div>
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-1">{b.body}</p>
                          {showViewersFor === b.id && (
                            <div className="mt-2 bg-blue-50 rounded-xl p-2.5">
                              <p className="text-[10px] font-semibold text-blue-600 mb-1.5">
                                {broadcastViewers[b.id]?.length
                                  ? `${broadcastViewers[b.id].length} משתמשים צפו`
                                  : 'אף אחד לא צפה עדיין'}
                              </p>
                              {(broadcastViewers[b.id] || []).length > 0 && (
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                  {broadcastViewers[b.id].map(v => (
                                    <div key={v.user_email} className="flex justify-between text-xs">
                                      <span className="text-gray-600">{v.user_email}</span>
                                      <span className="text-gray-400">{formatDate(v.viewed_at)}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Login Banner ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3.5 text-right"
            onClick={() => { setShowBanners(v => !v); if (!showBanners) loadBanners() }}
          >
            <span className="flex items-center gap-2 font-semibold text-gray-800 text-sm">
              <Image className="w-4 h-4 text-purple-500" />
              באנרי כניסה ({banners.filter(b => b.is_active).length} פעילים)
            </span>
            {showBanners ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showBanners && (
            <div className="border-t divide-y divide-gray-50">
              {/* Upload area */}
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-3">
                  ניתן להעלות מספר באנרים — יוצגו אחד אחרי השני לפי סדר הגרירה. גרור שורות לשינוי סדר.
                </p>
                <label className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl border-2 border-dashed text-sm font-medium cursor-pointer transition-colors
                  ${uploadingBanner ? 'border-gray-200 text-gray-400 cursor-not-allowed' : 'border-purple-300 text-purple-600 hover:bg-purple-50'}`}
                >
                  {uploadingBanner
                    ? <><div className="w-4 h-4 border-2 border-gray-300 border-t-purple-500 rounded-full animate-spin" /> מעלה...</>
                    : <><Image className="w-4 h-4" /> העלה באנר חדש</>}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={uploadingBanner}
                    onChange={handleUploadBanner}
                  />
                </label>
              </div>

              {/* Banner list with drag-and-drop */}
              {banners.length === 0 && bannersLoaded && (
                <p className="px-4 py-3 text-xs text-gray-400">אין באנרים עדיין</p>
              )}
              {banners.map(b => (
                <div
                  key={b.id}
                  draggable
                  onDragStart={() => handleBannerDragStart(b.id)}
                  onDragOver={e => handleBannerDragOver(e, b.id)}
                  onDrop={() => handleBannerDrop(b.id)}
                  onDragEnd={() => { setDragBannerId(null); setDragOverBannerId(null) }}
                  className={`transition-colors ${dragOverBannerId === b.id && dragBannerId !== b.id ? 'bg-purple-50 border-purple-200' : ''}`}
                >
                  <div className="p-3 flex items-center gap-2">
                    {/* Drag handle */}
                    <GripVertical className="w-4 h-4 text-gray-300 cursor-grab flex-shrink-0" />
                    <img
                      src={b.image_url}
                      alt="באנר"
                      className="w-16 h-10 object-cover rounded-lg border border-gray-100 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${b.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {b.is_active ? 'פעיל' : 'מושבת'}
                      </span>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[11px] text-gray-400">{b.display_duration ?? 5}ש׳</span>
                        <span className="text-[11px] text-gray-400">{b.skip_allowed !== false ? '• ניתן לדילוג' : '• ללא דילוג'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={() => {
                          if (editingBannerId === b.id) { setEditingBannerId(null); return }
                          setEditingBannerId(b.id)
                          setBannerEditDuration(b.display_duration ?? 5)
                          setBannerEditSkip(b.skip_allowed !== false)
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title="הגדרות"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                      <button
                        onClick={() => handleToggleBanner(b.id, !b.is_active)}
                        className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
                        title={b.is_active ? 'השבת' : 'הפעל'}
                      >
                        {b.is_active
                          ? <ToggleRight className="w-5 h-5 text-green-500" />
                          : <ToggleLeft className="w-5 h-5 text-gray-300" />}
                      </button>
                      <button
                        onClick={() => handleDeleteBanner(b.id, b.image_url)}
                        className="p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="מחק"
                      >
                        <Trash2 className="w-4 h-4 text-red-400" />
                      </button>
                    </div>
                  </div>
                  {/* Inline settings editor */}
                  {editingBannerId === b.id && (
                    <div className="mx-3 mb-3 p-3 bg-purple-50 rounded-xl space-y-2">
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-600 flex-shrink-0">זמן תצוגה (שניות)</label>
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={bannerEditDuration}
                          onChange={e => setBannerEditDuration(Math.max(1, parseInt(e.target.value) || 5))}
                          className="w-20 px-2 py-1 border rounded-lg text-sm text-center focus:outline-none focus:ring-2 focus:ring-purple-300"
                        />
                      </div>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bannerEditSkip}
                          onChange={e => setBannerEditSkip(e.target.checked)}
                          className="w-4 h-4 accent-purple-500"
                        />
                        <span className="text-xs text-gray-600">אפשר למשתמשים לדלג על הבאנר</span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleUpdateBannerSettings(b.id, bannerEditDuration, bannerEditSkip)}
                          className="flex-1 bg-purple-500 text-white py-1.5 rounded-lg text-xs font-medium"
                        >שמור</button>
                        <button
                          onClick={() => setEditingBannerId(null)}
                          className="flex-1 bg-gray-200 text-gray-600 py-1.5 rounded-lg text-xs font-medium"
                        >ביטול</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Balance Check Operators ── */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-3.5 text-right"
            onClick={() => { setShowOperators(v => !v); if (!showOperators) loadOperators() }}
          >
            <span className="flex items-center gap-2 font-semibold text-gray-800 text-sm">
              <Link className="w-4 h-4 text-teal-500" />
              מפעילי שוברים ({operators.length})
            </span>
            {showOperators ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showOperators && (
            <div className="border-t">
              <div className="p-4">
                <p className="text-xs text-gray-500 mb-3">
                  לינקים קבועים לבדיקת יתרה — יופיעו כקיצור דרך בטופס הוספת שובר.
                </p>
                {!showAddOperator ? (
                  <button
                    onClick={() => setShowAddOperator(true)}
                    className="flex items-center gap-1.5 text-sm text-teal-600 bg-teal-50 px-3 py-1.5 rounded-xl"
                  >
                    <Plus className="w-3.5 h-3.5" /> הוסף מפעיל
                  </button>
                ) : (
                  <div className="space-y-2 bg-teal-50 rounded-xl p-3">
                    <input
                      value={operatorForm.name}
                      onChange={e => setOperatorForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="שם המפעיל (למשל: מקס, כאל)"
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                    <input
                      value={operatorForm.url}
                      onChange={e => setOperatorForm(f => ({ ...f, url: e.target.value }))}
                      placeholder="https://..."
                      type="url"
                      dir="ltr"
                      className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                    />
                    <div className="flex gap-2">
                      <button onClick={handleCreateOperator} className="flex-1 bg-teal-500 text-white py-2 rounded-xl text-sm">הוסף</button>
                      <button onClick={() => { setShowAddOperator(false); setOperatorForm({ name: '', url: '' }) }} className="flex-1 bg-gray-200 py-2 rounded-xl text-sm">ביטול</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="divide-y divide-gray-50">
                {operators.map(op => (
                  <div key={op.id} className="px-4 py-3">
                    {editingOperator?.id === op.id ? (
                      <div className="space-y-2">
                        <input
                          value={editingOperator.name}
                          onChange={e => setEditingOperator({ ...editingOperator, name: e.target.value })}
                          className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                        />
                        <input
                          value={editingOperator.url}
                          onChange={e => setEditingOperator({ ...editingOperator, url: e.target.value })}
                          type="url"
                          dir="ltr"
                          className="w-full px-3 py-2 border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                        />
                        <div className="flex gap-2">
                          <button onClick={handleUpdateOperator} className="flex-1 bg-teal-500 text-white py-1.5 rounded-xl text-sm">שמור</button>
                          <button onClick={() => setEditingOperator(null)} className="flex-1 bg-gray-100 py-1.5 rounded-xl text-sm">ביטול</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-800">{op.name}</p>
                          <p className="text-xs text-gray-400 truncate" dir="ltr">{op.url}</p>
                        </div>
                        <button onClick={() => setEditingOperator(op)} className="p-1.5 rounded-lg text-blue-500 hover:bg-blue-50">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteOperator(op.id, op.name)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-50">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {operators.length === 0 && operatorsLoaded && (
                  <p className="px-4 py-3 text-xs text-gray-400">אין מפעילים עדיין</p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Reports */}

        <div id="admin-reports" className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-4"
            onClick={() => { const next = !showReports; setShowReports(next); if (next) loadReports() }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                <Flag className="w-5 h-5 text-red-500" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800">דיווחי משתמשים</p>
                <p className="text-xs text-gray-400">
                  {reports.filter(r => r.status === 'pending').length} ממתינים לטיפול
                </p>
              </div>
            </div>
            {showReports ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showReports && (
            <div className="px-4 pb-4 space-y-3 border-t pt-3">
              {!reportsLoaded && <p className="text-sm text-gray-400 text-center py-4">טוען...</p>}
              {reportsLoaded && reportsError && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center space-y-2">
                  <p className="text-sm font-semibold text-red-700">שגיאה בטעינת דיווחים</p>
                  <p className="text-xs text-red-500 font-mono break-all">{reportsError}</p>
                  <button
                    onClick={loadReports}
                    className="mt-1 px-4 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-xl"
                  >
                    נסה שנית
                  </button>
                </div>
              )}
              {reportsLoaded && !reportsError && reports.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">אין דיווחים</p>
              )}
              {reports.map(r => (
                <div key={r.report_id} className={`border rounded-2xl p-4 space-y-2 ${r.status === 'pending' ? 'border-red-200 bg-red-50' : r.status === 'reviewed' ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        {r.source === 'discount' && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-700">🏷 הנחות</span>
                        )}
                        <p className="text-sm font-medium text-gray-800">{r.reason}</p>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        מדווח: <span className="font-medium">{r.reporter_email}</span>
                        {r.source !== 'discount' && (
                          <>{' · '}על: <span className="font-medium text-red-700">{r.reported_email}</span></>
                        )}
                        {r.source === 'discount' && r.deal_id && (
                          <>{' · '}הנחה: <span className="font-medium text-purple-700 font-mono text-[10px]">{r.deal_id}</span></>
                        )}
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${r.status === 'pending' ? 'bg-red-100 text-red-700' : r.status === 'reviewed' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {r.status === 'pending' ? 'ממתין' : r.status === 'reviewed' ? 'נבדק' : 'נסגר'}
                    </span>
                  </div>
                  {r.details && <p className="text-xs text-gray-600 bg-white rounded-xl p-2">{r.details}</p>}
                  <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('he-IL')}</p>
                  <div className="flex gap-2 flex-wrap">
                    {r.status !== 'reviewed' && (
                      <button
                        disabled={updatingReport === r.report_id}
                        onClick={() => updateReportStatus(r.report_id, 'reviewed')}
                        className="px-3 py-1.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-xl hover:bg-yellow-200 disabled:opacity-50"
                      >
                        סמן כנבדק
                      </button>
                    )}
                    {r.status !== 'resolved' && (
                      <button
                        disabled={updatingReport === r.report_id}
                        onClick={() => updateReportStatus(r.report_id, 'resolved')}
                        className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 rounded-xl hover:bg-green-200 disabled:opacity-50"
                      >
                        סגור
                      </button>
                    )}
                    <button
                      disabled={updatingReport === r.report_id}
                      onClick={() => setConfirm({
                        title: 'מחיקת דיווח',
                        message: 'האם למחוק דיווח זה לצמיתות?',
                        onConfirm: async () => {
                          setConfirm(null)
                          setUpdatingReport(r.report_id)
                          const { error } = await supabase.rpc('admin_delete_report', { p_report_id: r.report_id })
                          setUpdatingReport(null)
                          if (error) { toast.error('שגיאה במחיקה'); return }
                          setReports(prev => prev.filter(x => x.report_id !== r.report_id))
                          toast.success('דיווח נמחק')
                        },
                      })}
                      className="px-3 py-1.5 text-xs font-medium bg-red-100 text-red-600 rounded-xl hover:bg-red-200 disabled:opacity-50"
                    >
                      מחק
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Marketplace Settings */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-4"
            onClick={() => { setShowMktSettings(!showMktSettings); if (!showMktSettings) loadMktSettings() }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
                <ShoppingBag className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800">הגדרות שוק</p>
                <p className="text-xs text-gray-400">תפוגה, אימות מוכר, רשימות</p>
              </div>
            </div>
            {showMktSettings ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showMktSettings && (
            <div className="px-4 pb-4 border-t pt-4 space-y-4">
              {!mktSettingsLoaded ? (
                <p className="text-sm text-gray-400 text-center py-4">טוען...</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">ימי הצגה (חינמי)</label>
                      <input type="number" min={1} max={365} value={mktSettings.free_listing_days}
                        onChange={e => setMktSettings(s => ({ ...s, free_listing_days: parseInt(e.target.value) || 30 }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-right" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">ימי הצגה (פרו)</label>
                      <input type="number" min={1} max={365} value={mktSettings.pro_listing_days}
                        onChange={e => setMktSettings(s => ({ ...s, pro_listing_days: parseInt(e.target.value) || 60 }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-right" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">מינ' דירוג מאומת</label>
                      <input type="number" min={1} max={5} step={0.1} value={mktSettings.verified_min_rating}
                        onChange={e => setMktSettings(s => ({ ...s, verified_min_rating: parseFloat(e.target.value) || 4 }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-right" />
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 block mb-1">מינ' מכירות לאימות</label>
                      <input type="number" min={1} value={mktSettings.verified_min_sales}
                        onChange={e => setMktSettings(s => ({ ...s, verified_min_sales: parseInt(e.target.value) || 5 }))}
                        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-right" />
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                    <span className="text-sm text-gray-700">רשימות מעקב לפרו בלבד</span>
                    <button onClick={() => setMktSettings(s => ({ ...s, watchlist_pro_only: !s.watchlist_pro_only }))}
                      className={`w-12 h-6 rounded-full transition-colors ${mktSettings.watchlist_pro_only ? 'bg-indigo-500' : 'bg-gray-300'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${mktSettings.watchlist_pro_only ? 'translate-x-1' : '-translate-x-5'} mx-auto`} />
                    </button>
                  </div>
                  <button onClick={saveMktSettings} disabled={savingMktSettings}
                    className="w-full py-3 bg-indigo-600 text-white rounded-2xl font-medium text-sm disabled:opacity-50">
                    {savingMktSettings ? 'שומר...' : 'שמור הגדרות'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Verified Sellers */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-4"
            onClick={() => { setShowVerifiedSellers(!showVerifiedSellers); if (!showVerifiedSellers) loadVerifiedSellers() }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <BadgeCheck className="w-5 h-5 text-emerald-600" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800">מוכרים מאומתים</p>
                <p className="text-xs text-gray-400">{verifiedSellers.filter(s => s.is_verified).length} מאומתים</p>
              </div>
            </div>
            {showVerifiedSellers ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>
          {showVerifiedSellers && (
            <div className="px-4 pb-4 border-t pt-3 space-y-2">
              {!verifiedSellersLoaded && <p className="text-sm text-gray-400 text-center py-4">טוען...</p>}
              {verifiedSellersLoaded && verifiedSellers.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">אין מוכרים עם מכירות עדיין</p>
              )}
              {verifiedSellers.map(s => (
                <div key={s.user_id} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-gray-800 truncate">{s.name || s.email}</p>
                      {s.is_verified && <BadgeCheck className="w-4 h-4 text-emerald-500 shrink-0" />}
                    </div>
                    <p className="text-xs text-gray-400">★ {Number(s.avg_rating).toFixed(1)} · {s.total_sales} מכירות</p>
                  </div>
                  <button
                    disabled={togglingVerified === s.user_id}
                    onClick={() => handleSetVerified(s.user_id, !s.is_verified)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-xl disabled:opacity-50 shrink-0 ${s.is_verified ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'}`}
                  >
                    {s.is_verified ? 'הסר אימות' : 'אמת'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── הנחות חכמות ── */}
        <div id="admin-discounts" className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => {
              const next = !showDiscounts
              setShowDiscounts(next)
              if (next) { loadAdminDeals(); loadAdminClubs(); loadAdminBusinesses() }
            }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center">
                <Percent className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800">{t('admin.discounts')}</p>
                <p className="text-xs text-gray-400">מועדונים · עסקים · עסקאות הנחה</p>
              </div>
            </div>
            {showDiscounts ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showDiscounts && (
            <div className="border-t">
              {/* Sub-tabs */}
              <div className="flex border-b text-sm font-medium overflow-x-auto">
                {(['deals', 'submissions', 'clubs', 'businesses'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => {
                      setDiscountTab(tab)
                      if (tab === 'submissions' && !submissionsLoaded) loadSubmissions()
                    }}
                    className={`flex-1 py-2.5 whitespace-nowrap px-2 transition-colors ${discountTab === tab ? 'text-green-600 border-b-2 border-green-500' : 'text-gray-500'}`}
                  >
                    {tab === 'deals' ? t('admin.discounts.deals')
                      : tab === 'submissions' ? t('admin.discounts.submissions')
                      : tab === 'clubs' ? t('admin.discounts.clubs')
                      : t('admin.discounts.businesses')}
                    {tab === 'submissions' && submissions.filter(s => s.status === 'pending').length > 0 && (
                      <span className="mr-1 inline-flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full">
                        {submissions.filter(s => s.status === 'pending').length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* ── SUBMISSIONS TAB ── */}
              {discountTab === 'submissions' && (
                <div className="p-4 space-y-3">
                  {/* Filter bar */}
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-xl overflow-hidden border border-gray-200 text-xs font-medium">
                      {(['pending', 'all'] as const).map(f => (
                        <button key={f} onClick={() => { setSubmissionFilter(f); setSubmissionsLoaded(false); setTimeout(() => loadSubmissions(), 0) }}
                          className={`px-3 py-1.5 ${submissionFilter === f ? 'bg-green-600 text-white' : 'bg-white text-gray-600'}`}>
                          {f === 'pending' ? t('admin.submissions.pending') : 'הכל'}
                        </button>
                      ))}
                    </div>
                    <button onClick={loadSubmissions} className="text-xs text-gray-400 hover:text-gray-600">↺ רענן</button>
                  </div>

                  {!submissionsLoaded ? (
                    <p className="text-sm text-gray-400 text-center py-6">{t('app.loading')}</p>
                  ) : submissions.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-6">{t('admin.submissions.empty')}</p>
                  ) : (
                    <div className="space-y-3">
                      {submissions.map(sub => (
                        <div key={sub.id} className={`rounded-2xl border p-3 space-y-2 ${sub.status === 'pending' ? 'bg-amber-50 border-amber-200' : sub.status === 'approved' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                          {/* Status badge + meta */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-900 truncate">{sub.title}</p>
                              <p className="text-xs text-gray-500">{sub.business_name} · {sub.club_name}</p>
                              <p className="text-xs text-gray-400">{sub.user_email} · {formatDate(sub.created_at)}</p>
                            </div>
                            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${sub.status === 'pending' ? 'bg-amber-200 text-amber-800' : sub.status === 'approved' ? 'bg-green-200 text-green-800' : 'bg-gray-200 text-gray-600'}`}>
                              {sub.status === 'pending' ? t('admin.submissions.pending') : sub.status === 'approved' ? t('admin.submissions.approved') : t('admin.submissions.rejected')}
                            </span>
                          </div>

                          {/* Details */}
                          <div className="flex flex-wrap gap-1.5">
                            {sub.discount_type === 'percent' && sub.discount_value != null && (
                              <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{sub.discount_value}%</span>
                            )}
                            {sub.discount_type === 'fixed' && sub.discount_value != null && (
                              <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">₪{sub.discount_value}</span>
                            )}
                            {sub.promo_code && (
                              <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-mono">{sub.promo_code}</span>
                            )}
                            {sub.expiration_date && (
                              <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">עד {sub.expiration_date}</span>
                            )}
                          </div>

                          {sub.description && (
                            <p className="text-xs text-gray-600 line-clamp-2">{sub.description}</p>
                          )}

                          {sub.admin_notes && (
                            <p className="text-xs text-gray-500 italic border-t pt-1.5">הערה: {sub.admin_notes}</p>
                          )}

                          {/* Actions — only for pending */}
                          {sub.status === 'pending' && (
                            <div className="pt-1 space-y-2">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleApproveSubmission(sub)}
                                  disabled={approvingId === sub.id}
                                  className="flex-1 py-1.5 bg-green-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1"
                                >
                                  {approvingId === sub.id ? '...' : t('admin.submissions.approve')}
                                </button>
                                <button
                                  onClick={() => editingSubmission === sub.id ? setEditingSubmission(null) : openEditSubmission(sub)}
                                  className="flex-1 py-1.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-xl text-xs font-semibold"
                                >
                                  {editingSubmission === sub.id ? t('app.cancel') : t('admin.submissions.edit')}
                                </button>
                                <button
                                  onClick={() => setShowRejectInput(prev => prev === sub.id ? null : sub.id)}
                                  className="flex-1 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-xl text-xs font-semibold"
                                >
                                  {t('admin.submissions.reject')}
                                </button>
                                <button onClick={() => handleDeleteSubmission(sub.id)} className="p-1.5 text-gray-400 hover:text-red-500">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>

                              {/* Inline edit form */}
                              {editingSubmission === sub.id && (
                                <div className="mt-2 p-3 bg-white dark:bg-gray-800 border border-blue-200 rounded-2xl space-y-2">
                                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-1">{t('admin.submissions.edit_title')}</p>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] text-gray-500 block mb-0.5">מועדון *</label>
                                      <input className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        value={editSubForm.club_name} onChange={e => setEditSubForm(f => ({ ...f, club_name: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-gray-500 block mb-0.5">עסק *</label>
                                      <input className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        value={editSubForm.business_name} onChange={e => setEditSubForm(f => ({ ...f, business_name: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="text-[10px] text-gray-500 block mb-0.5">כותרת *</label>
                                    <input className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                      value={editSubForm.title} onChange={e => setEditSubForm(f => ({ ...f, title: e.target.value }))} />
                                  </div>
                                  <div className="flex gap-2">
                                    <select className="flex-1 border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                      value={editSubForm.discount_type} onChange={e => setEditSubForm(f => ({ ...f, discount_type: e.target.value as typeof f.discount_type }))}>
                                      <option value="percent">אחוז (%)</option>
                                      <option value="fixed">סכום קבוע (₪)</option>
                                      <option value="free_item">פריט חינם</option>
                                      <option value="other">אחר</option>
                                    </select>
                                    {(editSubForm.discount_type === 'percent' || editSubForm.discount_type === 'fixed') && (
                                      <input type="number" min="0" dir="ltr"
                                        className="w-20 border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                        placeholder={editSubForm.discount_type === 'percent' ? '%' : '₪'}
                                        value={editSubForm.discount_value} onChange={e => setEditSubForm(f => ({ ...f, discount_value: e.target.value }))} />
                                    )}
                                  </div>
                                  <input dir="ltr" className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    placeholder="קוד פרומו" value={editSubForm.promo_code} onChange={e => setEditSubForm(f => ({ ...f, promo_code: e.target.value }))} />
                                  <input dir="ltr" className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    placeholder="קישור חיצוני" value={editSubForm.external_link} onChange={e => setEditSubForm(f => ({ ...f, external_link: e.target.value }))} />
                                  <textarea className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none h-14"
                                    placeholder="תיאור" value={editSubForm.description} onChange={e => setEditSubForm(f => ({ ...f, description: e.target.value }))} />
                                  <input className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                    placeholder="תגיות (מופרדות בפסיק)" value={editSubForm.tags} onChange={e => setEditSubForm(f => ({ ...f, tags: e.target.value }))} />
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="text-[10px] text-gray-500 block mb-0.5">תאריך התחלה</label>
                                      <input type="date" className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white"
                                        value={editSubForm.start_date} onChange={e => setEditSubForm(f => ({ ...f, start_date: e.target.value }))} />
                                    </div>
                                    <div>
                                      <label className="text-[10px] text-gray-500 block mb-0.5">תאריך תפוגה</label>
                                      <input type="date" className="w-full border dark:border-gray-600 rounded-xl px-2.5 py-1.5 text-xs bg-white dark:bg-gray-700 dark:text-white"
                                        value={editSubForm.expiration_date} onChange={e => setEditSubForm(f => ({ ...f, expiration_date: e.target.value }))} />
                                    </div>
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      onClick={() => handleSaveEditSubmission(sub.id)}
                                      disabled={savingEdit || !editSubForm.club_name.trim() || !editSubForm.business_name.trim() || !editSubForm.title.trim()}
                                      className="flex-1 py-1.5 bg-blue-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50"
                                    >
                                      {savingEdit ? '...' : t('admin.submissions.edit_save')}
                                    </button>
                                    <button onClick={() => setEditingSubmission(null)} className="flex-1 py-1.5 bg-gray-100 text-gray-600 rounded-xl text-xs font-semibold">
                                      {t('app.cancel')}
                                    </button>
                                  </div>
                                </div>
                              )}

                              {showRejectInput === sub.id && (
                                <div className="flex gap-2">
                                  <input
                                    className="flex-1 border rounded-xl px-2.5 py-1.5 text-xs"
                                    placeholder="הערה לדחייה (אופציונלי)"
                                    value={rejectNote[sub.id] || ''}
                                    onChange={e => setRejectNote(prev => ({ ...prev, [sub.id]: e.target.value }))}
                                    autoFocus
                                  />
                                  <button onClick={() => handleRejectSubmission(sub.id)} className="px-3 py-1.5 bg-red-500 text-white rounded-xl text-xs font-semibold">
                                    אשר דחייה
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                          {sub.status !== 'pending' && (
                            <button onClick={() => handleDeleteSubmission(sub.id)} className="text-xs text-gray-400 hover:text-red-500 flex items-center gap-1">
                              <Trash2 className="w-3 h-3" /> מחק
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── CLUBS TAB ── */}
              {discountTab === 'clubs' && (
                <div className="p-4 space-y-3">
                  <button
                    onClick={() => { setEditingClub(null); setClubForm({ name: '', logo_url: '', type: 'loyalty_club', is_active: true }); setShowClubForm(true) }}
                    className="flex items-center gap-2 text-sm font-medium text-green-600 bg-green-50 px-3 py-2 rounded-xl"
                  >
                    <Plus className="w-4 h-4" /> {t('admin.discounts.add_club')}
                  </button>

                  {showClubForm && (
                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{editingClub ? 'עריכת מועדון' : 'מועדון חדש'}</p>
                        <button onClick={() => { setShowClubForm(false); setEditingClub(null) }}><X className="w-4 h-4 text-gray-400" /></button>
                      </div>
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="שם המועדון *" value={clubForm.name} onChange={e => setClubForm(f => ({ ...f, name: e.target.value }))} />
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="URL לוגו (אופציונלי)" value={clubForm.logo_url} onChange={e => setClubForm(f => ({ ...f, logo_url: e.target.value }))} dir="ltr" />
                      <select className="w-full border rounded-xl px-3 py-2 text-sm bg-white" value={clubForm.type} onChange={e => setClubForm(f => ({ ...f, type: e.target.value as 'credit_card' | 'loyalty_club' }))}>
                        <option value="credit_card">{t('settings.clubs.credit_card')}</option>
                        <option value="loyalty_club">{t('settings.clubs.loyalty_club')}</option>
                      </select>
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={clubForm.is_active} onChange={e => setClubForm(f => ({ ...f, is_active: e.target.checked }))} />
                        פעיל
                      </label>
                      <button onClick={handleSaveClub} disabled={savingDiscount || !clubForm.name} className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                        {savingDiscount ? '...' : t('app.save')}
                      </button>
                    </div>
                  )}

                  {!clubsLoaded ? <p className="text-sm text-gray-400 text-center py-4">{t('app.loading')}</p> : (
                    <div className="space-y-2">
                      {adminClubs.map(club => (
                        <div key={club.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                          <div className="flex items-center gap-2 min-w-0">
                            {club.type === 'credit_card' ? <CreditCard className="w-4 h-4 text-blue-500 shrink-0" /> : <Tag className="w-4 h-4 text-purple-500 shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{club.name}</p>
                              <p className="text-xs text-gray-400">{club.type === 'credit_card' ? 'כרטיס אשראי' : 'מועדון לקוחות'} · {club.is_active ? 'פעיל' : 'לא פעיל'}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEditClub(club)} className="p-1.5 text-gray-400 hover:text-blue-500"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteClub(club.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── BUSINESSES TAB ── */}
              {discountTab === 'businesses' && (
                <div className="p-4 space-y-3">
                  <button
                    onClick={() => { setEditingBusiness(null); setBusinessForm({ name: '', logo_url: '', website: '', tags: '' }); setShowBusinessForm(true) }}
                    className="flex items-center gap-2 text-sm font-medium text-green-600 bg-green-50 px-3 py-2 rounded-xl"
                  >
                    <Plus className="w-4 h-4" /> {t('admin.discounts.add_business')}
                  </button>

                  {showBusinessForm && (
                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{editingBusiness ? 'עריכת עסק' : 'עסק חדש'}</p>
                        <button onClick={() => { setShowBusinessForm(false); setEditingBusiness(null) }}><X className="w-4 h-4 text-gray-400" /></button>
                      </div>
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="שם העסק *" value={businessForm.name} onChange={e => setBusinessForm(f => ({ ...f, name: e.target.value }))} />
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="URL לוגו (אופציונלי)" value={businessForm.logo_url} onChange={e => setBusinessForm(f => ({ ...f, logo_url: e.target.value }))} dir="ltr" />
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="אתר אינטרנט (אופציונלי)" value={businessForm.website} onChange={e => setBusinessForm(f => ({ ...f, website: e.target.value }))} dir="ltr" />
                      <div>
                        <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="תגיות (מופרדות בפסיק: קפה, מסעדה)" value={businessForm.tags} onChange={e => setBusinessForm(f => ({ ...f, tags: e.target.value }))} />
                        <p className="text-xs text-gray-400 mt-1">לדוגמה: קפה, ארוחת בוקר, מסעדות</p>
                      </div>
                      <button onClick={handleSaveBusiness} disabled={savingDiscount || !businessForm.name} className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                        {savingDiscount ? '...' : t('app.save')}
                      </button>
                    </div>
                  )}

                  {!businessesLoaded ? <p className="text-sm text-gray-400 text-center py-4">{t('app.loading')}</p> : (
                    <div className="space-y-2">
                      {adminBusinesses.map(biz => (
                        <div key={biz.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl">
                          <div className="flex items-center gap-2 min-w-0">
                            <Building2 className="w-4 h-4 text-gray-400 shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">{biz.name}</p>
                              <p className="text-xs text-gray-400 truncate">{biz.tags.join(', ') || 'ללא תגיות'}</p>
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button onClick={() => openEditBusiness(biz)} className="p-1.5 text-gray-400 hover:text-blue-500"><Edit2 className="w-3.5 h-3.5" /></button>
                            <button onClick={() => handleDeleteBusiness(biz.id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── DEALS TAB ── */}
              {discountTab === 'deals' && (
                <div className="p-4 space-y-3">
                  <button
                    onClick={() => { setEditingDeal(null); setDealForm({ club_id: '', business_id: '', title: '', description: '', discount_type: 'percent', discount_value: '', promo_code: '', external_link: '', tags: '', start_date: '', expiration_date: '', is_active: true }); setShowDealForm(true) }}
                    className="flex items-center gap-2 text-sm font-medium text-green-600 bg-green-50 px-3 py-2 rounded-xl"
                  >
                    <Plus className="w-4 h-4" /> {t('admin.discounts.add_deal')}
                  </button>

                  {showDealForm && (
                    <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="font-semibold text-sm">{editingDeal ? 'עריכת עסקה' : 'עסקה חדשה'}</p>
                        <button onClick={() => { setShowDealForm(false); setEditingDeal(null) }}><X className="w-4 h-4 text-gray-400" /></button>
                      </div>

                      {/* Club select + quick-add */}
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <select className="flex-1 border rounded-xl px-3 py-2 text-sm bg-white" value={dealForm.club_id} onChange={e => setDealForm(f => ({ ...f, club_id: e.target.value }))}>
                            <option value="">בחר מועדון / כרטיס *</option>
                            {adminClubs.filter(c => c.is_active).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => { setShowQuickClub(v => !v); setShowQuickBiz(false) }} className="shrink-0 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-xl whitespace-nowrap">
                            {t('admin.quickadd.club')}
                          </button>
                        </div>
                        {showQuickClub && (
                          <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs font-semibold text-green-700">מועדון / כרטיס חדש</p>
                            <input className="w-full border rounded-lg px-2.5 py-1.5 text-sm" placeholder="שם המועדון *" value={quickClubForm.name} onChange={e => setQuickClubForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                            <select className="w-full border rounded-lg px-2.5 py-1.5 text-sm bg-white" value={quickClubForm.type} onChange={e => setQuickClubForm(f => ({ ...f, type: e.target.value as 'credit_card' | 'loyalty_club' }))}>
                              <option value="credit_card">{t('settings.clubs.credit_card')}</option>
                              <option value="loyalty_club">{t('settings.clubs.loyalty_club')}</option>
                            </select>
                            <div className="flex gap-2">
                              <button onClick={handleQuickAddClub} disabled={savingQuick || !quickClubForm.name.trim()} className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                                {savingQuick ? '...' : 'הוסף ובחר'}
                              </button>
                              <button onClick={() => setShowQuickClub(false)} className="px-3 py-1.5 text-xs text-gray-500 bg-white border rounded-lg">{t('app.cancel')}</button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Business select + quick-add */}
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <select className="flex-1 border rounded-xl px-3 py-2 text-sm bg-white" value={dealForm.business_id} onChange={e => setDealForm(f => ({ ...f, business_id: e.target.value }))}>
                            <option value="">בחר עסק *</option>
                            {adminBusinesses.map(b => (
                              <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => { setShowQuickBiz(v => !v); setShowQuickClub(false) }} className="shrink-0 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2.5 py-1.5 rounded-xl whitespace-nowrap">
                            {t('admin.quickadd.business')}
                          </button>
                        </div>
                        {showQuickBiz && (
                          <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs font-semibold text-green-700">עסק חדש</p>
                            <input className="w-full border rounded-lg px-2.5 py-1.5 text-sm" placeholder="שם העסק *" value={quickBizForm.name} onChange={e => setQuickBizForm(f => ({ ...f, name: e.target.value }))} autoFocus />
                            <input className="w-full border rounded-lg px-2.5 py-1.5 text-sm" placeholder="תגיות (קפה, מסעדה...)" value={quickBizForm.tags} onChange={e => setQuickBizForm(f => ({ ...f, tags: e.target.value }))} />
                            <div className="flex gap-2">
                              <button onClick={handleQuickAddBiz} disabled={savingQuick || !quickBizForm.name.trim()} className="flex-1 py-1.5 bg-green-600 text-white rounded-lg text-xs font-semibold disabled:opacity-50">
                                {savingQuick ? '...' : 'הוסף ובחר'}
                              </button>
                              <button onClick={() => setShowQuickBiz(false)} className="px-3 py-1.5 text-xs text-gray-500 bg-white border rounded-lg">{t('app.cancel')}</button>
                            </div>
                          </div>
                        )}
                      </div>

                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="כותרת *  (לדוגמה: 20% הנחה לחברי הויזה)" value={dealForm.title} onChange={e => setDealForm(f => ({ ...f, title: e.target.value }))} />
                      <textarea className="w-full border rounded-xl px-3 py-2 text-sm resize-none h-20" placeholder="תיאור (אופציונלי)" value={dealForm.description} onChange={e => setDealForm(f => ({ ...f, description: e.target.value }))} />

                      {/* Discount type + value */}
                      <div className="flex gap-2">
                        <select className="flex-1 border rounded-xl px-3 py-2 text-sm bg-white" value={dealForm.discount_type} onChange={e => setDealForm(f => ({ ...f, discount_type: e.target.value as 'percent' | 'fixed' | 'free_item' | 'other' }))}>
                          <option value="percent">אחוז (%)</option>
                          <option value="fixed">סכום קבוע (₪)</option>
                          <option value="free_item">פריט חינם</option>
                          <option value="other">אחר</option>
                        </select>
                        {(dealForm.discount_type === 'percent' || dealForm.discount_type === 'fixed') && (
                          <input type="number" className="w-24 border rounded-xl px-3 py-2 text-sm" placeholder="ערך" value={dealForm.discount_value} onChange={e => setDealForm(f => ({ ...f, discount_value: e.target.value }))} dir="ltr" min="0" />
                        )}
                      </div>

                      <input className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wider" placeholder="קוד פרומו (אופציונלי)" value={dealForm.promo_code} onChange={e => setDealForm(f => ({ ...f, promo_code: e.target.value }))} dir="ltr" />
                      <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="קישור לעסקה (אופציונלי)" value={dealForm.external_link} onChange={e => setDealForm(f => ({ ...f, external_link: e.target.value }))} dir="ltr" />

                      <div>
                        <input className="w-full border rounded-xl px-3 py-2 text-sm" placeholder="תגיות (מופרדות בפסיק)" value={dealForm.tags} onChange={e => setDealForm(f => ({ ...f, tags: e.target.value }))} />
                        <p className="text-xs text-gray-400 mt-1">לדוגמה: קפה, ארוחת בוקר</p>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">תאריך התחלה</label>
                          <input type="date" className="w-full border rounded-xl px-3 py-2 text-sm" value={dealForm.start_date} onChange={e => setDealForm(f => ({ ...f, start_date: e.target.value }))} />
                        </div>
                        <div>
                          <label className="text-xs text-gray-500 mb-1 block">תאריך תפוגה</label>
                          <input type="date" className="w-full border rounded-xl px-3 py-2 text-sm" value={dealForm.expiration_date} onChange={e => setDealForm(f => ({ ...f, expiration_date: e.target.value }))} />
                        </div>
                      </div>

                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={dealForm.is_active} onChange={e => setDealForm(f => ({ ...f, is_active: e.target.checked }))} />
                        עסקה פעילה
                      </label>

                      <button onClick={handleSaveDeal} disabled={savingDiscount || !dealForm.club_id || !dealForm.business_id || !dealForm.title} className="w-full py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                        {savingDiscount ? '...' : t('app.save')}
                      </button>
                    </div>
                  )}

                  {!dealsLoaded ? <p className="text-sm text-gray-400 text-center py-4">{t('app.loading')}</p> : (
                    <div className="space-y-2">
                      {adminDeals.length === 0 && <p className="text-sm text-gray-400 text-center py-4">{t('discounts.no_deals')}</p>}
                      {adminDeals.map(deal => (
                        <div key={deal.deal_id} className="p-3 bg-gray-50 rounded-2xl space-y-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800 truncate">{deal.title}</p>
                              <p className="text-xs text-gray-500">{deal.business_name} · {deal.club_name}</p>
                              <div className="flex gap-1.5 mt-1 flex-wrap">
                                {deal.discount_type === 'percent' && deal.discount_value != null && (
                                  <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">{deal.discount_value}%</span>
                                )}
                                {deal.discount_type === 'fixed' && deal.discount_value != null && (
                                  <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">₪{deal.discount_value}</span>
                                )}
                                {deal.promo_code && (
                                  <span className="text-[10px] bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-mono">{deal.promo_code}</span>
                                )}
                                {deal.expiration_date && (
                                  <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">עד {deal.expiration_date}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => openEditDeal(deal)} className="p-1.5 text-gray-400 hover:text-blue-500"><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteDeal(deal.deal_id)} className="p-1.5 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Page Views ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <button
            className="w-full flex items-center justify-between"
            onClick={() => { setShowPageViews(v => !v); if (!showPageViews) loadPageViews() }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-sky-50">
                <Activity className="w-5 h-5 text-sky-500" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800 text-sm">{t('admin.pageviews.title')}</p>
                <p className="text-xs text-gray-400 mt-0.5">כניסות לכל עמוד לפי תאריך</p>
              </div>
            </div>
            {showPageViews ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          </button>

          {showPageViews && (
            <div className="mt-4 space-y-3">
              {/* Filter tabs */}
              <div className="flex gap-1.5">
                {(['day', 'week', 'month', 'custom'] as const).map(f => (
                  <button
                    key={f}
                    onClick={() => { setPageViewsFilter(f); if (f !== 'custom') setTimeout(loadPageViews, 0) }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors ${
                      pageViewsFilter === f ? 'bg-sky-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {t(`admin.pageviews.${f}`)}
                  </button>
                ))}
              </div>

              {pageViewsFilter === 'custom' && (
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">מ</label>
                    <input type="date" className="w-full border rounded-xl px-3 py-2 text-xs" value={pageViewsFrom} onChange={e => setPageViewsFrom(e.target.value)} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500 block mb-1">עד</label>
                    <input type="date" className="w-full border rounded-xl px-3 py-2 text-xs" value={pageViewsTo} onChange={e => setPageViewsTo(e.target.value)} />
                  </div>
                  <button onClick={loadPageViews} className="px-3 py-2 bg-sky-500 text-white text-xs rounded-xl">הצג</button>
                </div>
              )}

              {pageViewsLoading ? (
                <p className="text-xs text-gray-400 text-center py-3">טוען...</p>
              ) : pageViewsData.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">אין נתונים לטווח זה</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 border-b border-gray-100">
                        <th className="text-right py-1.5 font-medium">{t('admin.pageviews.page')}</th>
                        <th className="text-center py-1.5 font-medium px-2">{t('admin.pageviews.views')}</th>
                        <th className="text-center py-1.5 font-medium">{t('admin.pageviews.unique')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageViewsData.map(row => (
                        <tr key={row.page} className="border-b border-gray-50">
                          <td className="py-2 text-gray-700 font-medium">{row.page}</td>
                          <td className="py-2 text-center text-gray-800 font-bold px-2">{row.views}</td>
                          <td className="py-2 text-center text-gray-500">{row.unique_users}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Seller Profiles ── */}
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-gray-100">
          <button
            className="w-full flex items-center justify-between"
            onClick={() => { setShowSellerProfiles(v => !v); if (!showSellerProfiles && !sellerProfilesLoaded) loadSellerProfiles() }}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-indigo-50">
                <UserCheck className="w-5 h-5 text-indigo-500" />
              </div>
              <div className="text-right">
                <p className="font-semibold text-gray-800 text-sm">{t('admin.sellers.title')}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {sellerProfilesLoaded
                    ? `${sellerProfilesList.filter(p => p.verification_status === 'pending').length} ממתין לאישור`
                    : 'אישור פרופילי מוכרים'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sellerProfilesList.filter(p => p.verification_status === 'pending').length > 0 && (
                <span className="w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-bold">
                  {sellerProfilesList.filter(p => p.verification_status === 'pending').length}
                </span>
              )}
              {showSellerProfiles ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
            </div>
          </button>

          {showSellerProfiles && (
            <div className="mt-4 space-y-2">
              {!sellerProfilesLoaded ? (
                <p className="text-xs text-gray-400 text-center py-3">טוען...</p>
              ) : sellerProfilesList.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-3">{t('admin.sellers.empty')}</p>
              ) : sellerProfilesList.map(sp => (
                <div key={sp.user_id} className="bg-gray-50 rounded-2xl p-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">{sp.full_name}</p>
                      <p className="text-xs text-gray-400">{sp.user_email || sp.email}</p>
                      <div className="flex gap-2 mt-1 text-xs text-gray-500">
                        <span>📞 {sp.phone}</span>
                        <span>🪪 {sp.id_number}</span>
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
                      sp.verification_status === 'verified' ? 'bg-green-100 text-green-700'
                      : sp.verification_status === 'rejected' ? 'bg-red-100 text-red-600'
                      : 'bg-amber-100 text-amber-700'
                    }`}>
                      {sp.verification_status === 'verified' ? t('admin.sellers.status.verified')
                        : sp.verification_status === 'rejected' ? t('admin.sellers.status.rejected')
                        : t('admin.sellers.status.pending')}
                    </span>
                  </div>

                  {sp.admin_note && (
                    <p className="text-xs text-red-500 italic">{t('seller.profile.rejected.note')} {sp.admin_note}</p>
                  )}

                  {sp.verification_status === 'pending' && (
                    <div className="space-y-1.5 pt-1">
                      {showRejectNoteFor === sp.user_id && (
                        <input
                          className="w-full border rounded-xl px-3 py-1.5 text-xs"
                          placeholder="הערת דחייה (אופציונלי)"
                          value={rejectNoteInputs[sp.user_id] ?? ''}
                          onChange={e => setRejectNoteInputs(prev => ({ ...prev, [sp.user_id]: e.target.value }))}
                        />
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSellerProfileDecision(sp.user_id, 'verified')}
                          disabled={updatingSellerProfile === sp.user_id}
                          className="flex-1 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                        >
                          {updatingSellerProfile === sp.user_id ? '...' : t('admin.sellers.approve')}
                        </button>
                        {showRejectNoteFor === sp.user_id ? (
                          <button
                            onClick={() => handleSellerProfileDecision(sp.user_id, 'rejected')}
                            disabled={updatingSellerProfile === sp.user_id}
                            className="flex-1 py-1.5 bg-red-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
                          >
                            {updatingSellerProfile === sp.user_id ? '...' : 'שלח דחייה'}
                          </button>
                        ) : (
                          <button
                            onClick={() => setShowRejectNoteFor(sp.user_id)}
                            className="flex-1 py-1.5 bg-red-100 text-red-600 text-xs font-semibold rounded-lg"
                          >
                            {t('admin.sellers.reject')}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Exports */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={exportCSV}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-3xl py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-green-600" />
            ייצוא שוברים
          </button>
          <button
            onClick={exportUsersCSV}
            className="flex items-center justify-center gap-2 bg-white border border-gray-200 rounded-3xl py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 shadow-sm"
          >
            <Download className="w-4 h-4 text-blue-500" />
            ייצוא משתמשים
          </button>
        </div>

      </div>
    </div>
  )
}
