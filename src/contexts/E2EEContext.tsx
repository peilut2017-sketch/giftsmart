import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { track } from '@vercel/analytics'
import { phCapture } from '../lib/posthog'
import {
  deriveKey,
  deriveVaultKey,
  exportVaultKey,
  importVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  deriveRecoveryWrapKey,
  generateRecoverySecret,
  encryptField,
  decryptField,
  isEncryptedField,
  generateSalt,
  saltToB64,
  saltFromB64,
} from '../lib/e2ee'
import { registerBiometricWithVault, hasBiometricWrappedVaultKey } from '../lib/passkey'
import { useAuth } from './AuthContext'

// ── Storage keys ────────────────────────────────────────────────────────────
const SALT_KEY           = 'gs_e2ee_salt'
const CHECK_KEY          = 'gs_e2ee_chk'
const HINT_KEY           = 'gs_e2ee_hint'
const SESSION_PASS_KEY   = 'gs_e2ee_session'      // legacy: plain passphrase
const SESSION_KEY_V2     = 'gs_e2ee_key_v2'       // v2: exported vault key bytes (base64)
const VAULT_V2_FLAG      = 'gs_e2ee_v2'           // marks unified-password vault
const RECOVERY_WRAPPED   = 'gs_e2ee_recovery_wrapped' // vault key wrapped with recovery key
const VAULT_PW_PENDING   = 'gs_vault_pw_pending'   // transient: login password for auto-unlock
const VERIFY_PLAINTEXT   = 'GiftSmart-E2EE-OK'

export interface DecryptedEntry { code: string; cvv: string | null }

interface E2EEContextValue {
  hasVault: boolean
  isVaultUnlocked: boolean
  hint: string | null
  needsMigration: boolean              // true = existing vault uses old separate passphrase
  pendingRecoveryPhrase: string | null // set after first setup; shown once, then cleared

  setupVault: (passphrase: string, hint?: string) => Promise<void>
  setupVaultFromPassword: (password: string, userId: string, hint?: string) => Promise<string>
  unlockVault: (passphrase: string) => Promise<boolean>
  unlockVaultFromPassword: (password: string, userId: string) => Promise<boolean>
  unlockVaultFromRecovery: (phrase: string) => Promise<boolean>
  lockVault: () => void
  resetVault: () => void
  migrateVault: (oldPassphrase: string) => Promise<boolean>
  enableBiometricVaultUnlock: (userId: string, userName: string, email?: string) => Promise<boolean>
  dismissRecoveryPhrase: () => void

  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<string>
  decryptedMap: ReadonlyMap<string, DecryptedEntry>
  buildDecryptedMap: (vouchers: Array<{id: string; code?: string|null; cvv?: string|null; is_e2ee?: boolean}>) => Promise<void>
  changePassphrase: (
    oldPass: string,
    newPass: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>,
    newHint?: string
  ) => Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}>
  disableVault: (
    passphrase: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ) => Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}>
}

const E2EEContext = createContext<E2EEContextValue | null>(null)

export function useE2EE() {
  const ctx = useContext(E2EEContext)
  if (!ctx) throw new Error('useE2EE must be used within E2EEProvider')
  return ctx
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isV2Vault(): boolean {
  return localStorage.getItem(VAULT_V2_FLAG) === 'true'
}

// Persist vault key to sessionStorage (key bytes, not passphrase)
async function persistVaultKey(key: CryptoKey) {
  try {
    const exported = await exportVaultKey(key)
    sessionStorage.setItem(SESSION_KEY_V2, exported)
  } catch {}
}

export function E2EEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)
  const [hasVault, setHasVault] = useState(() => !!localStorage.getItem(CHECK_KEY))
  const [hint, setHint] = useState<string | null>(() => localStorage.getItem(HINT_KEY))
  const [decryptedMap, setDecryptedMap] = useState<Map<string, DecryptedEntry>>(new Map())
  const [needsMigration, setNeedsMigration] = useState(false)
  const [pendingRecoveryPhrase, setPendingRecoveryPhrase] = useState<string | null>(null)
  const autoUnlockAttempted = useRef(false)

  // Auto-unlock on mount (runs once after user is available)
  useEffect(() => {
    if (autoUnlockAttempted.current) return
    autoUnlockAttempted.current = true

    const userId = user?.id

    // Path 1: v2 key bytes already in sessionStorage (page refresh within same tab)
    const savedKeyB64 = sessionStorage.getItem(SESSION_KEY_V2)
    if (savedKeyB64) {
      importVaultKey(savedKeyB64)
        .then(key => setVaultKey(key))
        .catch(() => sessionStorage.removeItem(SESSION_KEY_V2))
      return
    }

    // Path 2: pending login password for v2 vault auto-unlock
    const pendingPw = sessionStorage.getItem(VAULT_PW_PENDING)
    if (pendingPw && userId) {
      sessionStorage.removeItem(VAULT_PW_PENDING)
      const saltB64 = localStorage.getItem(SALT_KEY)
      const check   = localStorage.getItem(CHECK_KEY)

      if (!saltB64 || !check) {
        // No vault yet — set one up automatically
        autoSetupV2(pendingPw, userId)
        return
      }

      if (isV2Vault()) {
        // Existing v2 vault — derive key and verify
        deriveVaultKey(pendingPw, userId, saltFromB64(saltB64))
          .then(async key => {
            const dec = await decryptField(key, check)
            if (dec === VERIFY_PLAINTEXT) {
              setVaultKey(key)
              await persistVaultKey(key)
            }
          })
          .catch(() => {})
        return
      }

      // Existing vault but old format → prompt migration
      setNeedsMigration(true)
      return
    }

    // Path 3: legacy passphrase in sessionStorage (old-format vault)
    const legacyPass = sessionStorage.getItem(SESSION_PASS_KEY)
    if (legacyPass) {
      const saltB64 = localStorage.getItem(SALT_KEY)
      const check   = localStorage.getItem(CHECK_KEY)
      if (!saltB64 || !check) return
      deriveKey(legacyPass, saltFromB64(saltB64))
        .then(async key => {
          const dec = await decryptField(key, check)
          if (dec === VERIFY_PLAINTEXT) setVaultKey(key)
        })
        .catch(() => sessionStorage.removeItem(SESSION_PASS_KEY))
    }
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear vault key when user signs out
  useEffect(() => {
    if (!user) {
      setVaultKey(null)
      setDecryptedMap(new Map())
      sessionStorage.removeItem(SESSION_KEY_V2)
      sessionStorage.removeItem(SESSION_PASS_KEY)
    }
  }, [user])

  // ── Auto-setup v2 vault from login password ──────────────────────────────
  async function autoSetupV2(password: string, userId: string) {
    try {
      const phrase = await setupVaultFromPassword(password, userId)
      setPendingRecoveryPhrase(phrase)
    } catch {}
  }

  // ── Setup: v2 unified-password vault ────────────────────────────────────
  const setupVaultFromPassword = useCallback(async (
    password: string,
    userId: string,
    hintText?: string,
  ): Promise<string> => {
    const salt  = generateSalt()
    const key   = await deriveVaultKey(password, userId, salt)
    const check = await encryptField(key, VERIFY_PLAINTEXT)

    // Generate and store recovery-wrapped vault key
    const { phrase, bytes: recoveryBytes } = generateRecoverySecret()
    const wrapKeyBytes = await deriveRecoveryWrapKey(recoveryBytes)
    const wrappedForRecovery = await wrapVaultKey(key, wrapKeyBytes)

    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
    localStorage.setItem(VAULT_V2_FLAG, 'true')
    localStorage.setItem(RECOVERY_WRAPPED, wrappedForRecovery)
    sessionStorage.removeItem(SESSION_PASS_KEY)

    if (hintText?.trim()) {
      localStorage.setItem(HINT_KEY, hintText.trim())
      setHint(hintText.trim())
    } else {
      localStorage.removeItem(HINT_KEY)
      setHint(null)
    }

    setHasVault(true)
    setNeedsMigration(false)
    setVaultKey(key)
    await persistVaultKey(key)

    track('vault_opened')
    phCapture('vault_opened')
    return phrase
  }, [])

  // ── Legacy setup (separate passphrase) ──────────────────────────────────
  const setupVault = useCallback(async (passphrase: string, hintText?: string) => {
    const salt  = generateSalt()
    const key   = await deriveKey(passphrase, salt)
    const check = await encryptField(key, VERIFY_PLAINTEXT)
    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
    sessionStorage.setItem(SESSION_PASS_KEY, passphrase)
    if (hintText?.trim()) {
      localStorage.setItem(HINT_KEY, hintText.trim())
      setHint(hintText.trim())
    } else {
      localStorage.removeItem(HINT_KEY)
      setHint(null)
    }
    setHasVault(true)
    setVaultKey(key)
  }, [])

  // ── Unlock: v2 via login password ────────────────────────────────────────
  const unlockVaultFromPassword = useCallback(async (
    password: string,
    userId: string,
  ): Promise<boolean> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return false
    try {
      const key = await deriveVaultKey(password, userId, saltFromB64(saltB64))
      const dec = await decryptField(key, check)
      if (dec !== VERIFY_PLAINTEXT) return false
      setVaultKey(key)
      await persistVaultKey(key)
      track('vault_opened')
      phCapture('vault_opened')
      return true
    } catch {
      return false
    }
  }, [])

  // ── Unlock: recovery phrase ──────────────────────────────────────────────
  const unlockVaultFromRecovery = useCallback(async (phrase: string): Promise<boolean> => {
    const wrappedB64 = localStorage.getItem(RECOVERY_WRAPPED)
    if (!wrappedB64) return false
    try {
      const normalized = phrase.replace(/[\s-]/g, '').toUpperCase()
      const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const bytes = new Uint8Array(
        Array.from(normalized).map(c => ALPHA.indexOf(c)).filter(n => n >= 0)
      )
      if (bytes.length < 18) return false

      const wrapKeyBytes = await deriveRecoveryWrapKey(bytes)
      const key = await unwrapVaultKey(wrappedB64, wrapKeyBytes)
      const check = localStorage.getItem(CHECK_KEY)
      if (check) {
        const dec = await decryptField(key, check)
        if (dec !== VERIFY_PLAINTEXT) return false
      }
      setVaultKey(key)
      await persistVaultKey(key)
      return true
    } catch {
      return false
    }
  }, [])

  // ── Legacy unlock (separate passphrase) ──────────────────────────────────
  const unlockVault = useCallback(async (passphrase: string): Promise<boolean> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return false
    try {
      const key = await deriveKey(passphrase, saltFromB64(saltB64))
      const dec = await decryptField(key, check)
      if (dec !== VERIFY_PLAINTEXT) return false
      sessionStorage.setItem(SESSION_PASS_KEY, passphrase)
      setVaultKey(key)
      track('vault_opened')
      phCapture('vault_opened')
      return true
    } catch {
      return false
    }
  }, [])

  // ── Migrate old-format vault to v2 ──────────────────────────────────────
  const migrateVault = useCallback(async (oldPassphrase: string): Promise<boolean> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    const userId  = user?.id
    if (!saltB64 || !check || !userId) return false

    // Verify old passphrase
    let oldKey: CryptoKey
    try {
      oldKey = await deriveKey(oldPassphrase, saltFromB64(saltB64))
      const dec = await decryptField(oldKey, check)
      if (dec !== VERIFY_PLAINTEXT) return false
    } catch {
      return false
    }

    // Re-derive with new scheme (login password = old passphrase for migration purposes)
    // We store the same key under the v2 salt so unlock-from-password works going forward.
    // The login password MUST match oldPassphrase for migration to succeed.
    const newSalt = generateSalt()
    const pendingPw = oldPassphrase // user just confirmed it matches their vault
    const newKey = await deriveVaultKey(pendingPw, userId, newSalt)
    const newCheck = await encryptField(newKey, VERIFY_PLAINTEXT)

    // Recovery key for the new format
    const { phrase, bytes: recoveryBytes } = generateRecoverySecret()
    const wrapKeyBytes = await deriveRecoveryWrapKey(recoveryBytes)
    const wrappedForRecovery = await wrapVaultKey(newKey, wrapKeyBytes)

    localStorage.setItem(SALT_KEY, saltToB64(newSalt))
    localStorage.setItem(CHECK_KEY, newCheck)
    localStorage.setItem(VAULT_V2_FLAG, 'true')
    localStorage.setItem(RECOVERY_WRAPPED, wrappedForRecovery)
    sessionStorage.removeItem(SESSION_PASS_KEY)

    setVaultKey(newKey)
    setNeedsMigration(false)
    await persistVaultKey(newKey)
    setPendingRecoveryPhrase(phrase)
    return true
  }, [user?.id])

  // ── Enable biometric vault unlock (registers PRF credential) ─────────────
  const enableBiometricVaultUnlock = useCallback(async (
    userId: string,
    userName: string,
    email?: string,
  ): Promise<boolean> => {
    if (!vaultKey) return false
    return registerBiometricWithVault(userId, userName, vaultKey, email)
  }, [vaultKey])

  const dismissRecoveryPhrase = useCallback(() => {
    setPendingRecoveryPhrase(null)
  }, [])

  const lockVault = useCallback(() => {
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    setVaultKey(null)
    setDecryptedMap(new Map())
  }, [])

  const resetVault = useCallback(() => {
    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    localStorage.removeItem(HINT_KEY)
    localStorage.removeItem(VAULT_V2_FLAG)
    localStorage.removeItem(RECOVERY_WRAPPED)
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    setVaultKey(null)
    setHasVault(false)
    setHint(null)
    setNeedsMigration(false)
    setDecryptedMap(new Map())
  }, [])

  const encrypt = useCallback(async (plaintext: string): Promise<string> => {
    if (!vaultKey) throw new Error('vault is locked')
    return encryptField(vaultKey, plaintext)
  }, [vaultKey])

  const decrypt = useCallback(async (ciphertext: string): Promise<string> => {
    if (!vaultKey) throw new Error('vault is locked')
    if (!isEncryptedField(ciphertext)) return ciphertext
    return decryptField(vaultKey, ciphertext)
  }, [vaultKey])

  const buildDecryptedMap = useCallback(async (
    vouchers: Array<{id: string; code?: string|null; cvv?: string|null; is_e2ee?: boolean}>
  ) => {
    if (!vaultKey) return
    const map = new Map<string, DecryptedEntry>()
    await Promise.all(
      vouchers
        .filter(v => v.is_e2ee)
        .map(async v => {
          try {
            const code = v.code && isEncryptedField(v.code) ? await decryptField(vaultKey, v.code) : (v.code ?? '')
            const cvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(vaultKey, v.cvv)  : (v.cvv  ?? null)
            map.set(v.id, { code, cvv })
          } catch {
            // skip unreadable entry
          }
        })
    )
    setDecryptedMap(map)
  }, [vaultKey])

  const changePassphrase = useCallback(async (
    oldPass: string,
    newPass: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>,
    newHint?: string
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return { ok: false, entries: [] }

    let oldKey: CryptoKey
    try {
      // Try v2 derivation first, fall back to legacy
      if (isV2Vault() && user?.id) {
        oldKey = await deriveVaultKey(oldPass, user.id, saltFromB64(saltB64))
      } else {
        oldKey = await deriveKey(oldPass, saltFromB64(saltB64))
      }
      const dec = await decryptField(oldKey, check)
      if (dec !== VERIFY_PLAINTEXT) return { ok: false, entries: [] }
    } catch {
      return { ok: false, entries: [] }
    }

    const newSalt  = generateSalt()
    let newKey: CryptoKey
    if (isV2Vault() && user?.id) {
      newKey = await deriveVaultKey(newPass, user.id, newSalt)
    } else {
      newKey = await deriveKey(newPass, newSalt)
    }
    const newCheck = await encryptField(newKey, VERIFY_PLAINTEXT)

    const entries: Array<{id: string; code: string; cvv: string|null}> = []
    for (const v of e2eeVouchers) {
      try {
        const plainCode = v.code && isEncryptedField(v.code) ? await decryptField(oldKey, v.code) : (v.code ?? '')
        const plainCvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(oldKey, v.cvv)  : (v.cvv  ?? null)
        entries.push({ id: v.id, code: await encryptField(newKey, plainCode), cvv: plainCvv ? await encryptField(newKey, plainCvv) : null })
      } catch {}
    }

    localStorage.setItem(SALT_KEY, saltToB64(newSalt))
    localStorage.setItem(CHECK_KEY, newCheck)
    if (isV2Vault()) {
      // Re-generate recovery key for new password
      const { phrase, bytes: recoveryBytes } = generateRecoverySecret()
      const wrapKeyBytes = await deriveRecoveryWrapKey(recoveryBytes)
      const wrappedForRecovery = await wrapVaultKey(newKey, wrapKeyBytes)
      localStorage.setItem(RECOVERY_WRAPPED, wrappedForRecovery)
      setPendingRecoveryPhrase(phrase)
      sessionStorage.removeItem(SESSION_PASS_KEY)
      await persistVaultKey(newKey)
    } else {
      sessionStorage.setItem(SESSION_PASS_KEY, newPass)
    }

    if (newHint?.trim()) {
      localStorage.setItem(HINT_KEY, newHint.trim())
      setHint(newHint.trim())
    } else {
      localStorage.removeItem(HINT_KEY)
      setHint(null)
    }
    setHasVault(true)
    setVaultKey(newKey)

    // Invalidate biometric wrapped key since the vault key changed
    localStorage.removeItem('gs_e2ee_biometric_wrapped_v2')

    return { ok: true, entries }
  }, [user?.id])

  const disableVault = useCallback(async (
    passphrase: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return { ok: false, entries: [] }

    let key: CryptoKey
    try {
      if (isV2Vault() && user?.id) {
        key = await deriveVaultKey(passphrase, user.id, saltFromB64(saltB64))
      } else {
        key = await deriveKey(passphrase, saltFromB64(saltB64))
      }
      const dec = await decryptField(key, check)
      if (dec !== VERIFY_PLAINTEXT) return { ok: false, entries: [] }
    } catch {
      return { ok: false, entries: [] }
    }

    const entries: Array<{id: string; code: string; cvv: string|null}> = []
    for (const v of e2eeVouchers) {
      try {
        const code = v.code && isEncryptedField(v.code) ? await decryptField(key, v.code) : (v.code ?? '')
        const cvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(key, v.cvv)  : (v.cvv  ?? null)
        entries.push({ id: v.id, code, cvv })
      } catch {}
    }

    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    localStorage.removeItem(HINT_KEY)
    localStorage.removeItem(VAULT_V2_FLAG)
    localStorage.removeItem(RECOVERY_WRAPPED)
    localStorage.removeItem('gs_e2ee_biometric_wrapped_v2')
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    setVaultKey(null)
    setHasVault(false)
    setHint(null)
    setNeedsMigration(false)
    setDecryptedMap(new Map())

    return { ok: true, entries }
  }, [user?.id])

  return (
    <E2EEContext.Provider value={{
      hasVault,
      isVaultUnlocked: vaultKey !== null,
      hint,
      needsMigration,
      pendingRecoveryPhrase,
      setupVault,
      setupVaultFromPassword,
      unlockVault,
      unlockVaultFromPassword,
      unlockVaultFromRecovery,
      lockVault,
      resetVault,
      migrateVault,
      enableBiometricVaultUnlock,
      dismissRecoveryPhrase,
      encrypt,
      decrypt,
      decryptedMap,
      buildDecryptedMap,
      changePassphrase,
      disableVault,
    }}>
      {children}
    </E2EEContext.Provider>
  )
}

export { hasBiometricWrappedVaultKey }
