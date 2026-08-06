// Device-persistent storage for the unlocked vault key.
//
// The key is kept in IndexedDB as a NON-extractable CryptoKey object: the page can
// use it to encrypt/decrypt, but no script (including XSS) can export the raw bytes.
// This is what makes "the vault stays open on this device" reasonably safe in a PWA —
// it is the browser equivalent of an app storing a key in device storage.
//
// The store is per-user; it is cleared on explicit lock, sign-out, vault disable,
// or when the user turns the preference off in Settings → Privacy.

const DB_NAME = 'gs-vault'
const DB_VERSION = 1
const STORE = 'keys'

const PERSIST_PREF_KEY = 'gs_vault_persist'

/** User preference — defaults to ON (smooth unlock). */
export function isVaultPersistEnabled(): boolean {
  return localStorage.getItem(PERSIST_PREF_KEY) !== 'false'
}

export function setVaultPersistEnabled(enabled: boolean) {
  localStorage.setItem(PERSIST_PREF_KEY, enabled ? 'true' : 'false')
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

/** Import raw key bytes as a non-extractable AES-GCM key and store it for this user. */
export async function saveDeviceVaultKey(userId: string, rawKeyB64: string): Promise<void> {
  if (!('indexedDB' in window)) return
  try {
    const binary = atob(rawKeyB64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const key = await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(key, userId)
    await txDone(tx)
    db.close()
  } catch {
    // best-effort — persistence failing must never block the unlock itself
  }
}

/** Load this user's stored vault key (or null). The result is non-extractable. */
export async function loadDeviceVaultKey(userId: string): Promise<CryptoKey | null> {
  if (!('indexedDB' in window)) return null
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(userId)
    const key = await new Promise<CryptoKey | null>((resolve, reject) => {
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null)
      req.onerror = () => reject(req.error)
    })
    db.close()
    return key instanceof CryptoKey ? key : null
  } catch {
    return null
  }
}

/** Remove the stored key — for one user, or for everyone when no id is given. */
export async function clearDeviceVaultKey(userId?: string): Promise<void> {
  if (!('indexedDB' in window)) return
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    if (userId) tx.objectStore(STORE).delete(userId)
    else tx.objectStore(STORE).clear()
    await txDone(tx)
    db.close()
  } catch { /* best-effort cleanup */ }
}
