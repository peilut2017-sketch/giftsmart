import { useState } from 'react'
import BottomSheet from './ui/BottomSheet'
import Button from './ui/Button'
import Icon from './ui/Icon'
import { useE2EE } from '../contexts/E2EEContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { isBiometricSupported } from '../lib/passkey'

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
  const { setupVaultFromPassword, setupVaultWithMasterKey } = useE2EE()
  const { user, profile } = useAuth()
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [oauthNoPasskey, setOauthNoPasskey] = useState(false)

  const provider = user?.app_metadata?.provider
  const isOAuth = !!provider && provider !== 'email'
  const canPasskey = isBiometricSupported()

  function succeed() {
    onDone?.()
    onClose()
  }

  // ── Email flow: verify the password IS the login password, then create ────
  async function handleEmailSetup(e?: React.FormEvent) {
    e?.preventDefault()
    if (!password || busy || !user?.id || !user.email) return
    setBusy(true)
    setError('')
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: user.email, password })
      if (authErr) {
        setError('זו אינה סיסמת הכניסה שלך — הכספת חייבת להיפתח עם אותה סיסמה שאיתה אתה מתחבר')
        return
      }
      await setupVaultFromPassword(password, user.id)
      succeed()
    } catch (err) {
      if (err instanceof Error && err.message === 'vault-exists-password-mismatch') {
        setError('כבר קיימת כספת לחשבון הזה אך הסיסמה אינה פותחת אותה — נסה קוד שחזור מהגדרות ← פרטיות')
      } else {
        setError('שגיאה ביצירת הכספת — נסה שוב')
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
        setError('הרשמת טביעת האצבע לא הושלמה — אפשר לנסות שוב או להמשיך עם קוד שחזור בלבד')
        setOauthNoPasskey(true)
      } else {
        setError('שגיאה ביצירת הכספת — נסה שוב')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="הצפנת הקודים שלך" dismissible={!blocking}>
      <div className="space-y-4">
        <div className="flex items-start gap-3 bg-primary-light/50 border border-primary/15 rounded-2xl p-3.5">
          <Icon name="lock" size={20} color="var(--c-primary)" />
          <p className="text-sm text-text2 leading-relaxed">
            קודי השוברים יוצפנו כך שרק אתה יכול לקרוא אותם — גם אנחנו לא.
            {' '}תקבל <b>קוד שחזור</b> שפותח את הכספת מכל מכשיר.
          </p>
        </div>

        {!isOAuth ? (
          <form onSubmit={handleEmailSetup} className="space-y-3">
            <div>
              <label htmlFor="setup-pass" className="block text-sm font-medium text-text2 mb-1.5">
                סיסמת הכניסה שלך (בלי סיסמה נוספת לזכור)
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
                  aria-label={showPass ? 'הסתר סיסמה' : 'הצג סיסמה'}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-text3 p-1"
                >
                  <Icon name={showPass ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}

            <Button type="submit" fullWidth disabled={!password || busy} loading={busy}>
              הפעל הצפנה
            </Button>
          </form>
        ) : (
          <div className="space-y-3">
            {canPasskey && !oauthNoPasskey ? (
              <>
                <p className="text-sm text-text2">
                  נכנסת דרך {provider === 'google' ? 'Google' : provider} — הכספת שלך תיפתח עם <b>טביעת אצבע או זיהוי פנים</b>, בלי שום סיסמה.
                </p>
                {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}
                <Button onClick={() => handleOAuthSetup(true)} fullWidth disabled={busy} loading={busy}>
                  <span className="inline-flex items-center gap-2"><Icon name="fingerprint" size={20} /> צור כספת עם טביעת אצבע</span>
                </Button>
                <button
                  onClick={() => setOauthNoPasskey(true)}
                  className="w-full text-sm text-text3 py-2"
                >
                  אין לי אפשרות ביומטרית במכשיר הזה
                </button>
              </>
            ) : (
              <>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 text-right">
                  <Icon name="warning" size={18} color="var(--c-warning)" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    ללא טביעת אצבע, <b>קוד השחזור יהיה הדרך היחידה</b> לפתוח את הכספת.
                    אם יאבד — הקודים המוצפנים יאבדו לצמיתות. שמור אותו היטב.
                  </p>
                </div>
                {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}
                <Button onClick={() => handleOAuthSetup(false)} fullWidth disabled={busy} loading={busy}>
                  צור כספת עם קוד שחזור בלבד
                </Button>
                {canPasskey && (
                  <button onClick={() => { setOauthNoPasskey(false); setError('') }} className="w-full text-sm text-primary font-medium py-2">
                    בעצם — נסה טביעת אצבע
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {blocking && (
          <button onClick={onClose} className="w-full text-sm text-text3 py-1">
            לא עכשיו — אפשר להפעיל בכל רגע מהגדרות ← פרטיות
          </button>
        )}
      </div>
    </BottomSheet>
  )
}
