import { useState } from 'react'
import BottomSheet from './ui/BottomSheet'
import Button from './ui/Button'
import Icon from './ui/Icon'
import { useE2EE } from '../contexts/E2EEContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { isBiometricSupported } from '../lib/passkey'
import { useT } from '../lib/i18n'

interface Props {
  open: boolean
  onClose: () => void
  /** Fired after the vault is created and unlocked (before the recovery modal shows). */
  onDone?: () => void
  /** When true the sheet can't be dismissed without a decision (first-run OAuth prompt). */
  blocking?: boolean
}

/**
 * Unified vault creation for both account types — replaces OAuthVaultSetupPrompt
 * and the inline setup block inside VoucherForm, which had different password
 * rules (8 vs 6 chars), no shared warning, and — critically for email users — no
 * verification that the typed string is the real login password (a mismatch
 * silently locked the vault forever on the next login).
 *
 * Email users:  the vault opens with the login password (verified via re-auth).
 * OAuth users:  passkey (PRF) is the primary door; recovery code is the safety net.
 */
export default function VaultSetupSheet({ open, onClose, onDone, blocking = false }: Props) {
  const { t } = useT()
  const { setupVaultFromPassword, setupVaultWithMasterKey } = useE2EE()
  const { user, profile, isAnonymous } = useAuth()
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthNoPasskey, setOauthNoPasskey] = useState(false)

  const provider = user?.app_metadata?.provider
  // Guests MUST take the no-password (master key + passkey/recovery) path:
  // branching on is_anonymous, not on provider metadata — a guest's provider
  // field isn't reliably 'anonymous', and landing them on the email/password
  // branch dead-ends silently (no login password exists to verify).
  const isOAuth = isAnonymous || (!!provider && provider !== 'email')
  const canPasskey = isBiometricSupported()

  function succeed() {
    onDone?.()
    onClose()
  }

  // ── Email flow: verify the password IS the login password, then create ────
  async function handleEmailSetup(e?: React.FormEvent) {
    e?.preventDefault()
    if (!password || busy || !user?.id) return
    // Never fail silently: anyone without a login email cannot take this path
    if (!user.email) { setError(t('vault.setup.error')); return }
    setBusy(true)
    setError('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password })
      if (authErr) {
        setError(t('vault.setup.not.login.password'))
        return
      }
      await setupVaultFromPassword(password, user.id)
      succeed()
    } catch (err) {
      if (err instanceof Error && err.message === 'vault-exists-password-mismatch') {
        setError(t('vault.setup.exists.mismatch'))
      } else {
        setError(t('vault.setup.error'))
      }
    } finally {
      setBusy(false)
    }
  }

  // ── OAuth flow: passkey first, recovery-only as explicit fallback ─────────
  async function handleOAuthSetup(withPasskey: boolean) {
    if (busy || !user?.id) return
    setBusy(true)
    setError('')
    try {
      await setupVaultWithMasterKey(withPasskey
        ? { registerBiometric: { userName: profile?.name || user.email || 'GiftSmart', email: user.email ?? undefined } }
        : undefined)
      succeed()
    } catch {
      if (withPasskey) {
        setError(t('vault.setup.passkey.failed'))
        setOauthNoPasskey(true)
      } else {
        setError(t('vault.setup.error'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('vault.setup.title')} dismissible={!blocking}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-primary-light/50 border border-primary/15 rounded-2xl p-3.5">
          <Icon name="lock" size={20} color="var(--c-primary)" />
          <p className="text-sm text-text2 leading-relaxed">
            {t('vault.setup.intro')}
            {' '}{t('vault.setup.intro.receive')} <b>{t('vault.setup.intro.recovery')}</b> {t('vault.setup.intro.opens')}
          </p>
        </div>

        {!isOAuth ? (
          <form onSubmit={handleEmailSetup} className="space-y-3">
            <div>
              <label htmlFor="setup-pass" className="block text-sm font-medium text-text2 mb-1.5">
                {t('vault.setup.password.label')}
              </label>
              <div className="relative">
                <input
                  id="setup-pass"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  className="w-full ps-4 pe-11 py-3 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
                  dir="ltr"
                  autoComplete="current-password"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  aria-label={showPass ? t('auth.hide.password') : t('auth.show.password')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-text3 p-1"
                >
                  <Icon name={showPass ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}

            <Button type="submit" fullWidth disabled={!password || busy} loading={busy}>
              {t('vault.setup.enable')}
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            {canPasskey && !oauthNoPasskey ? (
              <>
                <p className="text-sm text-text2">
                  {isAnonymous || provider === 'anonymous'
                    ? t('vault.setup.guest.intro')
                    : t('vault.setup.oauth.intro', { provider: provider === 'google' ? 'Google' : String(provider) })}
                  {' '}<b>{t('vault.setup.oauth.bio')}</b>{t('vault.setup.oauth.nopass')}
                </p>
                {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}
                <Button onClick={() => handleOAuthSetup(true)} fullWidth disabled={busy} loading={busy}>
                  <span className="inline-flex items-center gap-2"><Icon name="fingerprint" size={20} /> {t('vault.setup.create.bio')}</span>
                </Button>
                <button
                  onClick={() => setOauthNoPasskey(true)}
                  className="w-full text-sm text-text3 py-2"
                >
                  {t('vault.setup.no.bio')}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-right">
                  <Icon name="warning" size={18} color="var(--c-warning)" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    {t('vault.setup.warn.pre')} <b>{t('vault.setup.warn.bold')}</b> {t('vault.setup.warn.post')}
                  </p>
                </div>
                {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}
                <Button onClick={() => handleOAuthSetup(false)} fullWidth disabled={busy} loading={busy}>
                  {t('vault.setup.create.recovery')}
                </Button>
                {canPasskey && (
                  <button onClick={() => { setOauthNoPasskey(false); setError('') }} className="w-full text-sm text-primary font-medium py-2">
                    {t('vault.setup.try.bio')}
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {blocking && (
          <button onClick={onClose} className="w-full text-sm text-text3 py-1">
            {t('vault.setup.not.now')}
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
