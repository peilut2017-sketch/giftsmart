import { useState, useEffect } from 'react'
import BottomSheet from './ui/BottomSheet'
import Button from './ui/Button'
import Icon from './ui/Icon'
import { useE2EE } from '../contexts/E2EEContext'
import { useAuth } from '../contexts/AuthContext'
import { hasBiometricWrappedVaultKey, isBiometricSupported, isBiometricEnabled } from '../lib/passkey'
import { isVaultPersistEnabled, setVaultPersistEnabled } from '../lib/vaultKeyStore'
import { useT } from '../lib/i18n'

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
  const { t } = useT()
  const { unlockWithPassword, unlockVaultFromRecovery, unlockVaultWithBiometric, hint, passwordWrapStale, doors } = useE2EE()
  const { isAnonymous } = useAuth()
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [phrase, setPhrase] = useState('')
  const [showRecovery, setShowRecovery] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)
  const [stayUnlocked, setStayUnlocked] = useState(() => isVaultPersistEnabled())

  const biometricAvailable = isBiometricSupported() && (hasBiometricWrappedVaultKey() || isBiometricEnabled())
  // Guest/OAuth vaults have no password wrap — their only doors are biometric and
  // the recovery code. Showing the login-password form there is a dead end that
  // reads as "wrong password" forever, so route them straight to recovery.
  const noPasswordDoor = isAnonymous || (doors ? !doors.password : false)

  useEffect(() => {
    if (open) {
      setPassword('')
      setPhrase('')
      setError('')
      setShowRecovery(passwordWrapStale || noPasswordDoor)
    }
  }, [open, passwordWrapStale, noPasswordDoor])

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
      else setError(t('vault.unlock.bio.failed'))
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
      if (status === 'wrong') setError(t('vault.unlock.wrong.password'))
      else if (status === 'stale') {
        setError(t('vault.unlock.stale'))
        setShowRecovery(true)
      } else setError(t('vault.unlock.network.error'))
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
      else setError(t('vault.unlock.recovery.invalid'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={t('vault.unlock.title')}>
      <div className="space-y-4">
        {contextLabel && <p className="text-sm text-text2 -mt-1">{contextLabel}</p>}

        {biometricAvailable && (
          <button
            onClick={handleBiometric}
            disabled={bioBusy}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-gradient-to-br from-primary-mid to-primary-dark text-white font-bold text-[15px] shadow-fab active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            <Icon name="fingerprint" size={22} />
            {bioBusy ? t('vault.unlock.bio.waiting') : t('vault.unlock.bio.button')}
          </button>
        )}

        {!showRecovery ? (
          <form onSubmit={handlePassword} className="space-y-3">
            <div>
              <label htmlFor="vault-pass" className="block text-sm font-medium text-text2 mb-1.5">
                {t('vault.unlock.password.label')}
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
                  aria-label={showPass ? t('auth.hide.password') : t('auth.show.password')}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-text3 p-1"
                >
                  <Icon name={showPass ? 'visibility_off' : 'visibility'} size={18} />
                </button>
              </div>
              {hint && <p className="text-xs text-text3 mt-1.5">{t('vault.hint')}: {hint}</p>}
            </div>

            {error && <p className="text-sm text-error leading-relaxed" role="alert">{error}</p>}

            <Button type="submit" fullWidth disabled={!password || busy} loading={busy}>
              {t('e2ee.unlock')}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleRecovery} className="space-y-3">
            <div>
              <label htmlFor="vault-recovery" className="block text-sm font-medium text-text2 mb-1.5">
                {t('vault.unlock.recovery.label')}
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
              {t('vault.unlock.recovery.button')}
            </Button>
          </form>
        )}

        <div className="flex items-center justify-between gap-2">
          {showRecovery && noPasswordDoor ? (
            <span />
          ) : (
            <button
              type="button"
              onClick={() => { setShowRecovery(v => !v); setError('') }}
              className="text-sm text-primary font-medium py-2"
            >
              {showRecovery ? t('vault.unlock.back.password') : t('vault.unlock.have.recovery')}
            </button>
          )}

          <label className="flex items-center gap-2 text-sm text-text2 py-2 cursor-pointer">
            <input
              type="checkbox"
              checked={stayUnlocked}
              onChange={e => persistPref(e.target.checked)}
              className="w-4 h-4 accent-[var(--c-primary)]"
            />
            {t('vault.unlock.stay')}
          </label>
        </div>
      </div>
    </BottomSheet>
  )
}
