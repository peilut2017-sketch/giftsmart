export const E2EE_PREFIX = 'e2ee:'

export function isEncryptedField(value: string | null | undefined): boolean {
  return !!value && value.startsWith(E2EE_PREFIX)
}

function b64(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8))
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

// Legacy: derive key from passphrase alone (backward compat for old vaults)
export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

// Derive vault key from login password + userId (salt includes userId for per-account uniqueness).
// The key is extractable so it can be wrapped by PRF/recovery mechanisms.
export async function deriveVaultKey(
  password: string,
  userId: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const userIdBytes = new TextEncoder().encode(userId)
  const combinedSalt = new Uint8Array(userIdBytes.length + salt.length)
  combinedSalt.set(userIdBytes)
  combinedSalt.set(salt, userIdBytes.length)

  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: combinedSalt.buffer as ArrayBuffer, iterations: 100_000, hash: 'SHA-256' },
    raw,
    { name: 'AES-GCM', length: 256 },
    true, // extractable — required for AES-KW wrapping
    ['encrypt', 'decrypt'],
  )
}

// Export vault key to base64 for sessionStorage persistence
export async function exportVaultKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key)
  return b64(new Uint8Array(raw))
}

// Import vault key from base64 (from sessionStorage)
export async function importVaultKey(b64str: string): Promise<CryptoKey> {
  const bytes = unb64(b64str)
  return crypto.subtle.importKey(
    'raw',
    bytes.buffer as ArrayBuffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

// Wrap vault key with 32-byte key material (PRF output or recovery-derived bytes).
// Uses AES-KW — the result is stored in localStorage.
export async function wrapVaultKey(vaultKey: CryptoKey, keyMaterial: Uint8Array): Promise<string> {
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial.slice(0, 32).buffer as ArrayBuffer,
    'AES-KW',
    false,
    ['wrapKey'],
  )
  const wrapped = await crypto.subtle.wrapKey('raw', vaultKey, wrappingKey, 'AES-KW')
  return b64(new Uint8Array(wrapped))
}

// Unwrap vault key using the same 32-byte key material
export async function unwrapVaultKey(wrappedB64: string, keyMaterial: Uint8Array): Promise<CryptoKey> {
  const wrappingKey = await crypto.subtle.importKey(
    'raw',
    keyMaterial.slice(0, 32).buffer as ArrayBuffer,
    'AES-KW',
    false,
    ['unwrapKey'],
  )
  const wrappedBytes = unb64(wrappedB64)
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedBytes.buffer as ArrayBuffer,
    wrappingKey,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  )
}

const RECOVERY_ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Canonical phrase → KDF-input bytes. ONE function used by both generation and
// recovery. (v2 had two divergent paths: setup fed the raw 18 random bytes to the
// KDF while recovery fed 24 alphabet indexes — different length AND content, so
// unwrapping failed 100% of the time and the recovery phrase never worked at all.)
export function recoveryPhraseToBytes(phrase: string): Uint8Array {
  const norm = phrase.replace(/[\s-]/g, '').toUpperCase()
  const vals = Array.from(norm).map(c => RECOVERY_ALPHA.indexOf(c))
  if (vals.length !== 24 || vals.some(v => v < 0)) throw new Error('invalid recovery phrase')
  return new Uint8Array(vals)
}

// Generate a recovery phrase: 24 chars (5 bits each = 120 bits of entropy) from an
// unambiguous alphabet (no 0/O, 1/I/L confusion), shown as 6 groups of 4.
export function generateRecoverySecret(): { phrase: string; bytes: Uint8Array } {
  const rnd = crypto.getRandomValues(new Uint8Array(24))
  const raw = Array.from(rnd).map(b => RECOVERY_ALPHA[b % 32]).join('')
  const phrase = raw.match(/.{1,4}/g)!.join('-')
  // bytes are derived FROM the phrase so setup and recovery share one code path
  return { phrase, bytes: recoveryPhraseToBytes(phrase) }
}

// Derive a 32-byte wrapping key from recovery phrase bytes via PBKDF2
export async function deriveRecoveryWrapKey(recoveryBytes: Uint8Array): Promise<Uint8Array> {
  const raw = await crypto.subtle.importKey(
    'raw',
    recoveryBytes.buffer as ArrayBuffer,
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('GiftSmart-recovery-v2').buffer as ArrayBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    raw,
    256,
  )
  return new Uint8Array(bits)
}

// Returns "e2ee:<iv_b64>:<ct_b64>"
export async function encryptField(key: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
    key,
    new TextEncoder().encode(plaintext),
  )
  return `${E2EE_PREFIX}${b64(iv)}:${b64(new Uint8Array(ct))}`
}

// Decrypts "e2ee:<iv_b64>:<ct_b64>"
export async function decryptField(key: CryptoKey, encrypted: string): Promise<string> {
  if (!encrypted.startsWith(E2EE_PREFIX)) return encrypted
  const rest = encrypted.slice(E2EE_PREFIX.length)
  const colonIdx = rest.indexOf(':')
  if (colonIdx < 0) throw new Error('bad e2ee format')
  const iv = unb64(rest.slice(0, colonIdx))
  const ct = unb64(rest.slice(colonIdx + 1))
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv.buffer as ArrayBuffer }, key, ct.buffer as ArrayBuffer)
  return new TextDecoder().decode(plain)
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

// ── Vault v3: envelope encryption ───────────────────────────────────────────
// One random master key (MK) encrypts the data; the login password / recovery
// phrase / passkey PRF each open a server-stored "wrap" of MK. Deriving keys
// FROM the password (v2) meant password changes had to re-encrypt every voucher;
// wrapping a random MK makes them a single small re-wrap instead.

export const KEK_ITERATIONS = 600_000 // OWASP 2023+ for PBKDF2-SHA256

// Random master key. Extractable so it can be AES-KW-wrapped per door.
export async function generateMasterKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

// Derive the password door's key-encryption-key. Salt is per-wrap (stored in the
// wrap's kdf metadata), combined with userId for cross-account uniqueness.
export async function deriveKek(
  password: string,
  userId: string,
  salt: Uint8Array,
  iterations: number = KEK_ITERATIONS,
): Promise<Uint8Array> {
  const userIdBytes = new TextEncoder().encode(userId)
  const combinedSalt = new Uint8Array(userIdBytes.length + salt.length)
  combinedSalt.set(userIdBytes)
  combinedSalt.set(salt, userIdBytes.length)

  const raw = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: combinedSalt.buffer as ArrayBuffer, iterations, hash: 'SHA-256' },
    raw,
    256,
  )
  return new Uint8Array(bits)
}

export function saltToB64(salt: Uint8Array): string { return b64(salt) }
export function saltFromB64(s: string): Uint8Array { return unb64(s) }
