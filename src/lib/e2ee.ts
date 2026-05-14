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

// Generate a recovery secret: 18 random bytes → displayed as 6 groups of 4 chars
// using an unambiguous alphabet (no 0/O, 1/I/L confusion).
export function generateRecoverySecret(): { phrase: string; bytes: Uint8Array } {
  const bytes = crypto.getRandomValues(new Uint8Array(18)) // 144 bits of entropy
  const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const raw = Array.from(bytes).map(b => ALPHA[b % 32]).join('')
  // Format: AAAA-BBBB-CCCC-DDDD-EEEE-FFFF  (24 chars + 5 dashes)
  const phrase = raw.match(/.{1,4}/g)!.join('-')
  return { phrase, bytes }
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

export function saltToB64(salt: Uint8Array): string { return b64(salt) }
export function saltFromB64(s: string): Uint8Array { return unb64(s) }
