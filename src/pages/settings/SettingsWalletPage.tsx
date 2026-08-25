import { useState, useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { useVouchers } from '../../contexts/VoucherContext'
import { useDiscounts } from '../../contexts/DiscountsContext'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import ConfirmDialog from '../../components/ConfirmDialog'
import { SettingsSubHeader, Card, SL, Spinner, Switch } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

const APP_URL = import.meta.env.VITE_APP_URL || (typeof window !== 'undefined' ? window.location.origin : '')

interface WalletMemberRow { user_id: string; email: string; role: string }

export default function SettingsWalletPage() {
  usePageView('settings_wallet')
  const { t } = useT()
  const { profile, updateProfile, user } = useAuth()
  const { walletId, walletName, inviteMember, removeMember, logAction } = useVouchers()
  const { clubs, userClubIds, fetchClubs, setUserClubs } = useDiscounts()

  const [members, setMembers] = useState<WalletMemberRow[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [pendingInviteEmail, setPendingInviteEmail] = useState<string | null>(null)

  const [localClubIds, setLocalClubIds] = useState<string[]>([])
  const [savingClubs, setSavingClubs] = useState(false)
  const [clubsOpen, setClubsOpen] = useState(false)
  const [clubsLoaded, setClubsLoaded] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<WalletMemberRow | null>(null)

  useEffect(() => { fetchClubs().finally(() => setClubsLoaded(true)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLocalClubIds(userClubIds) }, [userClubIds])

  const clubsDirty = JSON.stringify([...localClubIds].sort()) !== JSON.stringify([...userClubIds].sort())

  useEffect(() => {
    if (!walletId) return
    supabase.from('wallet_members').select('user_id, email, role').eq('wallet_id', walletId)
      .then(({ data }) => { if (data) setMembers(data) })
  }, [walletId])

  async function handleInvite() {
    if (!inviteEmail.trim()) return
    setInviteLoading(true)
    try {
      const result = await inviteMember(inviteEmail.trim())
      if (result === 'not_found') {
        setPendingInviteEmail(inviteEmail.trim())
      } else {
        toast.success(t('wallet.member.added'))
        logAction('system_wallet_share', 'ארנק', undefined, { email: inviteEmail.trim() })
        setInviteEmail('')
        if (walletId) {
          const { data } = await supabase.from('wallet_members').select('user_id, email, role').eq('wallet_id', walletId)
          if (data) setMembers(data)
        }
      }
    } catch (err: any) {
      toast.error(err?.message || t('wallet.invite.error'))
    } finally {
      setInviteLoading(false)
    }
  }

  async function handleSendNotFoundInvite() {
    if (!pendingInviteEmail) return
    try {
      await supabase.rpc('send_wallet_invite_to_new_user', {
        p_to_email: pendingInviteEmail,
        p_from_name: profile?.name || user?.email || 'מישהו',
        p_wallet_name: walletName,
        p_app_url: APP_URL,
      })
      toast.success(t('wallet.invite.sent', { email: pendingInviteEmail }))
    } catch {
      toast.error(t('wallet.invite.send.error'))
    } finally {
      setPendingInviteEmail(null)
      setInviteEmail('')
    }
  }

  // No longer optimistic: the row only disappears after the server confirmed —
  // a failed removal used to vanish from the UI while staying in the wallet
  async function doRemoveMember(userId: string) {
    try {
      await removeMember(userId)
      setMembers(prev => prev.filter(m => m.user_id !== userId))
      toast.success(t('wallet.member.removed'))
    } catch {
      toast.error(t('wallet.member.remove.error'))
    }
  }

  async function handleSaveClubs() {
    setSavingClubs(true)
    try {
      await setUserClubs(localClubIds)
      toast.success(t('settings.clubs.saved'))
    } catch {
      toast.error(t('app.error'))
    } finally {
      setSavingClubs(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('nav.wallet')} />
      <div className="p-4 space-y-4 pb-10">
        <SL>{t('wallet.sharing.section')}</SL>
        <Card>
          <div className="p-4 space-y-3">
            {/* The privacy consequence is stated BEFORE the invite input — it used
                to appear only after the user had already typed and submitted */}
            <div className="flex items-start gap-2 bg-warning/10 border border-warning/25 rounded-xl p-2.5">
              <Icon name="group" size={15} color="var(--c-warning)" className="mt-0.5 shrink-0" />
              <p className="text-xs text-warning">{t('wallet.share.warning.a')} <strong>{t('wallet.share.warning.b')}</strong> {t('wallet.share.warning.c')}</p>
            </div>
            {members.length > 0 && (
              <div className="space-y-1 mb-2">
                {members.map(m => (
                  <div key={m.user_id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                    <div>
                      <p className="text-sm text-text2">{m.email}</p>
                      <p className="text-xs text-text3">{m.role === 'owner' ? t('wallet.role.owner') : t('wallet.role.member')}</p>
                    </div>
                    {m.role !== 'owner' && (
                      <button onClick={() => setRemoveTarget(m)} aria-label={t('settings.wallet.remove.aria', { email: m.email })} className="p-2.5 text-error rounded-lg bg-error/5">
                        <Icon name="delete" size={17} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {pendingInviteEmail ? (
              <div className="bg-warning/10 rounded-2xl p-3 space-y-2">
                <p className="text-sm text-warning">{t('wallet.not.registered.a')} <strong>{pendingInviteEmail}</strong> {t('wallet.not.registered.b')}</p>
                <div className="flex gap-2">
                  <button onClick={handleSendNotFoundInvite} className="flex-1 bg-warning text-white py-2 rounded-xl text-sm font-medium">{t('wallet.send.invite')}</button>
                  <button onClick={() => { setPendingInviteEmail(null); setInviteEmail('') }} className="flex-1 bg-bg text-text2 py-2 rounded-xl text-sm font-medium">{t('app.cancel')}</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <Icon name="person_add" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInvite()}
                    placeholder={t('wallet.invite.placeholder')}
                    className="w-full min-w-0 pr-9 pl-3 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                    dir="ltr"
                  />
                </div>
                <button
                  onClick={handleInvite}
                  disabled={inviteLoading || !inviteEmail.trim()}
                  className="shrink-0 px-4 py-2.5 bg-primary text-white rounded-xl text-sm font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  {inviteLoading ? <Spinner size={16} color="#fff" /> : t('app.add')}
                </button>
              </div>
            )}
          </div>
        </Card>

        <SL>{t('wallet.display.section')}</SL>
        <Card>
          <div className="flex items-center justify-between p-4">
            <div className="flex-1 ml-3">
              <p className="text-sm font-medium text-text">{t('wallet.show.value')}</p>
              <p className="text-xs text-text3 mt-0.5">{t('wallet.show.value.desc')}</p>
            </div>
            <Switch checked={!!profile?.show_voucher_value} onChange={v => updateProfile({ show_voucher_value: v })} />
          </div>
        </Card>

        <SL>{t('settings.my_clubs')}</SL>
        <Card>
          <button
            onClick={() => setClubsOpen(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 text-right"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text">{t('settings.my_clubs')}</p>
              <p className="text-xs mt-0.5 text-text3">{t('settings.my_clubs.sub')}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0 me-2">
              {clubsDirty && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning/15 text-warning">{t('wallet.unsaved')}</span>
              )}
              {localClubIds.length > 0 && (
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary text-white">
                  {localClubIds.length}
                </span>
              )}
              <Icon name={clubsOpen ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
            </div>
          </button>

          {clubsOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-border">
              {/* Loading and "no clubs configured" are separate states now — a failed
                  or empty fetch used to show "טוען..." forever */}
              {!clubsLoaded ? (
                <p className="text-sm text-center py-4 text-text3">{t('app.loading')}</p>
              ) : clubs.length === 0 ? (
                <p className="text-sm text-center py-4 text-text3">{t('wallet.no.clubs')}</p>
              ) : (
                <>
                  {clubs.filter(c => c.type === 'credit_card').length > 0 && (
                    <div className="pt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon name="credit_card" size={16} color="var(--c-primary)" />
                        <span className="text-xs font-bold uppercase tracking-wide text-text3">{t('settings.clubs.credit_card')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {clubs.filter(c => c.type === 'credit_card').map(club => {
                          const selected = localClubIds.includes(club.id)
                          return (
                            <button
                              key={club.id}
                              onClick={() => setLocalClubIds(prev => selected ? prev.filter(id => id !== club.id) : [...prev, club.id])}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors duration-150 ${selected ? 'border-primary bg-primary-light text-primary' : 'border-border bg-surface text-text2'}`}
                            >
                              {selected && <Icon name="check" size={12} />}
                              {club.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {clubs.filter(c => c.type === 'loyalty_club').length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Icon name="sell" size={16} color="var(--c-primary)" />
                        <span className="text-xs font-bold uppercase tracking-wide text-text3">{t('settings.clubs.loyalty_club')}</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {clubs.filter(c => c.type === 'loyalty_club').map(club => {
                          const selected = localClubIds.includes(club.id)
                          return (
                            <button
                              key={club.id}
                              onClick={() => setLocalClubIds(prev => selected ? prev.filter(id => id !== club.id) : [...prev, club.id])}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-colors duration-150 ${selected ? 'border-primary bg-primary-light text-primary' : 'border-border bg-surface text-text2'}`}
                            >
                              {selected && <Icon name="check" size={12} />}
                              {club.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleSaveClubs}
                    disabled={savingClubs}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2 bg-primary"
                  >
                    {savingClubs ? <Spinner size={16} color="#fff" /> : <Icon name="check" size={16} />}
                    {t('app.save')}
                  </button>
                </>
              )}
            </div>
          )}
        </Card>
      </div>

      <AnimatePresence>
        {removeTarget && (
          <ConfirmDialog
            title={t('settings.wallet.remove.confirm.title', { email: removeTarget.email })}
            message={t('settings.wallet.remove.confirm.message')}
            danger
            onConfirm={() => { const m = removeTarget; setRemoveTarget(null); doRemoveMember(m.user_id) }}
            onCancel={() => setRemoveTarget(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
