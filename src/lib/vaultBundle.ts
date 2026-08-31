// Vault v3 bundle layer — provider-free so it can run from AuthPage/BiometricGate
// (which mount OUTSIDE E2EEProvider) as well as from E2EEContext itself.
//
// Model: one random master key (MK) encrypts all E2EE fields. The server stores
// "wraps" of MK — copies encrypted under keys only the user holds (login-password
// KEK, recovery phrase, passkey PRF). Storing every wrap server-side is safe and
// is exactly what makes new-device unlock and real recovery work.

import { supabase } from './supabase'
import { clearDeviceVaultKey } from './vaultKeyStore'
import {
  deriveKek,
  deriveVaultKey,
  deriveRecoveryWrapKey,
  generateRecoverySecret,
  recoveryPhraseToBytes,
  wrapVaultKey,
  unwrapVaultKey,
  decryptField,
  exportVaultKey,
  generateSalt,
  saltToB64,
  saltFromB64,
  KEK_ITERATIONS,
} from './e2ee'

export const VERIFY_PLAINTEXT = 'GiftSmart-E2EE-OK'

// sessionStorage keys shared with E2EEContext
export const SESSION_KEY_V2 = 'gs_e2ee_key_v2'          // exported MK bytes (base64)
export const PENDING_PHRASE_KEY = 'gs_e2ee_pending_phrase' // recovery phrase awaiting one-time display
export const PW_STALE_KEY = 'gs_vault_pw_stale'         // login password valid but no longer opens the vault

// localStorage cache keys (mirrors of server meta, same names as v2)
const SALT_KEY = 'gs_e2ee_salt'
const CHECK_KEY = 'gs_e2ee_chk'
const VAULT_V2_FLAG = 'gs_e2ee_v2'
const BIOMETRIC_WRAPPED_LOCAL = 'gs_e2ee_biometric_wrapped_v2'
const BIOMETRIC_CRED_LOCAL = 'biometric_credential_id'

// Wipe ALL in-memory/device vault key material. Callable from AuthContext.signOut
// (which lives OUTSIDE E2EEProvider), because E2EEProvider unmounts the instant
// `user` becomes null — so its own `!user` cleanup effect never runs on sign-out,
// which used to leave the exported AES master key sitting in sessionStorage after
// an in-tab sign-out (and readable by the next account signing in on the same tab).
export function wipeVaultSessionKeys(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY_V2)
    sessionStorage.removeItem(PENDING_PHRASE_KEY)
    sessionStorage.removeItem(PW_STALE_KEY)
    sessionStorage.removeItem('gs_e2ee_session')   // legacy plain passphrase
    sessionStorage.removeItem('gs_vault_migrate_pw') // legacy migration helper
  } catch { /* sessionStorage unavailable — nothing cached to wipe */ }
  // IndexedDB device-persisted key (best-effort, async)
  void clearDeviceVaultKey()
}

export interface VaultWrapKdf {
  v?: number
  alg?: string
  iter?: number
  salt?: string
}

export interface VaultWrap {
  method: 'password' | 'recovery' | 'prf' | 'device'
  slot_id: string
  wrapped_mk: string
  kdf: VaultWrapKdf
}

export interface VaultBundle {
  vault_salt: string | null
  vault_check: string | null
  vault_version: number
  wraps: VaultWrap[]
}

// ── Fetch ───────────────────────────────────────────────────────────────────

// Reads meta + all wraps in one round trip. Falls back to the v2 RPCs when the
// v3 SQL migration hasn't been applied yet, so the client is safe to ship first.
export async function fetchVaultBundle(): Promise<VaultBundle | null> {
  try {
    const { data, error } = await supabase.rpc('get_vault_bundle')
    if (!error && data) {
      const b = data as VaultBundle
      if (!b.vault_check) return null
      return { ...b, wraps: Array.isArray(b.wraps) ? b.wraps : [] }
    }
  } catch { /* fall through to v2 */ }

  try {
    const { data } = await supabase.rpc('get_vault_meta')
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.vault_salt || !row?.vault_check) return null
    const wraps: VaultWrap[] = []
    try {
      const { data: bio } = await supabase.rpc('get_biometric_meta')
      const bioRow = Array.isArray(bio) ? bio[0] : bio
      if (bioRow?.biometric_wrapped_vault_key) {
        wraps.push({
          method: 'prf',
          slot_id: bioRow.biometric_credential_id ?? '',
          wrapped_mk: bioRow.biometric_wrapped_vault_key,
          kdf: { v: 2 },
        })
      }
    } catch {}
    return { vault_salt: row.vault_salt, vault_check: row.vault_check, vault_version: 2, wraps }
  } catch {}
  return null
}

export function cacheBundleMeta(bundle: VaultBundle) {
  if (bundle.vault_salt) localStorage.setItem(SALT_KEY, bundle.vault_salt)
  if (bundle.vault_check) localStorage.setItem(CHECK_KEY, bundle.vault_check)
  localStorage.setItem(VAULT_V2_FLAG, 'true')
}

// ── Wrap builders ───────────────────────────────────────────────────────────

export async function buildPasswordWrap(mk: CryptoKey, password: string, userId: string): Promise<VaultWrap> {
  const salt = generateSalt()
  const kek = await deriveKek(password, userId, salt, KEK_ITERATIONS)
  return {
    method: 'password',
    slot_id: '',
    wrapped_mk: await wrapVaultKey(mk, kek),
    kdf: { v: 3, alg: 'PBKDF2-SHA256', iter: KEK_ITERATIONS, salt: saltToB64(salt) },
  }
}

export async function buildRecoveryWrap(mk: CryptoKey): Promise<{ wrap: VaultWrap; phrase: string }> {
  const { phrase, bytes } = generateRecoverySecret()
  const wrapKey = await deriveRecoveryWrapKey(bytes)
  return {
    wrap: { method: 'recovery', slot_id: '', wrapped_mk: await wrapVaultKey(mk, wrapKey), kdf: { v: 3 } },
    phrase,
  }
}

export async function upsertWrap(wrap: VaultWrap): Promise<boolean> {
  const { error } = await supabase.rpc('upsert_vault_wrap', {
    p_method: wrap.method,
    p_slot_id: wrap.slot_id,
    p_wrapped_mk: wrap.wrapped_mk,
    p_kdf: wrap.kdf,
  })
  return !error
}

// ── Unlock attempts ─────────────────────────────────────────────────────────

async function verifyKey(key: CryptoKey, check: string): Promise<boolean> {
  try {
    return (await decryptField(key, check)) === VERIFY_PLAINTEXT
  } catch {
    return false
  }
}

export async function tryUnlockWithPassword(
  bundle: VaultBundle,
  password: string,
  userId: string,
): Promise<{ key: CryptoKey; via: 'wrap' | 'v2' } | null> {
  const check = bundle.vault_check
  if (!check) return null

  const pw = bundle.wraps.find(w => w.method === 'password')
  if (pw?.kdf?.salt) {
    try {
      const kek = await deriveKek(password, userId, saltFromB64(pw.kdf.salt), pw.kdf.iter ?? KEK_ITERATIONS)
      const key = await unwrapVaultKey(pw.wrapped_mk, kek)
      if (await verifyKey(key, check)) return { key, via: 'wrap' }
    } catch {}
  }

  // v2 fallback: MK was derived directly from the login password
  if (bundle.vault_salt) {
    try {
      const key = await deriveVaultKey(password, userId, saltFromB64(bundle.vault_salt))
      if (await verifyKey(key, check)) return { key, via: 'v2' }
    } catch {}
  }
  return null
}

export async function tryUnlockWithRecovery(bundle: VaultBundle, phrase: string): Promise<CryptoKey | null> {
  const check = bundle.vault_check
  if (!check) return null
  const rec = bundle.wraps.find(w => w.method === 'recovery' && w.kdf?.v === 3)
  if (!rec) return null
  try {
    const bytes = recoveryPhraseToBytes(phrase)
    const wrapKey = await deriveRecoveryWrapKey(bytes)
    const key = await unwrapVaultKey(rec.wrapped_mk, wrapKey)
    if (await verifyKey(key, check)) return key
  } catch {}
  return null
}

export async function tryUnlockWithPrfBytes(bundle: VaultBundle, prfBytes: Uint8Array): Promise<CryptoKey | null> {
  const check = bundle.vault_check
  if (!check) return null
  for (const w of bundle.wraps) {
    if (w.method !== 'prf') continue
    try {
      const key = await unwrapVaultKey(w.wrapped_mk, prfBytes)
      if (await verifyKey(key, check)) return key
    } catch {}
  }
  return null
}

// ── v2 → v3 wrap migration ──────────────────────────────────────────────────
// Runs after any successful unlock. Purely additive: the current key becomes MK
// as-is (no ciphertext is rewritten), and the missing doors are created around it.
export async function ensureV3Wraps(
  mk: CryptoKey,
  userId: string,
  bundle: VaultBundle,
  password?: string,
): Promise<void> {
  let wrote = false

  if (password && !bundle.wraps.some(w => w.method === 'password' && w.kdf?.v === 3)) {
    const ok = await upsertWrap(await buildPasswordWrap(mk, password, userId))
    if (!ok) return // v3 SQL not applied yet — retry silently on a future unlock
    wrote = true
  }

  if (!bundle.wraps.some(w => w.method === 'recovery' && w.kdf?.v === 3)) {
    const { wrap, phrase } = await buildRecoveryWrap(mk)
    const ok = await upsertWrap(wrap)
    if (!ok) return
    // Shown once via RecoveryKeyModal at the next calm moment (provider reads this)
    sessionStorage.setItem(PENDING_PHRASE_KEY, phrase)
    wrote = true
  }

  // The existing biometric wrap already wraps this same key — copy it into the
  // wraps table so PRF unlock works from the bundle on any device.
  if (!bundle.wraps.some(w => w.method === 'prf' && w.kdf?.v === 3)) {
    const local = localStorage.getItem(BIOMETRIC_WRAPPED_LOCAL)
    const fromBundle = bundle.wraps.find(w => w.method === 'prf')
    const wrapped = local ?? fromBundle?.wrapped_mk
    const slot = localStorage.getItem(BIOMETRIC_CRED_LOCAL) ?? fromBundle?.slot_id ?? ''
    if (wrapped) {
      const ok = await upsertWrap({ method: 'prf', slot_id: slot, wrapped_mk: wrapped, kdf: { v: 3 } })
      if (ok) wrote = true
    }
  }

  if (wrote || bundle.vault_version < 3) {
    try { await supabase.rpc('set_vault_version', { p_version: 3 }) } catch {}
  }
}

// ── Login-time unlock (called from AuthPage / BiometricGate, pre-provider) ──
// Replaces the old gs_vault_pw_pending mechanism that parked the PLAINTEXT login
// password in sessionStorage: the unlock happens right here with the password in
// a local variable, and only the session key (same exposure as before) is stored.
export type LoginUnlockResult = 'unlocked' | 'no-vault' | 'stale' | 'error'

export async function attemptVaultUnlockAtLogin(password: string, userId: string): Promise<LoginUnlockResult> {
  try {
    const bundle = await fetchVaultBundle()
    if (!bundle) return 'no-vault'

    const res = await tryUnlockWithPassword(bundle, password, userId)
    if (!res) {
      // Auth accepted this password but it doesn't open the vault — the vault key
      // predates a password reset. Surfaced explicitly by the unlock sheet.
      sessionStorage.setItem(PW_STALE_KEY, '1')
      window.dispatchEvent(new Event('gs-vault-unlocked'))
      return 'stale'
    }

    sessionStorage.removeItem(PW_STALE_KEY)
    sessionStorage.setItem(SESSION_KEY_V2, await exportVaultKey(res.key))
    cacheBundleMeta(bundle)
    await ensureV3Wraps(res.key, userId, bundle, password)
    // E2EEProvider may already be mounted (its one-shot auto-unlock ran before this
    // finished) — poke it to re-read the session key.
    window.dispatchEvent(new Event('gs-vault-unlocked'))
    return 'unlocked'
  } catch {
    return 'error'
  }
}
