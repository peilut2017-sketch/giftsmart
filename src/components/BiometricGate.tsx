import { useState, useEffect, useRef } from 'react'
import { verifyBiometricForVaultUnlock, disableBiometric, disableBiometricLocally, isBiometricNative, getBiometricEmail } from '../lib/passkey'
import { exportVaultKey } from '../lib/e2ee'
import { attemptVaultUnlockAtLogin } from '../lib/vaultBundle'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { useT } from '../lib/i18n'
import toast from 'react-hot-toast'
import Icon from './ui/Icon'
import Button from './ui/Button'

const SESSION_KEY_V2    = 'gs_e2ee_key_v2'
const CHECK_KEY         = 'gs_e2ee_chk'
const VAULT_V2_FLAG     = 'gs_e2ee_v2'

interface Props {
  onUnlock: () => void
  onSignOut: () => void
}

function GateShell({ children }: { children: React.ReactNode }) {
  const { t } = useT()
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, var(--c-primary-light), var(--c-bg) 60%)' }}>
      <div className="w-full max-w-sm bg-surface rounded-[28px] shadow-fab p-8 text-center">
        {children}
      </div>
      <div className="flex items-center gap-2 mt-4 text-xs text-text3">
        <Icon name="shield" size={16} />
        <span>{t('gate.protected.by')}</span>
      </div>
    </div>
  )
}

export default function BiometricGate({ onUnlock, onSignOut }: Props) {
  const { t } = useT()
  const { signIn, user } = useAuth()
  const [step, setStep] = useState<'biometric' | 'vault'>('biometric')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [vaultPass, setVaultPass] = useState('')
  const [showVaultPass, setShowVaultPass] = useState(false)
  const [vaultUnlocking, setVaultUnlocking] = useState(false)
  const [vaultError, setVaultError] = useState('')
  // Password fallback (when biometric credential is missing/broken)
  const [showPasswordFallback, setShowPasswordFallback] = useState(false)
  const [fallbackEmail, setFallbackEmail] = useState(() => getBiometricEmail() ?? '')
  const [fallbackPassword, setFallbackPassword] = useState('')
  const [showFallbackPass, setShowFallbackPass] = useState(false)
  const [fallbackError, setFallbackError] = useState('')
  const [fallbackLoading, setFallbackLoading] = useState(false)
  const biometricNative = isBiometricNative()
  const isMountedRef = useRef(true)

  useEffect(() => {
    handleVerify()
    return () => { isMountedRef.current = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleVerify() {
    if (loading) return
    if (isMountedRef.current) { setLoading(true); setFailed(false) }
    try {
      const { authenticated, vaultKey, prfBytes } = await verifyBiometricForVaultUnlock()
      if (!isMountedRef.current) return
      if (!authenticated) { setFailed(true); toast.error(t('auth.biometric.failed')); return }

      if (vaultKey) {
        // PRF yielded the vault key — stash it so E2EEProvider auto-unlocks on mount
        try {
          const exported = await exportVaultKey(vaultKey)
          sessionStorage.setItem(SESSION_KEY_V2, exported)
        } catch {}
        onUnlock()
        return
      }

      // PRF bytes available but no stored wrapped key yet — stash them so that after
      // the user enters their vault password, E2EEContext wraps + stores the key for
      // automatic PRF unlocks on future app launches (self-healing biometric setup).
      if (prfBytes) {
        try {
          const str = Array.from(prfBytes).map(b => String.fromCharCode(b)).join('')
          sessionStorage.setItem('gs_biometric_prf_pending', btoa(str))
        } catch {}
      }

      // Biometric authenticated but no vault key from PRF.
      // For v2 unified vaults, offer to unlock via login password so the
      // vault opens without requiring a separate step inside the app.
      const hasVault = !!localStorage.getItem(CHECK_KEY)
      const isV2     = localStorage.getItem(VAULT_V2_FLAG) === 'true'
      if (hasVault && isV2) {
        setStep('vault')
      } else {
        // v1 vault or no vault — just open the UI gate; vault unlocks from within app
        onUnlock()
      }
    } catch {
      if (isMountedRef.current) setFailed(true)
    } finally {
      if (isMountedRef.current) setLoading(false)
    }
  }

  // Verifies the password actually opens the vault BEFORE letting the user in —
  // v2 stored it unverified and a typo produced a session with a silently locked
  // vault and zero feedback.
  async function handleVaultUnlock() {
    if (!vaultPass || vaultUnlocking) return
    const uid = user?.id
    if (!uid) { onUnlock(); return }
    setVaultUnlocking(true)
    setVaultError('')
    try {
      const result = await attemptVaultUnlockAtLogin(vaultPass, uid)
      if (result === 'unlocked' || result === 'no-vault') {
        onUnlock()
        return
      }
      if (result === 'stale') {
        // The password may simply be wrong — check it against auth before claiming
        // the wrap is stale.
        let authOk = false
        if (user?.email) {
          try {
            const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: vaultPass })
            authOk = !error
          } catch {}
        }
        if (!authOk) {
          // Just a wrong password — don't leave the "stale wrap" flag set
          sessionStorage.removeItem('gs_vault_pw_stale')
          setVaultError(t('gate.wrong.password'))
        } else {
          setVaultError(t('gate.stale.password'))
        }
        return
      }
      setVaultError(t('gate.network.error'))
    } finally {
      setVaultUnlocking(false)
    }
  }

  async function handlePasswordFallback() {
    if (!fallbackEmail || !fallbackPassword) return
    setFallbackLoading(true); setFallbackError('')
    try {
      const { error } = await signIn(fallbackEmail, fallbackPassword)
      if (error) {
        setFallbackError(t('auth.invalid.credentials'))
        return
      }
      // Open the vault right here (password stays in this local variable — the old
      // flow parked the plaintext in sessionStorage for the provider to consume)
      const { data } = await supabase.auth.getSession()
      const uid = data.session?.user?.id
      if (uid) await attemptVaultUnlockAtLogin(fallbackPassword, uid)
      // If the credential was registered natively on this device but is now broken →
      // disable globally (Supabase included). If it was only synced here from Supabase
      // (no private key on this device), clear only local storage so the credential
      // keeps working on the device where it was originally set up.
      if (isBiometricNative()) {
        disableBiometric()
      } else {
        disableBiometricLocally()
      }
      onUnlock()
    } catch {
      setFallbackError(t('gate.signin.error'))
    } finally {
      setFallbackLoading(false)
    }
  }

  // ── Vault unlock step ────────────────────────────────────────────────────
  if (step === 'vault') {
    return (
      <GateShell>
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-fab bg-gradient-to-br from-primary-mid to-primary-dark">
          <Icon name="lock" size={36} color="#fff" />
        </div>
        <h2 className="text-xl font-bold text-text mb-2">{t('gate.vault.title')}</h2>
        <p className="text-sm text-text3 mb-6">
          {t('gate.vault.subtitle')}
        </p>

        <div className="relative mb-3">
          <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type={showVaultPass ? 'text' : 'password'}
            placeholder={t('gate.vault.placeholder')}
            value={vaultPass}
            onChange={e => setVaultPass(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleVaultUnlock()}
            className="w-full pr-10 pl-10 py-3 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            dir="ltr"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowVaultPass(v => !v)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-text3"
          >
            <Icon name={showVaultPass ? 'visibility_off' : 'visibility'} size={16} />
          </button>
        </div>

        {vaultError && <p className="text-xs text-error mb-3 text-right leading-relaxed">{vaultError}</p>}

        <Button onClick={handleVaultUnlock} disabled={!vaultPass || vaultUnlocking} loading={vaultUnlocking} fullWidth className="mb-3">
          {t('e2ee.unlock')}
        </Button>
        <button onClick={onUnlock} className="w-full text-sm text-text3 py-2">
          {t('gate.vault.skip')}
        </button>
      </GateShell>
    )
  }

  // ── Password fallback (broken/missing credential) ───────────────────────
  if (showPasswordFallback) {
    return (
      <GateShell>
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-fab bg-gradient-to-br from-primary-mid to-primary-dark">
          <Icon name="key" size={36} color="#fff" />
        </div>
        <h2 className="text-xl font-bold text-text mb-1">{t('auth.use.password')}</h2>
        <p className="text-sm text-text3 mb-6">
          {biometricNative
            ? t('gate.fallback.native')
            : t('gate.fallback.synced')}
        </p>

        <div className="space-y-3 mb-4">
          <input
            type="email"
            placeholder={t('auth.email')}
            value={fallbackEmail}
            onChange={e => setFallbackEmail(e.target.value)}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            dir="ltr"
            autoComplete="email"
          />
          <div className="relative">
            <input
              type={showFallbackPass ? 'text' : 'password'}
              placeholder={t('auth.password.placeholder')}
              value={fallbackPassword}
              onChange={e => setFallbackPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handlePasswordFallback()}
              className="w-full px-4 py-3 pl-10 border border-border rounded-2xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              dir="ltr"
              autoComplete="current-password"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowFallbackPass(v => !v)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text3"
            >
              <Icon name={showFallbackPass ? 'visibility_off' : 'visibility'} size={16} />
            </button>
          </div>
        </div>

        {fallbackError && <p className="text-xs text-error mb-3">{fallbackError}</p>}

        <Button onClick={handlePasswordFallback} disabled={fallbackLoading || !fallbackEmail || !fallbackPassword} loading={fallbackLoading} fullWidth className="mb-3">
          {t('auth.login.tab')}
        </Button>
        <button onClick={() => setShowPasswordFallback(false)} className="w-full text-sm text-text3 py-2">
          {t('gate.back.biometric')}
        </button>
      </GateShell>
    )
  }

  // ── Biometric step ───────────────────────────────────────────────────────
  return (
    <GateShell>
      <div className={`inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-fab ${failed ? 'bg-error' : 'bg-gradient-to-br from-primary-mid to-primary-dark'}`}>
        {failed
          ? <Icon name="close" size={36} color="#fff" />
          : loading
            ? <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
            : <Icon name="fingerprint" size={36} color="#fff" />
        }
      </div>

      <h2 className="text-xl font-bold text-text mb-2">{t('gate.title')}</h2>
      <p className="text-sm text-text3 mb-6">
        {loading ? t('auth.biometric.waiting') : failed ? t('gate.failed') : t('gate.prompt')}
      </p>

      <Button onClick={handleVerify} disabled={loading} loading={loading} fullWidth className="mb-3">
        {t('auth.biometric.verify')}
      </Button>

      {failed && (
        <button
          onClick={() => setShowPasswordFallback(true)}
          className="w-full bg-bg text-text2 py-3 rounded-2xl font-medium text-sm mb-2 flex items-center justify-center gap-2"
        >
          <Icon name="key" size={16} />
          {t('gate.use.password.instead')}
        </button>
      )}

      <button onClick={onSignOut} className="w-full text-sm text-error py-2">
        {t('gate.sign.out')}
      </button>
    </GateShell>
  )
}
