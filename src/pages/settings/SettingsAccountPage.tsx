import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { useAuth } from '../../contexts/AuthContext'
import { clearExplicitSignOut } from '../../lib/appMode'
import { useVouchers } from '../../contexts/VoucherContext'
import { useE2EE } from '../../contexts/E2EEContext'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import ConfirmDialog from '../../components/ConfirmDialog'
import { SettingsSubHeader, Card, Spinner, MenuItem, SL } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

interface PasswordStrength { score: number; label: string; color: string; checks: { label: string; ok: boolean }[] }
function getPasswordStrength(password: string, t: (k: string) => string): PasswordStrength {
  const checks = [
    { label: t('auth.check.length'),  ok: password.length >= 8 },
    { label: t('auth.check.upper'),   ok: /[A-Z]/.test(password) },
    { label: t('auth.check.lower'),   ok: /[a-z]/.test(password) },
    { label: t('auth.check.digit'),   ok: /\d/.test(password) },
    { label: t('auth.check.special'), ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
  ]
  const score = checks.filter(c => c.ok).length
  const labels = [t('auth.strength.very.weak'), t('auth.strength.weak'), t('auth.strength.medium'), t('auth.strength.strong'), t('auth.strength.very.strong')]
  const colors = ['bg-error', 'bg-warning', 'bg-warning', 'bg-primary-mid', 'bg-primary']
  return { score, label: labels[Math.min(score, 4)], color: colors[Math.min(score, 4)], checks }
}

export default function SettingsAccountPage() {
  usePageView('settings_account')
  const { t } = useT()
  const { user, profile, updateProfile, signOut, isAnonymous } = useAuth()
  const navigate = useNavigate()
  const { vouchers, archivedVouchers, logAction, updateVoucher } = useVouchers()
  const { isUnifiedVault, isVaultUnlocked, reDeriveVaultKeyFromPassword } = useE2EE()

  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [phone, setPhone] = useState(profile?.phone || '')
  const [email, setEmail] = useState(user?.email || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message?: string; confirmLabel?: string; onConfirm: () => void } | null>(null)

  const [editPass, setEditPass] = useState(false)
  const [currentPass, setCurrentPass] = useState('')
  const [showCurrentPass, setShowCurrentPass] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [newPass2, setNewPass2] = useState('')
  const [showNewPass, setShowNewPass] = useState(false)
  const [showNewPass2, setShowNewPass2] = useState(false)
  const [showPassStrength, setShowPassStrength] = useState(false)
  const [passwordChanging, setPasswordChanging] = useState(false)

  const pwStrength = useMemo(() => getPasswordStrength(newPass, t), [newPass]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveProfile() {
    if (savingProfile) return
    setSavingProfile(true)
    try {
      // Email change goes through Supabase Auth: a confirmation link is emailed and
      // the address only actually switches after it's clicked. A duplicate address
      // is rejected by the server.
      const newEmail = email.trim().toLowerCase()
      const emailChanged = !!newEmail && newEmail !== (user?.email || '').toLowerCase()
      if (emailChanged) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          toast.error(t('account.email.invalid'))
          return
        }
        const { error } = await supabase.auth.updateUser({ email: newEmail })
        if (error) {
          if (/already|exists|registered/i.test(error.message || '')) toast.error(t('account.email.exists'))
          else toast.error(error.message || t('app.error'))
          return
        }
        toast.success(t('account.email.confirm.sent'), { duration: 8000 })
      }
      await updateProfile({ name, phone })
      setEditName(false)
      if (!emailChanged) toast.success(t('settings.profile.updated'))
    } catch {
      toast.error(t('app.error'))
    } finally {
      setSavingProfile(false)
    }
  }

  // Real self-serve deletion — both app stores require deleting the account
  // (and its data) from inside the app, not filing a support request.
  function handleDeleteAccount() {
    setDeleteConfirmText('')
    setShowDeleteDialog(true)
  }

  async function doDeleteAccount() {
    setShowDeleteDialog(false)
    setDeletingAccount(true)
    try {
      const { error } = await supabase.rpc('delete_own_account')
      if (error) {
        if (/admin_cannot_self_delete/.test(error.message || '')) {
          toast.error(t('account.delete.admin.blocked'), { duration: 6000 })
          return
        }
        // RPC not applied yet (supabase-delete-account.sql) — fall back to the
        // old support-request path so the button never dead-ends. Guests have no
        // contact identity for a support follow-up, so for them it's a plain error.
        if (/function|schema cache/i.test(error.message || '')) {
          if (isAnonymous) { toast.error(t('app.error')); return }
          const { error: reqErr } = await supabase.from('support_messages').insert({
            user_id: user!.id, user_email: user!.email, user_name: profile?.name || null,
            subject: t('settings.delete.account.subject'), body: t('settings.delete.account.body'), category: 'general',
          })
          if (reqErr) throw reqErr
          toast.success(t('settings.delete.account.sent'), { duration: 6000 })
          return
        }
        throw error
      }
      toast.success(isAnonymous ? t('guest.reset.done') : t('account.delete.done'), { duration: 6000 })
      await signOut()
      // A guest who reset their data should land in a FRESH guest session, not
      // on a login wall they never asked for.
      if (isAnonymous) clearExplicitSignOut()
    } catch (e: any) {
      toast.error(e?.message || t('settings.delete.account.error'))
    } finally {
      setDeletingAccount(false)
    }
  }

  async function changePassword() {
    if (!currentPass) return toast.error(t('account.enter.current'))
    if (newPass !== newPass2) return toast.error(t('auth.passwords.mismatch'))
    if (newPass.length < 8) return toast.error(t('account.pass.min'))
    setPasswordChanging(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user!.email!, password: currentPass })
      if (authErr) return toast.error(t('account.pass.wrong'))

      let vaultEntries: Array<{id: string; code: string; cvv: string|null}> = []

      if (isUnifiedVault) {
        if (!isVaultUnlocked) return toast.error(t('account.unlock.vault.first'))
        const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
        const { ok, entries } = await reDeriveVaultKeyFromPassword(newPass, e2eeVouchers)
        if (!ok) return toast.error(t('account.vault.update.error'))
        vaultEntries = entries
      }

      const { error } = await supabase.auth.updateUser({ password: newPass })
      if (error) { toast.error(t('account.pass.change.error', { error: error.message })); return }

      // v3: reDeriveVaultKeyFromPassword only re-wraps the master key — no voucher
      // is re-encrypted, so entries is empty and this loop is a legacy no-op
      if (vaultEntries.length > 0) {
        await Promise.all(vaultEntries.map(({ id, code, cvv }) =>
          updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
        ))
      }

      toast.success(isUnifiedVault ? t('account.pass.changed.vault') : t('account.pass.changed'))
      setEditPass(false)
      setCurrentPass(''); setNewPass(''); setNewPass2('')
      setShowCurrentPass(false); setShowNewPass(false); setShowNewPass2(false); setShowPassStrength(false)
      logAction('system_password_change', 'מערכת')
    } finally {
      setPasswordChanging(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('account.title')} />
      <div className="p-4 space-y-4 pb-10">
        <Card>
          <div className="p-4">
            {!editName ? (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center text-lg font-extrabold text-primary shrink-0">
                  {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-text">{isAnonymous ? t('guest.profile.name') : (profile?.name || t('hub.no.name'))}</p>
                  <p className="text-xs text-text3 truncate">{isAnonymous ? t('guest.profile.desc') : user?.email}</p>
                  {phone && <p className="text-xs text-text3">{phone}</p>}
                </div>
                <button onClick={() => { setEmail(user?.email || ''); setEditName(true) }} className="w-9 h-9 rounded-xl bg-bg flex items-center justify-center shrink-0">
                  <Icon name="edit" size={16} color="var(--c-text2)" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('auth.name.placeholder')} className="h-11 rounded-xl border border-border bg-surface text-text text-base px-3 outline-none focus:ring-2 focus:ring-primary/30" />
                {!isAnonymous && (
                  <>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder={t('auth.email.placeholder')} dir="ltr" autoComplete="email" className="h-11 rounded-xl border border-border bg-surface text-text text-base px-3 outline-none focus:ring-2 focus:ring-primary/30" />
                    {email.trim().toLowerCase() !== (user?.email || '').toLowerCase() && (
                      <p className="text-[11px] text-text3 px-1">{t('account.email.change.note')}</p>
                    )}
                  </>
                )}
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder={t('seller.profile.phone')} dir="ltr" className="h-11 rounded-xl border border-border bg-surface text-text text-base px-3 outline-none focus:ring-2 focus:ring-primary/30" />
                <div className="flex gap-2">
                  <button onClick={saveProfile} disabled={savingProfile} className="flex-1 h-11 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-60 flex items-center justify-center gap-2">
                    {savingProfile && <Spinner size={15} color="#fff" />}
                    {t('app.save')}
                  </button>
                  <button onClick={() => setEditName(false)} className="flex-1 h-11 rounded-xl bg-bg text-text2 text-sm font-semibold">{t('app.cancel')}</button>
                </div>
              </div>
            )}
          </div>
        </Card>

        {!isAnonymous && (<>
        <SL>{t('account.password.section')}</SL>
        <Card>
          {!editPass ? (
            <MenuItem icon="lock" label={t('account.change.pass')} desc={t('account.change.pass.desc')} onClick={() => setEditPass(true)} />
          ) : (
            <div className="p-4 space-y-3">
              {isUnifiedVault && (
                <div className="bg-primary-light/50 border border-primary/15 rounded-xl p-3 text-xs text-text2 flex items-start gap-2">
                  <Icon name="shield" size={14} color="var(--c-primary)" className="flex-shrink-0 mt-0.5" />
                  <p>{t('account.vault.note.a')} <strong>{t('account.vault.note.b')}</strong>{t('account.vault.note.c')}</p>
                </div>
              )}

              <div className="relative">
                <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showCurrentPass ? 'text' : 'password'}
                  value={currentPass}
                  onChange={e => setCurrentPass(e.target.value)}
                  placeholder={t('account.pass.current.placeholder')}
                  className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  dir="ltr"
                  autoFocus
                />
                <button type="button" onClick={() => setShowCurrentPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                  <Icon name={showCurrentPass ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>

              <div>
                <div className="relative">
                  <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    value={newPass}
                    onChange={e => { setNewPass(e.target.value); setShowPassStrength(true) }}
                    placeholder={t('account.pass.new.placeholder')}
                    className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                    dir="ltr"
                  />
                  <button type="button" onClick={() => setShowNewPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                    <Icon name={showNewPass ? 'visibility_off' : 'visibility'} size={16} />
                  </button>
                </div>
                {showPassStrength && newPass.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex gap-1">
                      {[0,1,2,3,4].map(i => (
                        <div key={i} className={`flex-1 h-1.5 rounded-full ${i < pwStrength.score ? pwStrength.color : 'bg-bg'}`} />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${pwStrength.score >= 3 ? 'text-primary' : 'text-warning'}`}>{pwStrength.label}</span>
                      {pwStrength.score >= 3 && <Icon name="verified_user" size={16} color="var(--c-primary)" />}
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                      {pwStrength.checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1 text-xs ${c.ok ? 'text-primary' : 'text-text3'}`}>
                          <Icon name="check" size={12} className="flex-shrink-0" color={c.ok ? 'var(--c-primary)' : 'var(--c-border)'} />
                          {c.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showNewPass2 ? 'text' : 'password'}
                  value={newPass2}
                  onChange={e => setNewPass2(e.target.value)}
                  placeholder={t('account.pass.confirm.placeholder')}
                  className="w-full pr-10 pl-10 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
                  dir="ltr"
                />
                <button type="button" onClick={() => setShowNewPass2(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-text3">
                  <Icon name={showNewPass2 ? 'visibility_off' : 'visibility'} size={16} />
                </button>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={changePassword}
                  disabled={passwordChanging || !currentPass || !newPass || !newPass2}
                  className="flex-1 bg-primary text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {passwordChanging && <Spinner size={16} color="#fff" />}
                  {passwordChanging ? t('account.changing') : isUnifiedVault ? t('account.change.pass.vault') : t('account.change.pass.button')}
                </button>
                <button
                  onClick={() => {
                    setEditPass(false)
                    setCurrentPass(''); setNewPass(''); setNewPass2('')
                    setShowCurrentPass(false); setShowNewPass(false); setShowNewPass2(false); setShowPassStrength(false)
                  }}
                  className="flex-1 bg-bg text-text2 py-2.5 rounded-xl text-sm font-medium"
                >
                  {t('app.cancel')}
                </button>
              </div>
            </div>
          )}
        </Card>

        {/* Logout is a routine action — it no longer sits 1px away from account
            deletion inside a red "danger zone" */}
        <Card>
          <MenuItem
            icon="logout"
            label={t('settings.logout')}
            desc={t('account.logout.desc')}
            onClick={() => setConfirmDialog({
              title: t('settings.logout.confirm.title'),
              onConfirm: () => { setConfirmDialog(null); signOut() },
            })}
          />
        </Card>
        </>)}

        {/* Guest: connect-account CTA instead of password/logout — a guest who
            signs out has no credential to get back to their data, so a regular
            logout is deliberately NOT offered here */}
        {isAnonymous && (
          <Card>
            <MenuItem
              icon="cloud"
              label={t('guest.cta.button')}
              desc={t('guest.cta.subtitle')}
              onClick={() => navigate('/login')}
            />
          </Card>
        )}

        <SL>{t('account.danger.zone')}</SL>
        <div className="bg-error/5 border border-error/20 rounded-card overflow-hidden">
          <MenuItem
            icon="delete"
            label={isAnonymous ? t('guest.reset.title') : t('settings.delete.account')}
            desc={isAnonymous ? t('guest.reset.desc') : t('settings.delete.account.desc')}
            onClick={deletingAccount ? undefined : handleDeleteAccount}
            danger
            right={deletingAccount ? <Icon name="progress_activity" size={20} color="var(--c-error)" className="animate-spin" /> : undefined}
          />
        </div>
      </div>

      <AnimatePresence>
        {confirmDialog && (
          <ConfirmDialog
            title={confirmDialog.title}
            message={confirmDialog.message}
            confirmLabel={confirmDialog.confirmLabel}
            danger
            onConfirm={confirmDialog.onConfirm}
            onCancel={() => setConfirmDialog(null)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
      {showDeleteDialog && (
        <ConfirmDialog
          title={isAnonymous ? t('guest.reset.confirm.title') : t('settings.delete.account')}
          message={isAnonymous ? t('guest.reset.confirm.message') : t('account.delete.confirm.message')}
          confirmLabel={isAnonymous ? t('guest.reset.confirm.cta') : t('account.delete.confirm.cta')}
          danger
          onConfirm={() => {
            if (deleteConfirmText.trim() !== 'מחק') {
              toast.error(t('account.delete.type.required'))
              return
            }
            doDeleteAccount()
          }}
          onCancel={() => setShowDeleteDialog(false)}
        >
          <input
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            placeholder={t('privacy.reset.placeholder')}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-error/40"
            dir="rtl"
          />
        </ConfirmDialog>
      )}
      </AnimatePresence>
    </div>
  )
}
