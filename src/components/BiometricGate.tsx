import { useState, useEffect, useRef } from 'react'
import { Fingerprint, ShieldCheck, X, Lock, Eye, EyeOff } from 'lucide-react'
import { verifyBiometricForVaultUnlock } from '../lib/passkey'
import { exportVaultKey } from '../lib/e2ee'
import toast from 'react-hot-toast'

const SESSION_KEY_V2    = 'gs_e2ee_key_v2'
const VAULT_PW_PENDING  = 'gs_vault_pw_pending'
const CHECK_KEY         = 'gs_e2ee_chk'
const VAULT_V2_FLAG     = 'gs_e2ee_v2'

interface Props {
  onUnlock: () => void
  onSignOut: () => void
}

export default function BiometricGate({ onUnlock, onSignOut }: Props) {
  const [step, setStep] = useState<'biometric' | 'vault'>('biometric')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [vaultPass, setVaultPass] = useState('')
  const [showVaultPass, setShowVaultPass] = useState(false)
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

  // ── Vault unlock step ────────────────────────────────────────────────────
  if (step === 'vault') {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 text-center">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-lg bg-gradient-to-br from-indigo-400 to-indigo-600">
            <Lock className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">פתח את הכספת</h2>
          <p className="text-sm text-gray-500 mb-6">
            הזן את סיסמת הכניסה שלך כדי לפתוח את הכספת המוצפנת
          </p>

          <div className="relative mb-3">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showVaultPass ? 'text' : 'password'}
              placeholder="סיסמת כניסה"
              value={vaultPass}
              onChange={e => setVaultPass(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleVaultUnlock()}
              className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"
              dir="ltr"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowVaultPass(v => !v)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {showVaultPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            onClick={handleVaultUnlock}
            disabled={!vaultPass}
            className="w-full bg-gradient-to-r from-indigo-500 to-indigo-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-50 mb-3"
          >
            פתח כספת
          </button>
          <button
            onClick={onUnlock}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-2"
          >
            דלג — פתח כספת מאוחר יותר
          </button>
        </div>

        <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
          <ShieldCheck className="w-4 h-4" />
          <span>מוגן על ידי WebAuthn / Passkey</span>
        </div>
      </div>
    )
  }

  // ── Biometric step ───────────────────────────────────────────────────────
  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className={`inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-lg ${failed ? 'bg-gradient-to-br from-red-400 to-red-600' : 'bg-gradient-to-br from-green-400 to-emerald-600'}`}>
          {failed
            ? <X className="w-10 h-10 text-white" />
            : loading
              ? <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              : <Fingerprint className="w-10 h-10 text-white" />
          }
        </div>

        <h2 className="text-xl font-bold text-gray-800 mb-2">אימות ביומטרי</h2>
        <p className="text-sm text-gray-500 mb-6">
          {loading ? 'ממתין לאימות...' : failed ? 'האימות נכשל. נסה שוב.' : 'השתמש בזיהוי פנים או טביעת אצבע כדי להיכנס'}
        </p>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-50 mb-3"
        >
          {loading ? 'מאמת...' : 'אמת זהות'}
        </button>

        <button
          onClick={onSignOut}
          className="w-full text-sm text-red-400 hover:text-red-600 py-2"
        >
          יציאה מהחשבון
        </button>
      </div>

      <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
        <ShieldCheck className="w-4 h-4" />
        <span>מוגן על ידי WebAuthn / Passkey</span>
      </div>
    </div>
  )
}
