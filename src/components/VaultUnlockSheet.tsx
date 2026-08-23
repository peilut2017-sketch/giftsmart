import { useState, useEffect } from 'react'
import BottomSheet from './ui/BottomSheet'
import Button from './ui/Button'
import Icon from './ui/Icon'
import { useE2EE } from '../contexts/E2EEContext'
import { hasBiometricWrappedVaultKey, isBiometricSupported, isBiometricEnabled } from '../lib/passkey'
import { isVaultPersistEnabled, setVaultPersistEnabled } from '../lib/vaultKeyStore'

interface Props {
  open: boolean
  onClose: () => void
  /** Fired after a successful unlock, before the sheet closes. */
  onUnlocked?: () => void
  /** Optional context line, e.g. "כדי להציג את הקוד של H&M". */
  contextLabel?: string
}

/**
 * The single vault-unlock surface for the whole app: biometric (when available),
 * login password, and a recovery-code fallback — replacing the three divergent
 * hand-rolled unlock modals (HomePage / VoucherForm / BiometricGate vault step),
 * which each supported a different subset of unlock methods.
 */
export default function VaultUnlockSheet({ open, onClose, onUnlocked, contextLabel }: Props) {
  const { unlockWithPassword, unlockVaultFromRecovery, unlockVaultWithBiometric, hint, passwordWrapStale } = useE2EE()
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const [stayUnlocked, setStayUnlocked] = useState(() => isVaultPersistEnabled())

  const biometricAvailable = isBiometricSupported() && (hasBiometricWrappedVaultKey() || isBiometricEnabled())

  useEffect(() => {
    if (open) {
      setPassword('')
      setPhrase('')
      setError('')
      setShowRecovery(passwordWrapStale)
    }
  }, [open, passwordWrapStale])

  function persistPref(next: boolean) {
    setStayUnlocked(next)
    setVaultPersistEnabled(next)
  }

  function succeed() {
    onUnlocked?.()
    onClose()
  }

  async function handleBiometric() {
    if (bioBusy) return
    setBioBusy(true)
    setError('')
    try {
      const ok = await unlockVaultWithBiometric()
      if (ok) succeed()
      else setError('הזיהוי הביומטרי לא הצליח — נסה סיסמה')
    } finally {
      setBioBusy(false)
    }
  }

  async function handlePassword(e?: React.FormEvent) {
    e?.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      const status = await unlockWithPassword(password)
      if (status === 'ok' || status === 'no-vault') { succeed(); return }
      if (status === 'wrong') setError('הסיסמה שגויה — נסה שוב')
      else if (status === 'stale') {
        setError('הסיסמה שלך התחדשה לאחרונה ולכן אינה פותחת עדיין את הכספת. פתח פעם אחת עם טביעת אצבע או קוד שחזור — והיא תתחבר מחדש אוטומטית.')
        setShowRecovery(true)
      } else setError('שגיאת רשת — בדוק את החיבור ונסה שוב')
    } finally {
      setBusy(false)
    }
  }

  async function handleRecovery(e?: React.FormEvent) {
    e?.preventDefault()
    if (!phrase.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const ok = await unlockVaultFromRecovery(phrase.trim())
      if (ok) succeed()
      else setError('קוד השחזור אינו תקין — בדוק שהקלדת את כל 24 התווים')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="פתיחת הכספת">
      <div className="space-y-4">
        {contextLabel && <p className="text-sm text-text2 -mt-1">{contextLabel}</p>}

        {biometricAvailable && (
          <button
            onClick={handleBiometric}
            disabled={bioBusy}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-br from-primary-mid to-primary-dark text-white font-bold text-[15px] shadow-fab active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <Icon name="fingerprint" size={22} />
            {bioBusy ? 'ממתין לאימות…' : 'פתח עם טביעת אצבע'}
          </button>
        )}

        {!showRecovery ? (
          <form onSubmit={handlePassword} className="space-y-3">
            <div>
              <label htmlFor="vault-pass" className="block text-sm font-medium text-text2 mb-1.5">
                סיסמת הכניסה שלך
              </label>
              <div className="relative">
                <input
                  id="vault-pass"
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError('') }}
                  className="w-full ps-4 pe-11 py-3 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
                  dir="ltr"
                  autoComplete="current-password"
                  autoFocus={!biometricAvailable}
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
              {hint && <p className="text-xs text-text3 mt-1.5">רמז: {hint}</p>}
            </div>

            {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}

            <Button type="submit" fullWidth disabled={!password || busy} loading={busy}>
              פתח כספת
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRecovery} className="space-y-3">
            <div>
              <label htmlFor="vault-recovery" className="block text-sm font-medium text-text2 mb-1.5">
                קוד שחזור (XXXX-XXXX-…)
              </label>
              <input
                id="vault-recovery"
                type="text"
                value={phrase}
                onChange={e => { setPhrase(e.target.value); setError('') }}
                className="w-full px-4 py-3 border border-border rounded-2xl text-base bg-surface text-text font-mono tracking-wide focus:outline-none focus:ring-2 focus:ring-primary/40"
                dir="ltr"
                autoCapitalize="characters"
                autoComplete="off"
                autoFocus
              />
            </div>

            {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}

            <Button type="submit" fullWidth disabled={!phrase.trim() || busy} loading={busy}>
              פתח עם קוד שחזור
            </Button>
          </form>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => { setShowRecovery(v => !v); setError('') }}
            className="text-sm text-primary font-medium py-2"
          >
            {showRecovery ? 'חזרה לפתיחה עם סיסמה' : 'יש לי קוד שחזור'}
          </button>

          <label className="flex items-center gap-2 text-sm text-text2 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={stayUnlocked}
              onChange={e => persistPref(e.target.checked)}
              className="w-4 h-4 accent-[var(--c-primary)]"
            />
            השאר פתוח במכשיר זה
          </label>
        </div>
      </div>
    </BottomSheet>
  )
}
