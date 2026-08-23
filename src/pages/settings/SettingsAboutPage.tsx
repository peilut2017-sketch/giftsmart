import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../utils/helpers'
import toast from 'react-hot-toast'
import ActivityLog from '../../components/ActivityLog'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import { SettingsSubHeader, Card, SL, MenuItem } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'
// Delete-account / sign-out live in the hub's Danger Zone, not here — About is purely
// informational (onboarding replay, legal links, admin link).

interface SupportMessageReply { id: string; message_id: string; sender: 'user' | 'admin'; body: string; created_at: string }
interface SupportMessage {
  id: string; subject: string; body: string; category: string
  status: 'unread' | 'read' | 'replied'; admin_reply: string | null; replied_at: string | null
  created_at: string; replies?: SupportMessageReply[]
}
interface AdminBroadcast { id: string; subject: string; body: string; created_at: string }

export default function SettingsAboutPage() {
  usePageView('settings_about')
  const navigate = useNavigate()
  const { t } = useT()
  const { user, profile } = useAuth()

  const [supportSubject, setSupportSubject] = useState('')
  const [supportBody, setSupportBody] = useState('')
  const [supportCategory, setSupportCategory] = useState('general')
  const [sendingSupport, setSendingSupport] = useState(false)
  const [myMessages, setMyMessages] = useState<SupportMessage[]>([])
  const [showMyMessages, setShowMyMessages] = useState(false)
  const [supportSent, setSupportSent] = useState(false)
  const [expandedMessageId, setExpandedMessageId] = useState<string | null>(null)
  const [replyTexts, setReplyTexts] = useState<Record<string, string>>({})
  const [sendingUserReply, setSendingUserReply] = useState<string | null>(null)

  const [adminBroadcasts, setAdminBroadcasts] = useState<AdminBroadcast[]>([])
  const [seenBroadcastIds, setSeenBroadcastIds] = useState<Set<string>>(
    () => new Set(JSON.parse(localStorage.getItem('seen_broadcast_ids') || '[]'))
  )

  useEffect(() => {
    if (!user) return
    supabase.from('admin_broadcasts').select('*').order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setAdminBroadcasts(data) })
  }, [user])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`replies-${user.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'support_messages', filter: `user_id=eq.${user.id}` }, (payload) => {
        const updated = payload.new as SupportMessage
        if (updated.status === 'replied' && updated.admin_reply) {
          setMyMessages(prev => prev.map(m => m.id === updated.id ? { ...m, ...updated } : m))
          if (Notification.permission === 'granted') {
            new Notification(t('about.admin.reply.notif'), { body: updated.admin_reply, icon: '/notification-icon.png' })
          }
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

  async function loadMyMessages() {
    const { data } = await supabase.from('support_messages').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
    if (!data) return
    const withReplies = await Promise.all(data.map(async msg => {
      const { data: replies } = await supabase.rpc('get_message_replies', { p_message_id: msg.id })
      return { ...msg, replies: replies || [] }
    }))
    setMyMessages(withReplies)
  }

  async function sendSupportMessage() {
    if (!supportSubject.trim() || !supportBody.trim()) return toast.error(t('about.support.required'))
    setSendingSupport(true)
    const { error } = await supabase.from('support_messages').insert({
      user_id: user!.id, user_email: user!.email, user_name: profile?.name || null,
      subject: supportSubject.trim(), body: supportBody.trim(), category: supportCategory,
    })
    setSendingSupport(false)
    if (error) return toast.error(t('about.send.error', { error: error.message }))
    setSupportSubject(''); setSupportBody(''); setSupportCategory('general')
    setSupportSent(true)
    toast.success(t('about.message.sent'))
    const { data } = await supabase.from('support_messages').select('*').eq('user_id', user!.id).order('created_at', { ascending: false })
    if (data) setMyMessages(data)
    setShowMyMessages(true)
  }

  async function sendUserReply(messageId: string) {
    const body = replyTexts[messageId]?.trim()
    if (!body) return
    setSendingUserReply(messageId)
    const { error } = await supabase.rpc('user_reply_message', { p_id: messageId, p_body: body })
    setSendingUserReply(null)
    if (error) return toast.error(t('about.send.error', { error: error.message }))
    const newReply: SupportMessageReply = { id: crypto.randomUUID(), message_id: messageId, sender: 'user', body, created_at: new Date().toISOString() }
    setMyMessages(prev => prev.map(m => m.id === messageId ? { ...m, replies: [...(m.replies || []), newReply] } : m))
    setReplyTexts(prev => ({ ...prev, [messageId]: '' }))
    toast.success(t('about.reply.sent'))
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('about.title')} />
      <div className="p-4 space-y-4 pb-10">
        {/* Support is open to every user — it's the only contact channel, and the
            privacy policy and terms both point here as the way to reach us. */}
        <>
            <SL>{t('about.support')}</SL>
            <Card>
              <div className="px-4 py-2.5 border-b border-border flex items-center justify-end">
                <button onClick={() => { if (!showMyMessages) loadMyMessages(); setShowMyMessages(v => !v) }} className="text-xs text-primary flex items-center gap-1">
                  {t('about.my.messages')}
                  <Icon name={showMyMessages ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={14} />
                </button>
              </div>
              {!supportSent ? (
                <div className="p-4 space-y-3">
                  <div className="flex gap-2">
                    <input value={supportSubject} onChange={e => setSupportSubject(e.target.value)} placeholder={t('about.subject.placeholder')} className="flex-1 min-w-0 px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    <select value={supportCategory} onChange={e => setSupportCategory(e.target.value)} className="shrink-0 w-28 px-2 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="general">{t('about.cat.general')}</option>
                      <option value="billing">{t('about.cat.billing')}</option>
                      <option value="bug">{t('about.cat.bug')}</option>
                      <option value="feature">{t('about.cat.feature')}</option>
                    </select>
                  </div>
                  <textarea value={supportBody} onChange={e => setSupportBody(e.target.value)} placeholder={t('about.body.placeholder')} rows={3} className="w-full px-3 py-2 border border-border rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                  <button onClick={sendSupportMessage} disabled={sendingSupport} className="w-full bg-primary text-white py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50">
                    <Icon name="send" size={16} />
                    {sendingSupport ? t('about.sending') : t('about.send.message')}
                  </button>
                </div>
              ) : (
                <div className="p-4 flex flex-col items-center gap-2 text-center">
                  <div className="w-10 h-10 bg-primary-light rounded-2xl flex items-center justify-center"><Icon name="check" size={20} color="var(--c-primary)" /></div>
                  <p className="text-sm font-medium text-text">{t('about.message.sent')}</p>
                  <p className="text-xs text-text3">{t('about.reply.soon')}</p>
                  <button onClick={() => setSupportSent(false)} className="text-xs text-primary mt-1">{t('about.send.another')}</button>
                </div>
              )}
              {showMyMessages && (
                <div className="border-t border-border">
                  {myMessages.length === 0 ? (
                    <p className="text-center text-xs text-text3 py-4">{t('about.no.messages')}</p>
                  ) : (
                    <div className="divide-y divide-border max-h-[28rem] overflow-y-auto">
                      {myMessages.map(m => {
                        const isExpanded = expandedMessageId === m.id
                        const hasReplies = (m.replies?.length ?? 0) > 0
                        const hasAdminReply = m.admin_reply || m.replies?.some(r => r.sender === 'admin')
                        return (
                          <div key={m.id} className="px-4 py-3">
                            <button className="w-full text-right" onClick={() => { setExpandedMessageId(isExpanded ? null : m.id); if (!isExpanded) { void supabase.rpc('user_mark_message_read', { p_message_id: m.id }) } }}>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-sm font-medium text-text">{m.subject}</p>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  {hasAdminReply && <span className="text-[10px] bg-primary-light text-primary px-1.5 py-0.5 rounded-full font-medium">{t('about.status.replied')}</span>}
                                  {!hasAdminReply && <span className="text-[10px] bg-bg text-text3 px-1.5 py-0.5 rounded-full">{t('about.status.pending')}</span>}
                                  <span className="text-xs text-text3 flex items-center gap-0.5"><Icon name="schedule" size={12} />{formatDate(m.created_at)}</span>
                                </div>
                              </div>
                              {!isExpanded && <p className="text-xs text-text3 mt-0.5 line-clamp-1 text-right">{m.body}</p>}
                            </button>
                            {isExpanded && (
                              <div className="mt-2 space-y-2">
                                <div className="flex justify-end">
                                  <div className="bg-primary text-white rounded-2xl rounded-tl-sm px-3 py-2 max-w-[85%]">
                                    <p className="text-xs">{m.body}</p>
                                    <p className="text-[10px] text-white/70 mt-0.5">{formatDate(m.created_at)}</p>
                                  </div>
                                </div>
                                {hasReplies ? (
                                  m.replies!.map(r => (
                                    <div key={r.id} className={`flex ${r.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                                      <div className={`rounded-2xl px-3 py-2 max-w-[85%] ${r.sender === 'user' ? 'bg-primary text-white rounded-tl-sm' : 'bg-bg text-text rounded-tr-sm'}`}>
                                        {r.sender === 'admin' && <p className="text-[10px] font-semibold text-primary mb-0.5">{t('about.support')}</p>}
                                        <p className="text-xs">{r.body}</p>
                                        <p className={`text-[10px] mt-0.5 ${r.sender === 'user' ? 'text-white/70' : 'text-text3'}`}>{formatDate(r.created_at)}</p>
                                      </div>
                                    </div>
                                  ))
                                ) : m.admin_reply ? (
                                  <div className="flex justify-start">
                                    <div className="bg-bg text-text rounded-2xl rounded-tr-sm px-3 py-2 max-w-[85%]">
                                      <p className="text-[10px] font-semibold text-primary mb-0.5">{t('about.support')}</p>
                                      <p className="text-xs">{m.admin_reply}</p>
                                      {m.replied_at && <p className="text-[10px] text-text3 mt-0.5">{formatDate(m.replied_at)}</p>}
                                    </div>
                                  </div>
                                ) : null}
                                {hasAdminReply && (
                                  <div className="flex gap-1.5 mt-1">
                                    <input value={replyTexts[m.id] || ''} onChange={e => setReplyTexts(prev => ({ ...prev, [m.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendUserReply(m.id) } }} placeholder={t('about.reply.placeholder')} className="flex-1 px-3 py-2 border border-border rounded-xl text-xs bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" />
                                    <button onClick={() => sendUserReply(m.id)} disabled={sendingUserReply === m.id || !replyTexts[m.id]?.trim()} className="px-3 py-2 bg-primary text-white rounded-xl text-xs disabled:opacity-40 flex items-center gap-1"><Icon name="send" size={12} /></button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </Card>
        </>

        {adminBroadcasts.length > 0 && (
          <Card>
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text2 flex items-center gap-2">
                <Icon name="notifications" size={16} color="#3b82f6" />
                {t('notifications.system')}
              </h3>
              {adminBroadcasts.some(b => !seenBroadcastIds.has(b.id)) && (
                <span className="text-xs font-bold bg-primary text-white px-1.5 py-0.5 rounded-full">
                  {adminBroadcasts.filter(b => !seenBroadcastIds.has(b.id)).length}
                </span>
              )}
            </div>
            <div className="divide-y divide-border max-h-64 overflow-y-auto">
              {adminBroadcasts.map(b => {
                const isNew = !seenBroadcastIds.has(b.id)
                return (
                  <div key={b.id} className={`px-4 py-3 ${isNew ? 'bg-primary-light/40' : ''}`}
                    onMouseEnter={() => {
                      if (isNew) {
                        setSeenBroadcastIds(prev => { const next = new Set(prev); next.add(b.id); localStorage.setItem('seen_broadcast_ids', JSON.stringify([...next])); return next })
                        void supabase.rpc('record_broadcast_view', { p_broadcast_id: b.id })
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={`text-sm font-medium ${isNew ? 'text-text' : 'text-text2'}`}>{b.subject}</p>
                      <span className="text-xs text-text3 flex-shrink-0">{formatDate(b.created_at)}</span>
                    </div>
                    <p className="text-xs text-text3 mt-0.5">{b.body}</p>
                  </div>
                )
              })}
            </div>
          </Card>
        )}

        <ActivityLog />

        <SL>{t('about.section')}</SL>
        <Card>
          <div className="divide-y divide-border">
            <MenuItem
              icon="menu_book"
              label={t('settings.onboarding')}
              desc={t('about.onboarding.desc')}
              onClick={() => {
                localStorage.removeItem('onboarding_seen_v2')
                navigate('/')
                setTimeout(() => window.dispatchEvent(new Event('show-onboarding')), 120)
              }}
            />
            <MenuItem icon="description" label={t('about.terms')} desc={t('about.terms.desc')} onClick={() => navigate('/terms')} />
            <MenuItem icon="shield" label={t('about.privacy.policy')} desc={t('about.privacy.desc')} onClick={() => navigate('/privacy')} />
            {/* The admin-panel entry point lives on the Settings hub's profile card now
                (it's an identity-level capability, not an "about/support" item). */}
          </div>
        </Card>

        <p className="text-center text-xs text-text3">GiftSmart v1.1.0</p>
      </div>
    </div>
  )
}
