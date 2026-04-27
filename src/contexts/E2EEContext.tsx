import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { deriveKey, encryptField, decryptField, isEncryptedField, generateSalt, saltToB64, saltFromB64 } from '../lib/e2ee'

const SALT_KEY  = 'gs_e2ee_salt'
const CHECK_KEY = 'gs_e2ee_chk'
const VERIFY_PLAINTEXT = 'GiftSmart-E2EE-OK'

interface E2EEContextValue {
  hasVault: boolean
  isVaultUnlocked: boolean
  setupVault: (passphrase: string) => Promise<void>
  unlockVault: (passphrase: string) => Promise<boolean>
  lockVault: () => void
  resetVault: () => void
  encrypt: (plaintext: string) => Promise<string>
  decrypt: (ciphertext: string) => Promise<string>
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

  const setupVault = useCallback(async (passphrase: string) => {
    const salt = generateSalt()
    const key  = await deriveKey(passphrase, salt)
    const check = await encryptField(key, VERIFY_PLAINTEXT)
    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
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
      setVaultKey(key)
      return true
    } catch {
      return false
    }
  }, [])

  const lockVault = useCallback(() => setVaultKey(null), [])

  const resetVault = useCallback(() => {
    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    setVaultKey(null)
    setHasVault(false)
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
    }}>
      {children}
    </E2EEContext.Provider>
  )
}
