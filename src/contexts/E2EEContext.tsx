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
  generateMasterKey,
  encryptField,
  decryptField,
  isEncryptedField,
  generateSalt,
  saltToB64,
  saltFromB64,
} from '../lib/e2ee'
import {
  VERIFY_PLAINTEXT,
  SESSION_KEY_V2,
  PENDING_PHRASE_KEY,
  PW_STALE_KEY,
  fetchVaultBundle,
  cacheBundleMeta,
  buildPasswordWrap,
  buildRecoveryWrap,
  upsertWrap,
  tryUnlockWithPassword,
  tryUnlockWithRecovery,
  tryUnlockWithPrfBytes,
  ensureV3Wraps,
} from '../lib/vaultBundle'
import type { VaultWrap } from '../lib/vaultBundle'
import { registerBiometricWithVault, hasBiometricWrappedVaultKey } from '../lib/passkey'
import { saveDeviceVaultKey, loadDeviceVaultKey, clearDeviceVaultKey, isVaultPersistEnabled } from '../lib/vaultKeyStore'
import { useAuth } from './AuthContext'
import { supabase } from '../lib/supabase'

// ── Supabase vault-meta helpers (cross-device sync) ──────────────────────────

async function saveVaultMeta(saltB64: string, check: string) {
  try {
    await supabase.rpc('upsert_vault_meta', { p_salt: saltB64, p_check: check })
  } catch {}
}

// ── Storage keys ────────────────────────────────────────────────────────────
const SALT_KEY           = 'gs_e2ee_salt'
const CHECK_KEY          = 'gs_e2ee_chk'
const HINT_KEY           = 'gs_e2ee_hint'
const SESSION_PASS_KEY   = 'gs_e2ee_session'      // legacy: plain passphrase (old-format vaults only)
const VAULT_V2_FLAG      = 'gs_e2ee_v2'           // marks unified-password vault
const VAULT_MIGRATE_PW   = 'gs_vault_migrate_pw'  // legacy-migration helper (read-only; no longer written)
const PRF_PENDING_KEY    = 'gs_biometric_prf_pending'   // transient: raw PRF bytes from biometric assertion
const BIOMETRIC_WRAPPED_LOCAL = 'gs_e2ee_biometric_wrapped_v2'
const BIOMETRIC_CRED_LOCAL    = 'biometric_credential_id'

export interface DecryptedEntry { code: string; cvv: string | null }

export type UnlockStatus = 'ok' | 'wrong' | 'stale' | 'no-vault' | 'error'

export interface VaultDoors {
  password: boolean
  recovery: boolean
  prf: number       // number of registered passkey wraps
  version: number
}

interface E2EEContextValue {
  hasVault: boolean
  isVaultUnlocked: boolean
  isUnifiedVault: boolean              // true = vault opens with the login password (v2/v3)
  hint: string | null
  needsMigration: boolean              // true = existing vault uses old separate passphrase
  needsOAuthVaultSetup: boolean        // true = Google/OAuth user with no vault
  pendingRecoveryPhrase: string | null // set after setup/rotation; shown once, then cleared
  doors: VaultDoors | null             // which unlock methods exist server-side (vault health)
  passwordWrapStale: boolean           // login password verified but no longer opens the vault

  setupVault: (passphrase: string, hint?: string) => Promise<void>
  setupVaultFromPassword: (password: string, userId: string, hint?: string) => Promise<string>
  // OAuth/passkey path — no password door; optionally registers a passkey PRF door
  setupVaultWithMasterKey: (opts?: { registerBiometric?: { userName: string; email?: string } }) => Promise<string>
  unlockVault: (passphrase: string) => Promise<boolean>
  unlockWithPassword: (password: string) => Promise<UnlockStatus>
  unlockVaultFromPassword: (password: string, userId: string) => Promise<boolean>
  unlockVaultFromRecovery: (phrase: string) => Promise<boolean>
  lockVault: () => void
  resetVault: () => void
  migrateVault: (
    oldPassphrase: string,
    loginPassword: string | undefined,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ) => Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>; failed?: number}>
  enableBiometricVaultUnlock: (userId: string, userName: string, email?: string) => Promise<boolean>
  unlockVaultWithBiometric: () => Promise<boolean>
  // v3: password changes re-wrap the master key — no data is re-encrypted.
  reDeriveVaultKeyFromPassword: (
    newPassword: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ) => Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}>
  rewrapPassword: (newPassword: string) => Promise<boolean>
  regenerateRecoveryKey: () => Promise<string>
  refreshDoors: () => Promise<void>
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

function doorsFromWraps(wraps: VaultWrap[], version: number): VaultDoors {
  return {
    password: wraps.some(w => w.method === 'password' && w.kdf?.v === 3),
    recovery: wraps.some(w => w.method === 'recovery' && w.kdf?.v === 3),
    prf: wraps.filter(w => w.method === 'prf').length,
    version,
  }
}

// Persist vault key: sessionStorage for this tab (raw bytes), plus — when the
// "stay unlocked on this device" preference is on — a non-extractable copy in
// IndexedDB so the vault reopens silently on the next visit/app launch.
async function persistVaultKey(key: CryptoKey, userId?: string) {
  try {
    const exported = await exportVaultKey(key)
    sessionStorage.setItem(SESSION_KEY_V2, exported)
    if (userId && isVaultPersistEnabled()) {
      await saveDeviceVaultKey(userId, exported)
    }
  } catch {}
}

export function E2EEProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null)
  const [hasVault, setHasVault] = useState(() => !!localStorage.getItem(CHECK_KEY))
  const [hint, setHint] = useState<string | null>(() => localStorage.getItem(HINT_KEY))
  const [decryptedMap, setDecryptedMap] = useState<Map<string, DecryptedEntry>>(new Map())
  const [needsMigration, setNeedsMigration] = useState(false)
  const [needsOAuthVaultSetup, setNeedsOAuthVaultSetup] = useState(false)
  const [pendingRecoveryPhrase, setPendingRecoveryPhrase] = useState<string | null>(
    () => sessionStorage.getItem(PENDING_PHRASE_KEY),
  )
  const [doors, setDoors] = useState<VaultDoors | null>(null)
  const [passwordWrapStale, setPasswordWrapStale] = useState(
    () => sessionStorage.getItem(PW_STALE_KEY) === '1',
  )
  const autoUnlockAttempted = useRef(false)
  const vaultKeyRef = useRef<CryptoKey | null>(null)
  useEffect(() => { vaultKeyRef.current = vaultKey }, [vaultKey])

  // The login-time unlock (AuthPage/BiometricGate, outside this provider) can finish
  // AFTER our one-shot auto-unlock effect already ran — it announces itself so the
  // session key isn't missed for the rest of the session.
  useEffect(() => {
    const onUnlocked = () => {
      const phrase = sessionStorage.getItem(PENDING_PHRASE_KEY)
      if (phrase) setPendingRecoveryPhrase(phrase)
      setPasswordWrapStale(sessionStorage.getItem(PW_STALE_KEY) === '1')
      if (vaultKeyRef.current) return
      const b64 = sessionStorage.getItem(SESSION_KEY_V2)
      if (!b64) return
      importVaultKey(b64)
        .then(key => {
          setVaultKey(key)
          setHasVault(true)
          refreshDoors()
        })
        .catch(() => sessionStorage.removeItem(SESSION_KEY_V2))
    }
    window.addEventListener('gs-vault-unlocked', onUnlocked)
    return () => window.removeEventListener('gs-vault-unlocked', onUnlocked)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const refreshDoors = useCallback(async () => {
    const bundle = await fetchVaultBundle()
    if (bundle) {
      setDoors(doorsFromWraps(bundle.wraps, bundle.vault_version))
      cacheBundleMeta(bundle)
      setHasVault(true)
    } else {
      setDoors(null)
    }
  }, [])

  // Wrap-migration + post-unlock bookkeeping shared by every successful unlock.
  const afterUnlock = useCallback(async (key: CryptoKey, opts?: { password?: string }) => {
    setVaultKey(key)
    await persistVaultKey(key, user?.id)
    if (opts?.password) {
      sessionStorage.removeItem(PW_STALE_KEY)
      setPasswordWrapStale(false)
    }
    try {
      const bundle = await fetchVaultBundle()
      if (bundle && user?.id) {
        await ensureV3Wraps(key, user.id, bundle, opts?.password)
        const fresh = await fetchVaultBundle()
        if (fresh) setDoors(doorsFromWraps(fresh.wraps, fresh.vault_version))
        const pendingPhrase = sessionStorage.getItem(PENDING_PHRASE_KEY)
        if (pendingPhrase) setPendingRecoveryPhrase(pendingPhrase)
      }
    } catch {}
    track('vault_opened')
    phCapture('vault_opened')
  }, [user?.id])

  // Restore vault metadata from Supabase when localStorage is empty (new/cleared device).
  // Runs before VoucherForm renders so it never shows "setup vault" when one already exists.
  useEffect(() => {
    if (!user?.id) return
    if (localStorage.getItem(CHECK_KEY)) { refreshDoors(); return }
    fetchVaultBundle().then(bundle => {
      if (bundle) {
        cacheBundleMeta(bundle)
        setDoors(doorsFromWraps(bundle.wraps, bundle.vault_version))
        setHasVault(true)
      }
    })
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-unlock on mount (runs once after user is available)
  useEffect(() => {
    if (autoUnlockAttempted.current) return
    autoUnlockAttempted.current = true

    const userId = user?.id

    // A recovery phrase minted during login-time wrap migration waits here for display
    const pendingPhrase = sessionStorage.getItem(PENDING_PHRASE_KEY)
    if (pendingPhrase) setPendingRecoveryPhrase(pendingPhrase)

    // Path 1: MK bytes already in sessionStorage (page refresh, or the login-time
    // unlock in AuthPage/BiometricGate — which replaced the old plaintext-password
    // handoff — already opened the vault).
    const savedKeyB64 = sessionStorage.getItem(SESSION_KEY_V2)
    if (savedKeyB64) {
      importVaultKey(savedKeyB64)
        .then(async key => {
          setVaultKey(key)
          if (userId && isVaultPersistEnabled()) await persistVaultKey(key, userId)
          refreshDoors()
        })
        .catch(() => sessionStorage.removeItem(SESSION_KEY_V2))
      return
    }

    // Later fallbacks, shared by the sync flow and the async device-key path below.
    const tryLegacyPaths = () => {
      // Legacy old-format vault (separate passphrase, pre-v2) → prompt migration
      if (localStorage.getItem(CHECK_KEY) && !isV2Vault()) {
        setNeedsMigration(true)
        return
      }

      // Legacy passphrase in sessionStorage (old-format vault)
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
        return
      }

      // OAuth user (Google etc.) with no vault — prompt setup. Guests are
      // excluded: their provider is 'anonymous' and they have no password or
      // identity to derive a vault door from yet.
      const provider = user?.app_metadata?.provider
      const isOAuth = provider && provider !== 'email' && provider !== 'anonymous' && !user?.is_anonymous
      if (isOAuth && !localStorage.getItem(CHECK_KEY)) {
        setNeedsOAuthVaultSetup(true)
      }
    }

    // Path 2: device-persisted key (IndexedDB) — the "vault stays open on this
    // device" path. Verified against the vault check before being trusted; a stale
    // key (vault was re-keyed elsewhere) is discarded.
    if (userId && isVaultPersistEnabled()) {
      ;(async () => {
        try {
          const key = await loadDeviceVaultKey(userId)
          if (key) {
            const check = localStorage.getItem(CHECK_KEY)
            if (check) {
              const dec = await decryptField(key, check).catch(() => null)
              if (dec === VERIFY_PLAINTEXT) {
                setVaultKey(key)
                afterUnlock(key)
                return
              }
            }
            await clearDeviceVaultKey(userId)
          }
        } catch { /* fall through to the legacy unlock paths below */ }
        tryLegacyPaths()
      })()
      return
    }

    tryLegacyPaths()
  }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Clear vault key when user signs out (including the device-persisted copy —
  // signing out is an explicit "lock everything" action)
  useEffect(() => {
    if (!user) {
      setVaultKey(null)
      setDecryptedMap(new Map())
      sessionStorage.removeItem(SESSION_KEY_V2)
      sessionStorage.removeItem(SESSION_PASS_KEY)
      sessionStorage.removeItem(VAULT_MIGRATE_PW)
      sessionStorage.removeItem(PENDING_PHRASE_KEY)
      clearDeviceVaultKey()
    }
  }, [user])

  // ── Setup: v3 vault opened by the login password ─────────────────────────
  // The password should be pre-verified against Supabase auth by the caller
  // (VaultSetupSheet re-authenticates) — deriving a vault door from a string
  // that ISN'T the real login password silently locks the user out at the next
  // login, which is exactly the v2 failure mode this replaces.
  const setupVaultFromPassword = useCallback(async (
    password: string,
    userId: string,
    hintText?: string,
  ): Promise<string> => {
    // Adopt an existing vault when one exists and the password opens it —
    // overwriting it with a fresh key would orphan the other devices' data.
    const existing = await fetchVaultBundle()
    if (existing?.vault_check) {
      const res = await tryUnlockWithPassword(existing, password, userId)
      if (res) {
        cacheBundleMeta(existing)
        setHasVault(true)
        setNeedsMigration(false)
        setNeedsOAuthVaultSetup(false)
        await afterUnlock(res.key, { password })
        return ''
      }
      throw new Error('vault-exists-password-mismatch')
    }

    // Fresh vault: random master key + password/recovery doors, server-first —
    // local state only changes after the server writes succeed.
    const mk    = await generateMasterKey()
    const salt  = generateSalt()
    const check = await encryptField(mk, VERIFY_PLAINTEXT)

    const pwWrap = await buildPasswordWrap(mk, password, userId)
    const { wrap: recWrap, phrase } = await buildRecoveryWrap(mk)

    await saveVaultMeta(saltToB64(salt), check)
    const wroteP = await upsertWrap(pwWrap)
    const wroteR = await upsertWrap(recWrap)
    if (wroteP || wroteR) {
      try { await supabase.rpc('set_vault_version', { p_version: 3 }) } catch {}
    }

    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
    localStorage.setItem(VAULT_V2_FLAG, 'true')
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
    setNeedsOAuthVaultSetup(false)
    setVaultKey(mk)
    await persistVaultKey(mk, userId)
    setDoors({ password: wroteP, recovery: wroteR, prf: 0, version: 3 })
    setPendingRecoveryPhrase(phrase)

    track('vault_opened')
    phCapture('vault_opened')
    return phrase
  }, [afterUnlock])

  // ── Setup: OAuth/passkey path — no password door, recovery (+PRF) only ───
  const setupVaultWithMasterKey = useCallback(async (
    opts?: { registerBiometric?: { userName: string; email?: string } },
  ): Promise<string> => {
    const mk    = await generateMasterKey()
    const salt  = generateSalt()
    const check = await encryptField(mk, VERIFY_PLAINTEXT)
    const { wrap: recWrap, phrase } = await buildRecoveryWrap(mk)

    await saveVaultMeta(saltToB64(salt), check)
    const wroteR = await upsertWrap(recWrap)
    if (wroteR) {
      try { await supabase.rpc('set_vault_version', { p_version: 3 }) } catch {}
    }

    localStorage.setItem(SALT_KEY, saltToB64(salt))
    localStorage.setItem(CHECK_KEY, check)
    localStorage.setItem(VAULT_V2_FLAG, 'true')

    setHasVault(true)
    setNeedsOAuthVaultSetup(false)
    setVaultKey(mk)
    await persistVaultKey(mk, user?.id)

    // Passkey door — registered here (with mk still in scope) rather than through
    // enableBiometricVaultUnlock, whose vaultKey state hasn't updated yet.
    let prfCount = 0
    if (opts?.registerBiometric && user?.id) {
      try {
        const ok = await registerBiometricWithVault(user.id, opts.registerBiometric.userName, mk, opts.registerBiometric.email)
        if (ok) {
          const wrapped = localStorage.getItem(BIOMETRIC_WRAPPED_LOCAL)
          const credId  = localStorage.getItem(BIOMETRIC_CRED_LOCAL) ?? ''
          if (wrapped && await upsertWrap({ method: 'prf', slot_id: credId, wrapped_mk: wrapped, kdf: { v: 3 } })) {
            prfCount = 1
          }
        }
      } catch {}
    }

    setDoors({ password: false, recovery: wroteR, prf: prfCount, version: 3 })
    setPendingRecoveryPhrase(phrase)

    track('vault_opened')
    phCapture('vault_opened')
    return phrase
  }, [user?.id])

  // ── Legacy setup (separate passphrase) — dead path kept only for type compat
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

  // ── Unlock: login password, with distinct outcomes ───────────────────────
  const unlockWithPassword = useCallback(async (password: string): Promise<UnlockStatus> => {
    const userId = user?.id
    if (!userId) return 'error'
    try {
      const bundle = await fetchVaultBundle()
      if (!bundle?.vault_check) return 'no-vault'
      cacheBundleMeta(bundle)
      setHasVault(true)

      const res = await tryUnlockWithPassword(bundle, password, userId)
      if (res) {
        await afterUnlock(res.key, { password })
        return 'ok'
      }

      // Distinguish "wrong password" from "right password, stale wrap" (post password
      // reset): verify against Supabase auth without touching the UI session.
      if (user.email) {
        try {
          const { error } = await supabase.auth.signInWithPassword({ email: user.email, password })
          if (!error) {
            sessionStorage.setItem(PW_STALE_KEY, '1')
            setPasswordWrapStale(true)
            return 'stale'
          }
        } catch {}
      }
      return 'wrong'
    } catch {
      return 'error'
    }
  }, [user?.id, user?.email, afterUnlock])

  // Boolean wrapper for existing call sites
  const unlockVaultFromPassword = useCallback(async (
    password: string,
    _userId: string,
  ): Promise<boolean> => {
    return (await unlockWithPassword(password)) === 'ok'
  }, [unlockWithPassword])

  // ── Unlock: recovery phrase (server-stored wrap → works on any device) ───
  const unlockVaultFromRecovery = useCallback(async (phrase: string): Promise<boolean> => {
    try {
      const bundle = await fetchVaultBundle()
      if (!bundle) return false
      const key = await tryUnlockWithRecovery(bundle, phrase)
      if (!key) return false
      cacheBundleMeta(bundle)
      setHasVault(true)
      await afterUnlock(key)
      // The recovery door just proved itself; if the password wrap is stale this
      // unlock is the moment the user can re-link it (VaultUnlockSheet offers it).
      return true
    } catch {
      return false
    }
  }, [afterUnlock])

  // ── Unlock: accepts the passphrase regardless of vault format ────────────
  const unlockVault = useCallback(async (passphrase: string): Promise<boolean> => {
    if (isV2Vault() && user?.id) {
      return (await unlockWithPassword(passphrase)) === 'ok'
    }
    // Legacy vault (separate passphrase, local-only meta)
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
  }, [user?.id, unlockWithPassword])

  // ── Migrate old-format vault (separate passphrase) → v3, atomically ──────
  // Decrypts under the old key, re-encrypts under a fresh random master key, and
  // commits meta + wraps + every voucher in ONE server transaction. A mid-flight
  // failure leaves the old vault fully intact (v2 committed the new key first,
  // which permanently lost any voucher not yet rewritten).
  const migrateVault = useCallback(async (
    oldPassphrase: string,
    loginPassword: string | undefined,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>,
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>; failed?: number}> => {
    const saltB64 = localStorage.getItem(SALT_KEY)
    const check   = localStorage.getItem(CHECK_KEY)
    const userId  = user?.id
    if (!saltB64 || !check || !userId) return { ok: false, entries: [] }

    // Step 1: verify the old vault passphrase
    let oldKey: CryptoKey
    try {
      oldKey = await deriveKey(oldPassphrase, saltFromB64(saltB64))
      const dec = await decryptField(oldKey, check)
      if (dec !== VERIFY_PLAINTEXT) return { ok: false, entries: [] }
    } catch {
      return { ok: false, entries: [] }
    }

    // Step 2: fresh random master key
    const mk       = await generateMasterKey()
    const newSalt  = generateSalt()
    const newCheck = await encryptField(mk, VERIFY_PLAINTEXT)

    // Step 3: re-encrypt — failures are COUNTED and reported, never swallowed
    const entries: Array<{id: string; code: string; cvv: string|null}> = []
    let failed = 0
    for (const v of e2eeVouchers) {
      try {
        const plainCode = v.code && isEncryptedField(v.code) ? await decryptField(oldKey, v.code) : (v.code ?? '')
        const plainCvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(oldKey, v.cvv)  : (v.cvv  ?? null)
        entries.push({
          id: v.id,
          code: await encryptField(mk, plainCode),
          cvv: plainCvv ? await encryptField(mk, plainCvv) : null,
        })
      } catch {
        failed++
      }
    }
    if (failed > 0) {
      // A voucher that can't be decrypted under the old key would become permanently
      // unreadable once that key is gone — abort and tell the user instead.
      return { ok: false, entries: [], failed }
    }

    // Step 4: doors for the new key
    const wraps: VaultWrap[] = []
    const { wrap: recWrap, phrase } = await buildRecoveryWrap(mk)
    wraps.push(recWrap)
    const loginPw = loginPassword ?? sessionStorage.getItem(VAULT_MIGRATE_PW) ?? undefined
    if (loginPw) wraps.push(await buildPasswordWrap(mk, loginPw, userId))

    // Step 5: one atomic transaction
    const { error } = await supabase.rpc('commit_vault_rekey', {
      p_salt: saltToB64(newSalt),
      p_check: newCheck,
      p_version: 3,
      p_wraps: wraps,
      p_entries: entries,
    })
    if (error) return { ok: false, entries: [] }

    localStorage.setItem(SALT_KEY, saltToB64(newSalt))
    localStorage.setItem(CHECK_KEY, newCheck)
    localStorage.setItem(VAULT_V2_FLAG, 'true')
    localStorage.removeItem(BIOMETRIC_WRAPPED_LOCAL) // wrapped the OLD key
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(VAULT_MIGRATE_PW)

    setVaultKey(mk)
    setNeedsMigration(false)
    await persistVaultKey(mk, userId)
    setDoors({ password: !!loginPw, recovery: true, prf: 0, version: 3 })
    setPendingRecoveryPhrase(phrase)
    return { ok: true, entries }
  }, [user?.id])

  // ── Password change → re-wrap only (vault must be unlocked) ──────────────
  const rewrapPassword = useCallback(async (newPassword: string): Promise<boolean> => {
    if (!vaultKey || !user?.id) return false
    try {
      const ok = await upsertWrap(await buildPasswordWrap(vaultKey, newPassword, user.id))
      if (ok) {
        sessionStorage.removeItem(PW_STALE_KEY)
        setPasswordWrapStale(false)
        try { await supabase.rpc('set_vault_version', { p_version: 3 }) } catch {}
        await refreshDoors()
      }
      return ok
    } catch {
      return false
    }
  }, [vaultKey, user?.id, refreshDoors])

  // v3: kept for existing call sites — the signature still accepts vouchers but no
  // data is re-encrypted anymore; the master key stays, only its password door moves.
  const reDeriveVaultKeyFromPassword = useCallback(async (
    newPassword: string,
    _e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>,
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}> => {
    const ok = await rewrapPassword(newPassword)
    return { ok, entries: [] }
  }, [rewrapPassword])

  // ── Regenerate recovery key (vault must be unlocked) ────────────────────
  const regenerateRecoveryKey = useCallback(async (): Promise<string> => {
    if (!vaultKey) throw new Error('vault is locked')
    const { wrap, phrase } = await buildRecoveryWrap(vaultKey)
    const ok = await upsertWrap(wrap)
    if (!ok) throw new Error('recovery wrap sync failed')
    setPendingRecoveryPhrase(phrase)
    await refreshDoors()
    return phrase
  }, [vaultKey, refreshDoors])

  // ── Enable biometric vault unlock (registers PRF credential) ─────────────
  const enableBiometricVaultUnlock = useCallback(async (
    userId: string,
    userName: string,
    email?: string,
  ): Promise<boolean> => {
    if (!vaultKey) return false
    const ok = await registerBiometricWithVault(userId, userName, vaultKey, email)
    if (ok) {
      // Mirror the wrap into vault_wraps so PRF unlock works from the bundle
      const wrapped = localStorage.getItem(BIOMETRIC_WRAPPED_LOCAL)
      const credId  = localStorage.getItem(BIOMETRIC_CRED_LOCAL) ?? ''
      if (wrapped) {
        await upsertWrap({ method: 'prf', slot_id: credId, wrapped_mk: wrapped, kdf: { v: 3 } })
        await refreshDoors()
      }
    }
    return ok
  }, [vaultKey, refreshDoors])

  // ── Unlock vault via biometric (PRF-wrapped key) ─────────────────────────
  const unlockVaultWithBiometric = useCallback(async (): Promise<boolean> => {
    try {
      const { verifyBiometricForVaultUnlock } = await import('../lib/passkey')
      const result = await verifyBiometricForVaultUnlock()
      if (!result.authenticated) return false

      if (result.vaultKey) {
        const check = localStorage.getItem(CHECK_KEY)
        if (check) {
          const dec = await decryptField(result.vaultKey, check).catch(() => null)
          if (dec !== VERIFY_PLAINTEXT) return false
        }
        await afterUnlock(result.vaultKey)
        return true
      }

      // No locally-stored wrapped key — try the server-side PRF wraps (synced
      // passkey on a new device), then fall back to parking the PRF bytes for
      // wrapping after the next manual unlock.
      if (result.prfBytes) {
        const bundle = await fetchVaultBundle()
        if (bundle) {
          const key = await tryUnlockWithPrfBytes(bundle, result.prfBytes)
          if (key) {
            cacheBundleMeta(bundle)
            setHasVault(true)
            // Store locally for fast unlock next time
            try {
              const wrapped = await wrapVaultKey(key, result.prfBytes)
              localStorage.setItem(BIOMETRIC_WRAPPED_LOCAL, wrapped)
            } catch {}
            await afterUnlock(key)
            return true
          }
        }
        const b64 = btoa(String.fromCharCode(...result.prfBytes))
        sessionStorage.setItem(PRF_PENDING_KEY, b64)
      }
      return false
    } catch {
      return false
    }
  }, [afterUnlock])

  const dismissRecoveryPhrase = useCallback(() => {
    setPendingRecoveryPhrase(null)
    sessionStorage.removeItem(PENDING_PHRASE_KEY)
    setNeedsOAuthVaultSetup(false)
  }, [])

  const lockVault = useCallback(() => {
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    clearDeviceVaultKey(user?.id)
    setVaultKey(null)
    setDecryptedMap(new Map())
  }, [user?.id])

  const resetVault = useCallback(() => {
    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    localStorage.removeItem(HINT_KEY)
    localStorage.removeItem(VAULT_V2_FLAG)
    localStorage.removeItem(BIOMETRIC_WRAPPED_LOCAL)
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    sessionStorage.removeItem(PENDING_PHRASE_KEY)
    clearDeviceVaultKey()
    setVaultKey(null)
    setHasVault(false)
    setHint(null)
    setNeedsMigration(false)
    setDoors(null)
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

  // Legacy-vault passphrase change (separate-passphrase vaults only — v2/v3 users
  // change their LOGIN password, which re-wraps via rewrapPassword instead).
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
    let failed = 0
    for (const v of e2eeVouchers) {
      try {
        const plainCode = v.code && isEncryptedField(v.code) ? await decryptField(oldKey, v.code) : (v.code ?? '')
        const plainCvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(oldKey, v.cvv)  : (v.cvv  ?? null)
        entries.push({ id: v.id, code: await encryptField(newKey, plainCode), cvv: plainCvv ? await encryptField(newKey, plainCvv) : null })
      } catch { failed++ }
    }
    if (failed > 0) return { ok: false, entries: [] }

    // Atomic server commit; falls back gracefully only for local-only legacy vaults
    const { error } = await supabase.rpc('commit_vault_rekey', {
      p_salt: saltToB64(newSalt),
      p_check: newCheck,
      p_version: isV2Vault() ? 3 : 2,
      p_wraps: [],
      p_entries: entries,
    })
    if (error && isV2Vault()) return { ok: false, entries: [] }

    localStorage.setItem(SALT_KEY, saltToB64(newSalt))
    localStorage.setItem(CHECK_KEY, newCheck)
    if (isV2Vault()) {
      sessionStorage.removeItem(SESSION_PASS_KEY)
      await persistVaultKey(newKey, user?.id)
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
    localStorage.removeItem(BIOMETRIC_WRAPPED_LOCAL)

    return { ok: true, entries: error ? entries : [] }
  }, [user?.id])

  const disableVault = useCallback(async (
    passphrase: string,
    e2eeVouchers: Array<{id: string; code?: string|null; cvv?: string|null}>
  ): Promise<{ok: boolean; entries: Array<{id: string; code: string; cvv: string|null}>}> => {
    const check = localStorage.getItem(CHECK_KEY)
    if (!check) return { ok: false, entries: [] }

    // Verify with the password (v3 wrap → v2 derive → legacy), reusing the ladder
    let key: CryptoKey | null = null
    if (isV2Vault() && user?.id) {
      const bundle = await fetchVaultBundle()
      if (bundle) {
        const res = await tryUnlockWithPassword(bundle, passphrase, user.id)
        if (res) key = res.key
      }
    }
    if (!key) {
      const saltB64 = localStorage.getItem(SALT_KEY)
      if (!saltB64) return { ok: false, entries: [] }
      try {
        const legacyKey = await deriveKey(passphrase, saltFromB64(saltB64))
        const dec = await decryptField(legacyKey, check)
        if (dec === VERIFY_PLAINTEXT) key = legacyKey
      } catch {}
    }
    if (!key) return { ok: false, entries: [] }

    const entries: Array<{id: string; code: string; cvv: string|null}> = []
    let failed = 0
    for (const v of e2eeVouchers) {
      try {
        const code = v.code && isEncryptedField(v.code) ? await decryptField(key, v.code) : (v.code ?? '')
        const cvv  = v.cvv  && isEncryptedField(v.cvv)  ? await decryptField(key, v.cvv)  : (v.cvv  ?? null)
        entries.push({ id: v.id, code, cvv })
      } catch { failed++ }
    }
    if (failed > 0) return { ok: false, entries: [] }

    // Atomic: plaintext rows + cleared meta + all wraps deleted in one transaction
    const { error } = await supabase.rpc('commit_vault_rekey', {
      p_salt: null,
      p_check: null,
      p_version: 2,
      p_wraps: [],
      p_entries: entries.map(e => ({ ...e, is_e2ee: false })),
    })
    if (error && isV2Vault()) return { ok: false, entries: [] }

    localStorage.removeItem(SALT_KEY)
    localStorage.removeItem(CHECK_KEY)
    localStorage.removeItem(HINT_KEY)
    localStorage.removeItem(VAULT_V2_FLAG)
    localStorage.removeItem(BIOMETRIC_WRAPPED_LOCAL)
    sessionStorage.removeItem(SESSION_PASS_KEY)
    sessionStorage.removeItem(SESSION_KEY_V2)
    clearDeviceVaultKey()
    setVaultKey(null)
    setHasVault(false)
    setHint(null)
    setNeedsMigration(false)
    setDoors(null)
    setDecryptedMap(new Map())

    return { ok: true, entries: error ? entries : [] }
  }, [user?.id])

  return (
    <E2EEContext.Provider value={{
      hasVault,
      isVaultUnlocked: vaultKey !== null,
      isUnifiedVault: isV2Vault(),
      hint,
      needsMigration,
      needsOAuthVaultSetup,
      pendingRecoveryPhrase,
      doors,
      passwordWrapStale,
      setupVault,
      setupVaultFromPassword,
      setupVaultWithMasterKey,
      unlockVault,
      unlockWithPassword,
      unlockVaultFromPassword,
      unlockVaultFromRecovery,
      lockVault,
      resetVault,
      migrateVault,
      enableBiometricVaultUnlock,
      unlockVaultWithBiometric,
      reDeriveVaultKeyFromPassword,
      rewrapPassword,
      regenerateRecoveryKey,
      refreshDoors,
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
