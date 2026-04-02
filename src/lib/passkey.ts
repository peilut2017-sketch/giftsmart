// WebAuthn / Passkey local biometric app lock
// This uses the platform authenticator (Face ID, fingerprint, Windows Hello)
// as a local gate — the Supabase session remains valid, biometric just unlocks the UI.

const CREDENTIAL_KEY = 'biometric_credential_id'
const BIOMETRIC_ENABLED_KEY = 'biometric_enabled'
const BIOMETRIC_EMAIL_KEY = 'biometric_email'

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

export function disableBiometric() {
  localStorage.removeItem(BIOMETRIC_ENABLED_KEY)
  localStorage.removeItem(CREDENTIAL_KEY)
  localStorage.removeItem(BIOMETRIC_EMAIL_KEY)
}

function base64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(b => (str += String.fromCharCode(b)))
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function base64urlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, '=')
  const binary = atob(padded)
  const buffer = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i)
  return buffer
}

export async function registerBiometric(userId: string, userName: string, email?: string): Promise<boolean> {
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
      },
    }) as PublicKeyCredential | null

    if (!credential) return false

    const credId = base64url(credential.rawId)
    localStorage.setItem(CREDENTIAL_KEY, credId)
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, 'true')
    if (email) localStorage.setItem(BIOMETRIC_EMAIL_KEY, email)
    return true
  } catch (err: any) {
    console.error('Biometric register error:', err)
    return false
  }
}

export async function verifyBiometric(): Promise<boolean> {
  try {
    const credId = localStorage.getItem(CREDENTIAL_KEY)
    if (!credId) return false

    const challenge = crypto.getRandomValues(new Uint8Array(32))
    const credential = await navigator.credentials.get({
      publicKey: {
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
      },
    }) as PublicKeyCredential | null

    return !!credential
  } catch (err: any) {
    console.error('Biometric verify error:', err)
    return false
  }
}
