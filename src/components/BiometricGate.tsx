import { useState, useEffect, useRef } from 'react'
import { verifyBiometricForVaultUnlock, disableBiometric, disableBiometricLocally, isBiometricNative, getBiometricEmail } from '../lib/passkey'
import { exportVaultKey } from '../lib/e2ee'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'
import Icon from './ui/Icon'
import Button from './ui/Button'

const SESSION_KEY_V2    = 'gs_e2ee_key_v2'
const VAULT_PW_PENDING  = 'gs_vault_pw_pending'
const CHECK_KEY         = 'gs_e2ee_chk'
const VAULT_V2_FLAG     = 'gs_e2ee_v2'

interface Props {
  onUnlock: () => void
  onSignOut: () => void
}

function GateShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-4" style={{ background: 'linear-gradient(135deg, var(--c-primary-light), var(--c-bg) 60%)' }}>
      <div className="w-full max-w-sm bg-surface rounded-[28px] shadow-fab p-8 text-center">
        {children}
      </div>
      <div className="flex items-center gap-2 mt-4 text-xs text-text3">
        <Icon name="shield" size={16} />
        <span>מוגן על ידי WebAuthn / Passkey</span>
      </div>
    </div>
  )
}

export default function BiometricGate({ onUnlock, onSignOut }: Props) {
  const { signIn } = useAuth()
  const [step, setStep] = useState<'biometric' | 'vault'>('biometric')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [vaultPass, setVaultPass] = useState('')
  const [showVaultPass, setShowVaultPass] = useState(false)
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
      if (!authenticated) { setFailed(true); toast.error('אימות ביומטרי נכשל'); return }

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

  function handleVaultUnlock() {
    if (!vaultPass) return
    // E2EEProvider reads this on mount (Path 2 in auto-unlock)
    sessionStorage.setItem(VAULT_PW_PENDING, vaultPass)
    onUnlock()
  }

  async function handlePasswordFallback() {
    if (!fallbackEmail || !fallbackPassword) return
    setFallbackLoading(true); setFallbackError('')
    try {
      const { error } = await signIn(fallbackEmail, fallbackPassword)
      if (error) {
        setFallbackError('אימייל או סיסמה שגויים')
        return
      }
      // Store password so E2EEProvider can derive/unlock the vault
      sessionStorage.setItem(VAULT_PW_PENDING, fallbackPassword)
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
      setFallbackError('שגיאה בהתחברות — נסה שוב')
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
        <h2 className="text-xl font-bold text-text mb-2">פתח את הכספת</h2>
        <p className="text-sm text-text3 mb-6">
          הזן את סיסמת הכניסה שלך כדי לפתוח את הכספת המוצפנת
        </p>

        <div className="relative mb-3">
          <Icon name="lock" size={16} color="var(--c-text3)" className="absolute right-3 top-1/2 -translate-y-1/2" />
          <input
            type={showVaultPass ? 'text' : 'password'}
            placeholder="סיסמת כניסה"
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

        <Button onClick={handleVaultUnlock} disabled={!vaultPass} fullWidth className="mb-3">
          פתח כספת
        </Button>
        <button onClick={onUnlock} className="w-full text-sm text-text3 py-2">
          דלג — פתח כספת מאוחר יותר
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
        <h2 className="text-xl font-bold text-text mb-1">כניסה עם סיסמה</h2>
        <p className="text-sm text-text3 mb-6">
          {biometricNative
            ? 'הזן את פרטי הכניסה שלך — הזיהוי הביומטרי יאופס במכשיר זה'
            : 'הזן את פרטי הכניסה שלך כדי להיכנס ללא ביומטרי'}
        </p>

        <div className="space-y-3 mb-4">
          <input
            type="email"
            placeholder="אימייל"
            value={fallbackEmail}
            onChange={e => setFallbackEmail(e.target.value)}
            className="w-full px-4 py-3 border border-border rounded-2xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
            dir="ltr"
            autoComplete="email"
          />
          <div className="relative">
            <input
              type={showFallbackPass ? 'text' : 'password'}
              placeholder="סיסמה"
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
          כניסה
        </Button>
        <button onClick={() => setShowPasswordFallback(false)} className="w-full text-sm text-text3 py-2">
          חזרה לזיהוי ביומטרי
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

      <h2 className="text-xl font-bold text-text mb-2">אימות ביומטרי</h2>
      <p className="text-sm text-text3 mb-6">
        {loading ? 'ממתין לאימות...' : failed ? 'האימות נכשל. נסה שוב.' : 'השתמש בזיהוי פנים או טביעת אצבע כדי להיכנס'}
      </p>

      <Button onClick={handleVerify} disabled={loading} loading={loading} fullWidth className="mb-3">
        אמת זהות
      </Button>

      {failed && (
        <button
          onClick={() => setShowPasswordFallback(true)}
          className="w-full bg-bg text-text2 py-3 rounded-2xl font-medium text-sm mb-2 flex items-center justify-center gap-2"
        >
          <Icon name="key" size={16} />
          כניסה עם סיסמה במקום
        </button>
      )}

      <button onClick={onSignOut} className="w-full text-sm text-error py-2">
        יציאה מהחשבון
      </button>
    </GateShell>
  )
}
