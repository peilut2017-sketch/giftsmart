import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import { supabase } from '../lib/supabase'
import { formatCurrency, getExpiryStatus, formatDate } from '../utils/helpers'
import { Shield, Users, Star, Download, Edit2, Trash2, Plus, Globe, BarChart2, Zap, ChevronDown, ChevronUp, Crown, Ticket, MessageSquare, Send, CheckCheck, Eye, Bell, ToggleLeft, ToggleRight, Image, GripVertical, Link, Flag } from 'lucide-react'
import toast from 'react-hot-toast'
import type { SuperVoucher } from '../types'
import ConfirmDialog from '../components/ConfirmDialog'
import { SUPER_VOUCHER_STORES } from '../types'


interface UserRow {
  id: string
  email: string
  name?: string
  created_at: string
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

const CATEGORY_LABELS: Record<string, string> = {
  billing: '💳 חיוב',
  bug: '🐛 באג',
  feature: '💡 פיצ\'ר',
  general: '💬 כללי',
}

type Confirm = { title: string; message?: string; onConfirm: () => void }

export default function AdminPage() {
  const { user, isAdmin } = useAuth()
  const { vouchers, archivedVouchers, superVouchers, walletName, addSuperVoucher, updateSuperVoucher, deleteSuperVoucher, updateWalletName } = useVouchers()

  const [systemStats, setSystemStats] = useState<SystemStats | null>(null)
  const [proCount, setProCount] = useState<number | null>(null)
  const [allUsers, setAllUsers] = useState<UserRow[]>([])
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
    id: string
    reporter_email: string
    reported_email: string
    reason: string
    details: string | null
    status: string
    created_at: string
    purchase_id: string | null
    listing_id: string | null
  }[]>([])
  const [reportsLoaded, setReportsLoaded] = useState(false)
  const [updatingReport, setUpdatingReport] = useState<string | null>(null)

  async function loadReports() {
    if (reportsLoaded) return
    const { data, error } = await supabase.rpc('admin_get_reports')
    if (!error && data) setReports(data)
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
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, status } : r))
      toast.success('סטטוס עודכן')
    } catch {
      toast.error('שגיאה בעדכון')
    } finally {
      setUpdatingReport(null)
    }
  }

  useEffect(() => {
    if (!isAdmin) return
    supabase.rpc('get_system_stats').then(({ data }) => { if (data) setSystemStats(data) })
    supabase.rpc('get_all_users').then(({ data }) => { if (data) setAllUsers(data) })
    supabase.rpc('admin_get_pro_count').then(({ data }) => { if (data !== null) setProCount(data) })
    supabase.rpc('get_premium_enabled').then(({ data }) => { setPremiumEnabled(data !== false) })
  }, [isAdmin])

  async function handleTogglePremium() {
    if (premiumEnabled === null) return
    const next = !premiumEnabled
    setPremiumToggling(true)
    const { error } = await supabase.rpc('admin_set_premium_enabled', { p_enabled: next })
    setPremiumToggling(false)
    if (error) { toast.error('שגיאה: ' + error.message); return }
    setPremiumEnabled(next)
    toast.success(next ? '💎 מערך מנויים הופעל' : '🔓 מערך מנויים הושבת — כולם Pro')
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
    if (!file.type.startsWith('image/')) { toast.error('יש להעלות קובץ תמונה'); return }
    setUploadingBanner(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `banner-${Date.now()}.${ext}`
      const { error: uploadErr } = await supabase.storage.from('banners').upload(path, file, { upsert: true })
      if (uploadErr) { toast.error('שגיאה בהעלאה: ' + uploadErr.message); return }
      const { data: { publicUrl } } = supabase.storage.from('banners').getPublicUrl(path)
      const { data, error } = await supabase.rpc('admin_add_banner', {
        p_image_url: publicUrl,
        p_display_duration: 5,
        p_skip_allowed: true,
      })
      if (error) { toast.error('שגיאה בשמירה: ' + error.message); return }
      if (data) setBanners(prev => [data, ...prev])
      toast.success('באנר הועלה בהצלחה!')
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
      title: 'מחיקת באנר',
      message: 'למחוק את הבאנר?',
      onConfirm: async () => {
        setConfirm(null)
        // Delete from storage
        const path = imageUrl.split('/banners/').pop()
        if (path) await supabase.storage.from('banners').remove([path])
        await supabase.rpc('admin_delete_banner', { p_id: id })
        setBanners(prev => prev.filter(b => b.id !== id))
        toast.success('באנר נמחק')
      },
    })
  }

  async function handleUpdateBannerSettings(id: string, duration: number, skip: boolean) {
    await supabase.rpc('admin_update_banner_settings', { p_id: id, p_display_duration: duration, p_skip_allowed: skip })
    setBanners(prev => prev.map(b => b.id === id ? { ...b, display_duration: duration, skip_allowed: skip } : b))
    setEditingBannerId(null)
    toast.success('הגדרות באנר עודכנו')
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
    if (!operatorForm.name.trim() || !operatorForm.url.trim()) return toast.error('שם וקישור הם שדות חובה')
    const { data, error } = await supabase.rpc('admin_create_operator', { p_name: operatorForm.name.trim(), p_url: operatorForm.url.trim() })
    if (error) return toast.error('שגיאה: ' + error.message)
    if (data) setOperators(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name, 'he')))
    setOperatorForm({ name: '', url: '' })
    setShowAddOperator(false)
    toast.success('מפעיל נוסף')
  }

  async function handleUpdateOperator() {
    if (!editingOperator) return
    await supabase.rpc('admin_update_operator', { p_id: editingOperator.id, p_name: editingOperator.name, p_url: editingOperator.url })
    setOperators(prev => prev.map(o => o.id === editingOperator.id ? editingOperator : o).sort((a, b) => a.name.localeCompare(b.name, 'he')))
    setEditingOperator(null)
    toast.success('מפעיל עודכן')
  }

  async function handleDeleteOperator(id: string, name: string) {
    setConfirm({
      title: 'מחיקת מפעיל',
      message: `למחוק את "${name}"?`,
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_operator', { p_id: id })
        setOperators(prev => prev.filter(o => o.id !== id))
        toast.success('מפעיל נמחק')
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
          new Notification('הודעה חדשה', {
            body: `${msg.user_email || 'משתמש'}: ${msg.subject}`,
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
    if (!couponForm.code || !couponForm.name) return toast.error('קוד ושם הם שדות חובה')
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
    if (error) return toast.error('שגיאה: ' + error.message)
    setCoupons(prev => [data, ...prev])
    setShowAddCoupon(false)
    setCouponForm({ code: '', name: '', type: 'general', discount_type: 'months_free', discount_value: 1, max_uses: '', valid_until: '', restricted_to_email: '', first_time_only: false, stripe_coupon_code: '' })
    toast.success('קופון נוצר!')
  }

  async function handleToggleCoupon(id: string, active: boolean) {
    await supabase.rpc('admin_toggle_coupon', { p_id: id, p_active: active })
    setCoupons(prev => prev.map(c => c.id === id ? { ...c, is_active: active } : c))
  }

  async function handleDeleteCoupon(id: string, code: string) {
    setConfirm({
      title: 'מחיקת קופון',
      message: `למחוק את הקופון "${code}"?`,
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_coupon', { p_id: id })
        setCoupons(prev => prev.filter(c => c.id !== id))
        toast.success('קופון נמחק')
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
    if (error) return toast.error('שגיאה: ' + error.message)
    const newReply = { id: crypto.randomUUID(), sender: 'admin', body: reply, created_at: new Date().toISOString() }
    setMsgReplies(prev => ({ ...prev, [msg.id]: [...(prev[msg.id] || []), newReply] }))
    setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, status: 'replied', admin_reply: reply } : m))
    setReplyTexts(prev => ({ ...prev, [msg.id]: '' }))
    toast.success('תשובה נשלחה')
  }

  async function handleEditReply(replyId: string, msgId: string) {
    const newBody = editingReplyText.trim()
    if (!newBody) return
    const { error } = await supabase.rpc('admin_edit_reply', { p_reply_id: replyId, p_body: newBody })
    if (error) return toast.error('שגיאה בעריכה: ' + error.message)
    setMsgReplies(prev => ({
      ...prev,
      [msgId]: (prev[msgId] || []).map(r => r.id === replyId ? { ...r, body: newBody } : r),
    }))
    setEditingReplyId(null)
    toast.success('התשובה עודכנה')
  }

  async function handleDeleteReply(replyId: string, msgId: string) {
    setConfirm({
      title: 'מחיקת תשובה',
      message: 'למחוק את התשובה?',
      onConfirm: async () => {
        setConfirm(null)
        const { error } = await supabase.rpc('admin_delete_reply', { p_reply_id: replyId })
        if (error) return toast.error('שגיאה במחיקה: ' + error.message)
        setMsgReplies(prev => ({
          ...prev,
          [msgId]: (prev[msgId] || []).filter(r => r.id !== replyId),
        }))
        toast.success('התשובה נמחקה')
      },
    })
  }

  async function handleDeleteBroadcast(id: string) {
    setConfirm({
      title: 'מחיקת הודעה',
      message: 'למחוק את ההודעה לכלל המשתמשים?',
      onConfirm: async () => {
        setConfirm(null)
        await supabase.rpc('admin_delete_broadcast', { p_id: id })
        setBroadcasts(prev => prev.filter(b => b.id !== id))
        toast.success('הודעה נמחקה')
      },
    })
  }

  async function handleSaveEditBroadcast(id: string) {
    const { subject, body } = editingBroadcastForm
    if (!subject.trim() || !body.trim()) return toast.error('נושא וגוף חובה')
    const { error } = await supabase.rpc('admin_edit_broadcast', { p_id: id, p_subject: subject.trim(), p_body: body.trim() })
    if (error) return toast.error('שגיאה בעדכון: ' + error.message)
    setBroadcasts(prev => prev.map(b => b.id === id ? { ...b, subject: subject.trim(), body: body.trim() } : b))
    setEditingBroadcastId(null)
    toast.success('הודעה עודכנה')
  }

  async function handleLoadBroadcastViewers(id: string) {
    if (showViewersFor === id) { setShowViewersFor(null); return }
    setLoadingViewersFor(id)
    const { data, error } = await supabase.rpc('admin_get_broadcast_views', { p_broadcast_id: id })
    setLoadingViewersFor(null)
    if (error) return toast.error('שגיאה: ' + error.message)
    setBroadcastViewers(prev => ({ ...prev, [id]: data || [] }))
    setShowViewersFor(id)
  }

  async function handleCreateBroadcast() {
    if (!broadcastForm.subject.trim() || !broadcastForm.body.trim()) return toast.error('נושא וגוף חובה')
    setSendingBroadcast(true)
    const { data, error } = await supabase.rpc('admin_create_broadcast', {
      p_subject: broadcastForm.subject.trim(),
      p_body: broadcastForm.body.trim(),
    })
    setSendingBroadcast(false)
    if (error) return toast.error('שגיאה: ' + error.message)
    setBroadcasts(prev => [data, ...prev])
    setBroadcastForm({ subject: '', body: '' })
    toast.success('הודעה נשלחה לכל המשתמשים!')
  }

  async function handleCreatePushBroadcast() {
    if (!pushForm.title.trim() || !pushForm.body.trim()) return toast.error('כותרת וגוף חובה')
    setSendingPush(true)
    const { data, error } = await supabase.rpc('admin_create_push_broadcast', {
      p_title: pushForm.title.trim(),
      p_body: pushForm.body.trim(),
    })
    setSendingPush(false)
    if (error) return toast.error('שגיאה: ' + error.message)
    if (data) setBroadcasts(prev => prev) // push broadcasts are separate
    setPushForm({ title: '', body: '' })
    toast.success('התראת פוש נשלחה לכל המשתמשים!')
  }

  useEffect(() => {
    if (!showBroadcasts || broadcasts.length > 0) return
    supabase.rpc('admin_get_broadcasts').then(({ data }) => { if (data) setBroadcasts(data) })
  }, [showBroadcasts])

  if (!isAdmin) {
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
    toast.success('שם הארנק עודכן')
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
    toast.success(svGlobal ? 'שובר-על גלובלי נוסף' : 'שובר-על נוסף')
    setSvName(''); setSvStores(''); setSvDesc(''); setSvGlobal(false); setSvBalanceUrl('')
    setShowAddSV(false)
  }

  async function handleQuickAddSV(name: string, stores: string[]) {
    const alreadyExists = superVouchers.some(sv => sv.name === name)
    if (alreadyExists) return toast(`"${name}" כבר קיים`, { icon: 'ℹ️' })
    await addSuperVoucher({ name, stores, is_global: true })
    toast.success(`"${name}" נוסף כשובר-על גלובלי`)
  }

  function handleDeleteSV(id: string, name: string) {
    setConfirm({
      title: 'מחיקת שובר-על',
      message: `למחוק את "${name}"? הפעולה אינה ניתנת לביטול.`,
      onConfirm: async () => {
        setConfirm(null)
        await deleteSuperVoucher(id)
        toast.success('נמחק')
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
                {systemStats ? formatCurrency(systemStats.total_balance) : '...'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400">שוברים פעילים</p>
              <p className="text-xl font-bold">{systemStats?.total_vouchers ?? '...'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארכיון</p>
              <p className="text-xl font-bold">{systemStats?.total_archived ?? '...'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">ארנקים</p>
              <p className="text-xl font-bold">{systemStats?.total_wallets ?? '...'}</p>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-slate-600 grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-slate-400" />
              <span className="text-sm text-slate-300">
                משתמשים:&nbsp;
                <span className="font-bold text-white">{usersCount === null ? '...' : usersCount}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Crown className="w-4 h-4 text-amber-400" />
              <span className="text-sm text-slate-300">
                מנויי Pro:&nbsp;
                <span className="font-bold text-amber-300">{proCount === null ? '...' : proCount}</span>
              </span>
            </div>
          </div>
          {expiringSoon > 0 && (
            <div className="mt-2 pt-2 border-t border-slate-600">
              <span className="text-xs bg-orange-400/20 text-orange-300 px-2 py-1 rounded-lg">
                ⚠️ {expiringSoon} שוברים פגים בקרוב
              </span>
            </div>
          )}
        </div>

        {/* Registered Users List */}
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4"
            onClick={() => setShowUsers(v => !v)}
          >
            <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Users className="w-4 h-4 text-blue-500" />
              רשימת משתמשים ({allUsers.length || usersCount || '...'})
            </span>
            <div className="flex items-center gap-2">
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
              ) : allUsers.map(u => (
                <div key={u.id} className="flex items-center justify-between px-4 py-2.5">
                  <div>
                    <p className="text-sm text-gray-800">{u.email}</p>
                    {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                  </div>
                  <div className="flex items-center gap-3">
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
              ))}
            </div>
          )}
        </div>

        {/* Wallet name */}
        <div className="bg-white rounded-3xl shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">🏷️ שם הארנק</h3>
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
                      <option value="months_free">🎁 חודשים חינם</option>
                      <option value="days_free">📅 ימים חינם</option>
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
                            {c.discount_type === 'months_free' ? `🎁 ${c.discount_value} חודשי Pro` :
                             c.discount_type === 'days_free' ? `📅 ${c.discount_value} ימי Pro` :
                             c.discount_type === 'percent' ? `% ${c.discount_value}% הנחה` :
                             `₪ ${c.discount_value}₪ הנחה`}
                          </span>
                          <span>📊 {c.uses_count}{c.max_uses ? `/${c.max_uses}` : ''} שימושים</span>
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
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
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
                              <span className="text-xs text-gray-400">{CATEGORY_LABELS[msg.category] || msg.category}</span>
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
        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-4"
            onClick={() => { setShowReports(!showReports); if (!showReports) loadReports() }}
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
              {reportsLoaded && reports.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">אין דיווחים</p>
              )}
              {reports.map(r => (
                <div key={r.id} className={`border rounded-2xl p-4 space-y-2 ${r.status === 'pending' ? 'border-red-200 bg-red-50' : r.status === 'reviewed' ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{r.reason}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        מדווח: <span className="font-medium">{r.reporter_email}</span>
                        {' · '}על: <span className="font-medium text-red-700">{r.reported_email}</span>
                      </p>
                    </div>
                    <span className={`text-xs font-medium px-2 py-1 rounded-full shrink-0 ${r.status === 'pending' ? 'bg-red-100 text-red-700' : r.status === 'reviewed' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                      {r.status === 'pending' ? 'ממתין' : r.status === 'reviewed' ? 'נבדק' : 'נסגר'}
                    </span>
                  </div>
                  {r.details && <p className="text-xs text-gray-600 bg-white rounded-xl p-2">{r.details}</p>}
                  <p className="text-xs text-gray-400">{new Date(r.created_at).toLocaleDateString('he-IL')}</p>
                  <div className="flex gap-2">
                    {r.status !== 'reviewed' && (
                      <button
                        disabled={updatingReport === r.id}
                        onClick={() => updateReportStatus(r.id, 'reviewed')}
                        className="px-3 py-1.5 text-xs font-medium bg-yellow-100 text-yellow-700 rounded-xl hover:bg-yellow-200 disabled:opacity-50"
                      >
                        סמן כנבדק
                      </button>
                    )}
                    {r.status !== 'resolved' && (
                      <button
                        disabled={updatingReport === r.id}
                        onClick={() => updateReportStatus(r.id, 'resolved')}
                        className="px-3 py-1.5 text-xs font-medium bg-green-100 text-green-700 rounded-xl hover:bg-green-200 disabled:opacity-50"
                      >
                        סגור
                      </button>
                    )}
                  </div>
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
