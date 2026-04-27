import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { deriveKey, encryptField, decryptField, isEncryptedField, generateSalt, saltToB64, saltFromB64 } from '../lib/e2ee'

const SALT_KEY  = 'gs_e2ee_salt'
const CHECK_KEY = 'gs_e2ee_chk'
const SESSION_PASS_KEY = 'gs_e2ee_session'
const VERIFY_PLAINTEXT = 'GiftSmart-E2EE-OK'

export interface DecryptedEntry { code: string; cvv: string | null }

interface E2EEContextValue {
  hasVault: boolean
  isVaultUnlocked: boolean
  setupVault: (passphrase: string) => Promise<void>
  unlockVault: (passphrase: string) => Promise<boolean>
  lockVault: () => void
  resetVault: () => void
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<string>
  decryptedMap: ReadonlyMap<string, DecryptedEntry>
  buildDecryptedMap: (vouchers: Array<{id: string; code?: string|null; cvv?: string|null; is_e2ee?: boolean}>) => Promise<void>
  changePassphrase: (
    oldPass: string,
    newPass: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ) => Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}>
}

const E2EEContext = createContext<E2EEContextValue | null>(null)

export function useE2EE() {
  const ctx = useContext(E2EEContext)
  if (!ctx) throw new Error('useE2EE must be used within E2EEProvider')
  return ctx
}

export function E2EEProvider({ children }: { children: ReactNode }) {
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)
  const [hasVault, setHasVault] = useState(() => !!localStorage.getItem(CHECK_KEY))
  const [decryptedMap, setDecryptedMap] = useState<Map<string, DecryptedEntry>>(new Map())
  const autoUnlockAttempted = useRef(false)

  // Auto-unlock from sessionStorage on mount (survives page refresh within same tab)
  useEffect(() => {
    if (autoUnlockAttempted.current) return
    autoUnlockAttempted.current = true
    const saved = sessionStorage.getItem(SESSION_PASS_KEY)
    if (!saved) return
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return
    deriveKey(saved, saltFromB64(saltB64))
      .then(key => decryptField(key, check).then(dec => {
        if (dec === VERIFY_PLAINTEXT) setVaultKey(key)
      }))
      .catch(() => sessionStorage.removeItem(SESSION_PASS_KEY))
  }, [])

  const setupVault = useCallback(async (passphrase: string) => {
    const salt = generateSalt()
    const key  = await deriveKey(passphrase, salt)
    const check = await encryptField(key, VERIFY_PLAINTEXT)
    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
    sessionStorage.setItem(SESSION_PASS_KEY, passphrase)
    setHasVault(true)
    setVaultKey(key)
  }, [])

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
      return true
    } catch {
      return false
    }
  }, [])

  const lockVault = useCallback(() => {
    sessionStorage.removeItem(SESSION_PASS_KEY)
    setVaultKey(null)
    setDecryptedMap(new Map())
  }, [])

  const resetVault = useCallback(() => {
    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    sessionStorage.removeItem(SESSION_PASS_KEY)
    setVaultKey(null)
    setHasVault(false)
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

  // Decrypt all E2EE vouchers into memory map for search/duplicate detection
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
            // if decryption fails, skip entry
          }
        })
    )
    setDecryptedMap(map)
  }, [vaultKey])

  // Re-encrypt all E2EE vouchers under a new passphrase
  const changePassphrase = useCallback(async (
    oldPass: string,
    newPass: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}> => {
    // Verify old passphrase
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    if (!saltB64 || !check) return { ok: false, entries: [] }
    let oldKey: CryptoKey
    try {
      oldKey = await deriveKey(oldPass, saltFromB64(saltB64))
      const dec = await decryptField(oldKey, check)
      if (dec !== VERIFY_PLAINTEXT) return { ok: false, entries: [] }
    } catch {
      return { ok: false, entries: [] }
    }

    // Generate new salt + key + canary
    const newSalt = generateSalt()
    const newKey  = await deriveKey(newPass, newSalt)
    const newCheck = await encryptField(newKey, VERIFY_PLAINTEXT)

    // Re-encrypt all voucher codes + CVVs
    const entries: Array<{id: string; code: string; cvv: string|null}> = []
    for (const v of e2eeVouchers) {
      try {
        const plainCode = v.code && isEncryptedField(v.code) ? await decryptField(oldKey, v.code) : (v.code ?? '')
        const plainCvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(oldKey, v.cvv)  : (v.cvv  ?? null)
        const newCode = await encryptField(newKey, plainCode)
        const newCvv  = plainCvv ? await encryptField(newKey, plainCvv) : null
        entries.push({ id: v.id, code: newCode, cvv: newCvv })
      } catch {
        // skip on error
      }
    }

    // Commit new passphrase to storage
    localStorage.setItem(SALT_KEY, saltToB64(newSalt))
    localStorage.setItem(CHECK_KEY, newCheck)
    sessionStorage.setItem(SESSION_PASS_KEY, newPass)
    setHasVault(true)
    setVaultKey(newKey)

    return { ok: true, entries }
  }, [])

  return (
    <E2EEContext.Provider value={{
      hasVault,
      isVaultUnlocked: vaultKey !== null,
      setupVault,
      unlockVault,
      lockVault,
      resetVault,
      encrypt,
      decrypt,
      decryptedMap,
      buildDecryptedMap,
      changePassphrase,
    }}>
      {children}
    </E2EEContext.Provider>
  )
}
