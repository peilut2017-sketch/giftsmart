import { useState, useMemo } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useVouchers } from '../../contexts/VoucherContext'
import { useE2EE } from '../../contexts/E2EEContext'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
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
  const { user, profile, updateProfile, signOut } = useAuth()
  const { vouchers, archivedVouchers, logAction, updateVoucher } = useVouchers()
  const { isUnifiedVault, isVaultUnlocked, reDeriveVaultKeyFromPassword } = useE2EE()

  const [editName, setEditName] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [phone, setPhone] = useState(profile?.phone || '')
  const [deletingAccount, setDeletingAccount] = useState(false)

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
    await updateProfile({ name, phone })
    setEditName(false)
    toast.success('פרופיל עודכן')
  }

  async function handleDeleteAccount() {
    if (!confirm(t('settings.delete.account.confirm1'))) return
    if (!confirm(t('settings.delete.account.confirm2'))) return
    setDeletingAccount(true)
    try {
      const { error } = await supabase.from('support_messages').insert({
        user_id: user!.id, user_email: user!.email, user_name: profile?.name || null,
        subject: t('settings.delete.account.subject'), body: t('settings.delete.account.body'), category: 'general',
      })
      if (error) throw error
      toast.success(t('settings.delete.account.sent'))
    } catch (e: any) {
      toast.error(e?.message || t('settings.delete.account.error'))
    } finally {
      setDeletingAccount(false)
    }
  }

  async function changePassword() {
    if (!currentPass) return toast.error('הזן את הסיסמה הנוכחית')
    if (newPass !== newPass2) return toast.error('הסיסמאות אינן תואמות')
    if (newPass.length < 8) return toast.error('סיסמה חדשה: לפחות 8 תווים')
    setPasswordChanging(true)
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user!.email!, password: currentPass })
      if (authErr) return toast.error('סיסמה נוכחית שגויה')

      let vaultEntries: Array<{id: string; code: string; cvv: string|null}> = []

      if (isUnifiedVault) {
        if (!isVaultUnlocked) return toast.error('יש לפתוח את הכספת לפני שינוי הסיסמה')
        const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
        const { ok, entries } = await reDeriveVaultKeyFromPassword(newPass, e2eeVouchers)
        if (!ok) return toast.error('שגיאה בעדכון הכספת')
        vaultEntries = entries
      }

      const { error } = await supabase.auth.updateUser({ password: newPass })
      if (error) { toast.error('שגיאה בשינוי סיסמה: ' + error.message); return }

      if (vaultEntries.length > 0) {
        await Promise.all(vaultEntries.map(({ id, code, cvv }) =>
          updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
        ))
      }

      toast.success(isUnifiedVault ? `סיסמה שונתה — ${vaultEntries.length} שוברים הוצפנו מחדש` : 'סיסמה שונתה!')
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
      <SettingsSubHeader title="חשבון" />
      <div className="p-4 space-y-4 pb-10">
        <Card>
          <div className="p-4">
            {!editName ? (
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-primary-light flex items-center justify-center text-lg font-extrabold text-primary shrink-0">
                  {(profile?.name || user?.email || '?').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-text">{profile?.name || 'ללא שם'}</p>
                  <p className="text-xs text-text3 truncate">{user?.email}</p>
                  {phone && <p className="text-xs text-text3">{phone}</p>}
                </div>
                <button onClick={() => setEditName(true)} className="w-9 h-9 rounded-xl bg-bg flex items-center justify-center shrink-0">
                  <Icon name="edit" size={16} color="var(--c-text2)" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="שם מלא" className="h-11 rounded-xl border border-border bg-surface text-text text-base px-3 outline-none focus:ring-2 focus:ring-primary/30" />
                <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="טלפון" dir="ltr" className="h-11 rounded-xl border border-border bg-surface text-text text-base px-3 outline-none focus:ring-2 focus:ring-primary/30" />
                <div className="flex gap-2">
                  <button onClick={saveProfile} className="flex-1 h-10 rounded-xl bg-primary text-white text-sm font-semibold">{t('app.save')}</button>
                  <button onClick={() => setEditName(false)} className="flex-1 h-10 rounded-xl bg-bg text-text2 text-sm font-semibold">{t('app.cancel')}</button>
                </div>
              </div>
            )}
          </div>
        </Card>

        <SL>סיסמה</SL>
        <Card>
          {!editPass ? (
            <MenuItem icon="lock" label="שינוי סיסמה" desc="עדכן את סיסמת הכניסה" onClick={() => setEditPass(true)} />
          ) : (
            <div className="p-4 space-y-3">
              {isUnifiedVault && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-xs text-indigo-800 flex items-start gap-2">
                  <Icon name="shield" size={14} className="flex-shrink-0 mt-0.5" />
                  <p>הכספת מוגנת בסיסמת הכניסה — <strong>הסיסמה החדשה תהיה גם מפתח הכספת</strong> ותצפין מחדש את כל השוברים.</p>
                </div>
              )}

              <div className="relative">
                <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showCurrentPass ? 'text' : 'password'}
                  value={currentPass}
                  onChange={e => setCurrentPass(e.target.value)}
                  placeholder="סיסמה נוכחית"
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
                    placeholder="סיסמה חדשה (לפחות 8 תווים)"
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
                  placeholder="אימות סיסמה חדשה"
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
                  {passwordChanging ? 'משנה...' : isUnifiedVault ? 'שנה סיסמה ועדכן כספת' : 'שנה סיסמה'}
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

        <SL>אזור מסוכן</SL>
        <div className="bg-error/5 border border-error/20 rounded-card overflow-hidden">
          <div className="divide-y divide-error/20">
            <MenuItem
              icon="delete"
              label={t('settings.delete.account')}
              desc={t('settings.delete.account.desc')}
              onClick={handleDeleteAccount}
              danger
              right={deletingAccount ? <Icon name="progress_activity" size={20} color="var(--c-error)" className="animate-spin" /> : undefined}
            />
            <MenuItem icon="logout" label={t('settings.logout')} desc="יציאה מהחשבון" onClick={() => { if (confirm('להתנתק?')) signOut() }} danger />
          </div>
        </div>
      </div>
    </div>
  )
}
