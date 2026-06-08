// WebAuthn / Passkey local biometric app lock
// This uses the platform authenticator (Face ID, fingerprint, Windows Hello)
// as a local gate — the Supabase session remains valid, biometric just unlocks the UI.
//
// V2 additions: WebAuthn PRF extension to securely wrap/unwrap the E2EE vault key
// so biometric auth can also open the vault without a separate passphrase.

import { wrapVaultKey, unwrapVaultKey } from './e2ee'
import { supabase } from './supabase'

const CREDENTIAL_KEY = 'biometric_credential_id'
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled'
const BIOMETRIC_EMAIL_KEY = 'biometric_email'
const BIOMETRIC_WRAPPED_VAULT_KEY = 'gs_e2ee_biometric_wrapped_v2'
const BIOMETRIC_NATIVE_KEY = 'gs_biometric_native' // true only when registered on THIS device

// Fixed PRF input — same string used for both registration and assertion
const PRF_EVAL_INPUT = new TextEncoder().encode('GiftSmart-VaultKey-v2')

export function isBiometricSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof navigator.credentials?.create === 'function'
  )
}

export function isBiometricEnabled(): boolean {
  return localStorage.getItem(BIOMETRIC_ENABLED_KEY) === 'true'
}

export function getBiometricEmail(): string | null {
  return localStorage.getItem(BIOMETRIC_EMAIL_KEY)
}

export function hasBiometricWrappedVaultKey(): boolean {
  return !!localStorage.getItem(BIOMETRIC_WRAPPED_VAULT_KEY)
}

// Returns true if biometric was registered natively on THIS device (not just synced from Supabase)
export function isBiometricNative(): boolean {
  return localStorage.getItem(BIOMETRIC_NATIVE_KEY) === 'true'
}

// Clears biometric everywhere: this device + Supabase (all other synced devices lose it too).
// Use only when the credential is genuinely broken on the device that owns it.
export function disableBiometric() {
  localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
  localStorage.removeItem(CREDENTIAL_KEY)
  localStorage.removeItem(BIOMETRIC_EMAIL_KEY)
  localStorage.removeItem(BIOMETRIC_WRAPPED_VAULT_KEY)
  localStorage.removeItem(BIOMETRIC_NATIVE_KEY)
  // Clear from Supabase so other synced devices also lose the credential reference
  ;(async () => { try { await supabase.rpc('clear_biometric_meta') } catch {} })()
}

// Clears biometric from this device's localStorage ONLY — leaves Supabase intact so
// the credential keeps working on the device where it was originally registered.
// Use when fallback-to-password on a device that never had the private key locally.
export function disableBiometricLocally() {
  localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
  localStorage.removeItem(CREDENTIAL_KEY)
  localStorage.removeItem(BIOMETRIC_EMAIL_KEY)
  localStorage.removeItem(BIOMETRIC_WRAPPED_VAULT_KEY)
  localStorage.removeItem(BIOMETRIC_NATIVE_KEY)
}

// Restore biometric metadata from Supabase onto this device (called before first auth attempt).
// Returns true if metadata was found and restored.
export async function syncBiometricFromSupabase(): Promise<boolean> {
  try {
    const { data } = await supabase.rpc('get_biometric_meta')
    const row = Array.isArray(data) ? data[0] : data
    if (!row?.biometric_credential_id) return false
    localStorage.setItem(CREDENTIAL_KEY, row.biometric_credential_id)
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true')
    if (row.biometric_wrapped_vault_key) {
      localStorage.setItem(BIOMETRIC_WRAPPED_VAULT_KEY, row.biometric_wrapped_vault_key)
    }
    return true
  } catch {
    return false
  }
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(b => (str += String.fromCharCode(b)))
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToUint8Array(b64u: string): Uint8Array {
  const base64 = b64u.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  const binary = atob(padded)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
  return buffer
}

// Register biometric credential. If vaultKey is provided, also wraps it via the
// PRF extension so subsequent biometric logins can unlock the vault automatically.
export async function registerBiometric(userId: string, userName: string, email?: string): Promise<boolean> {
  return registerBiometricWithVault(userId, userName, null, email)
}

export async function registerBiometricWithVault(
  userId: string,
  userName: string,
  vaultKey: CryptoKey | null,
  email?: string,
): Promise<boolean> {
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'ארנק שוברים', id: window.location.hostname },
        user: {
          id: new TextEncoder().encode(userId),
          name: userName,
          displayName: userName,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' },  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        extensions: {
          prf: { eval: { first: PRF_EVAL_INPUT.buffer as ArrayBuffer } },
        },
      },
    }) as PublicKeyCredential | null

    if (!credential) return false

    const credId = base64url(credential.rawId)
    let wrappedKey: string | null = null

    // If PRF output is available and vault key provided, wrap the vault key
    if (vaultKey) {
      const ext = credential.getClientExtensionResults() as Record<string, unknown>
      const prfFirst = (ext?.prf as Record<string, unknown> | undefined)
        ?.results as Record<string, unknown> | undefined
      const prfOutput = prfFirst?.first as ArrayBuffer | undefined

      if (prfOutput && prfOutput.byteLength >= 32) {
        wrappedKey = await wrapVaultKey(vaultKey, new Uint8Array(prfOutput))
        localStorage.setItem(BIOMETRIC_WRAPPED_VAULT_KEY, wrappedKey)
      }
    }

    localStorage.setItem(CREDENTIAL_KEY, credId)
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true')
    localStorage.setItem(BIOMETRIC_NATIVE_KEY, 'true')  // private key lives on THIS device
    if (email) localStorage.setItem(BIOMETRIC_EMAIL_KEY, email)

    // Sync to Supabase so other devices with the same synced passkey can restore metadata
    ;(async () => {
      try {
        await supabase.rpc('upsert_biometric_meta', {
          p_credential_id: credId,
          p_wrapped_vault_key: wrappedKey,
        })
      } catch {}
    })()

    return true
  } catch (err) {
    console.error('Biometric register error:', err)
    return false
  }
}

// Standard biometric check (UI gate only). Returns true/false.
export async function verifyBiometric(): Promise<boolean> {
  const result = await verifyBiometricForVaultUnlock()
  return result.authenticated
}

// Biometric check that also tries to unwrap the vault key via PRF.
// Returns { authenticated, vaultKey, prfBytes }
// - vaultKey: unwrapped key if a stored wrapped key was found; null otherwise
// - prfBytes: raw PRF output bytes when available (even if no stored wrapped key exists);
//   callers can store these in sessionStorage so the vault key can be wrapped after the
//   next manual unlock, enabling future automatic PRF-based unlocks.
export async function verifyBiometricForVaultUnlock(): Promise<{
  authenticated: boolean
  vaultKey: CryptoKey | null
  prfBytes: Uint8Array | null
}> {
  try {
    const credId = localStorage.getItem(CREDENTIAL_KEY)
    if (!credId) return { authenticated: false, vaultKey: null, prfBytes: null }

    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const baseOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      rpId: window.location.hostname,
      allowCredentials: [
        {
          id: base64urlToUint8Array(credId).buffer as ArrayBuffer,
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    }

    // Try assertion with PRF extension first.
    // If the browser throws (unsupported extension), fall back to a plain assertion.
    let credential: PublicKeyCredential | null = null
    let prfOutput: ArrayBuffer | undefined

    try {
      credential = await navigator.credentials.get({
        publicKey: {
          ...baseOptions,
          extensions: {
            prf: { eval: { first: PRF_EVAL_INPUT.buffer as ArrayBuffer } },
          },
        },
      }) as PublicKeyCredential | null

      if (credential) {
        const ext = credential.getClientExtensionResults() as Record<string, unknown>
        const prfFirst = (ext?.prf as Record<string, unknown> | undefined)
          ?.results as Record<string, unknown> | undefined
        prfOutput = prfFirst?.first as ArrayBuffer | undefined
      }
    } catch {
      // PRF extension caused an error — retry without it so auth still works
      credential = await navigator.credentials.get({
        publicKey: baseOptions,
      }) as PublicKeyCredential | null
    }

    if (!credential) return { authenticated: false, vaultKey: null, prfBytes: null }

    // Try to unwrap vault key via PRF output (only if PRF was supported)
    let vaultKey: CryptoKey | null = null
    const wrappedKey = localStorage.getItem(BIOMETRIC_WRAPPED_VAULT_KEY)
    if (wrappedKey && prfOutput && prfOutput.byteLength >= 32) {
      try {
        vaultKey = await unwrapVaultKey(wrappedKey, new Uint8Array(prfOutput))
      } catch {}
    }

    const prfBytes = prfOutput && prfOutput.byteLength >= 32 ? new Uint8Array(prfOutput) : null
    return { authenticated: true, vaultKey, prfBytes }
  } catch (err) {
    console.error('Biometric verify error:', err)
    return { authenticated: false, vaultKey: null, prfBytes: null }
  }
}
