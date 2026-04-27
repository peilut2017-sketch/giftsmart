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
