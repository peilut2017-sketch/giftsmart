import { supabase } from './supabase'
import { SESSION_KEY_V2 } from './vaultBundle'

/**
 * Zero-plaintext account merge for guest E2EE vouchers.
 *
 * A guest's encrypted fields are sealed under the guest vault's master key,
 * which dies with the anonymous account when the merge completes. The rows
 * therefore move to the target account STILL SEALED — the server never sees a
 * plaintext code at any point. To keep them readable, the guest vault key is
 * parked ON THIS DEVICE (localStorage — the same device that already holds the
 * open vault) for the duration of the switch; right after the merge the target
 * account decrypts with the parked key and immediately re-seals every field
 * under its OWN vault (see the re-seal handler in App.tsx), then the parked
 * key is wiped. If the target vault isn't open yet (e.g. Google login), the
 * parked key and the row ids simply wait — both survive restarts — and the
 * re-seal runs the moment the vault opens.
 */

export const GUEST_MERGE_KEY = 'gs_merge_guest_key'
export const MERGE_RESEAL_IDS = 'gs_merge_reseal_ids'

export type GuestMergePrep = 'ok' | 'locked' | 'error'

/** Park the guest vault key before logging into an existing account.
    'locked' = the guest vault must be opened first (nothing was changed). */
export async function parkGuestVaultKeyForMerge(): Promise<GuestMergePrep> {
  try {
    const { data: rows, error } = await supabase
      .from('vouchers')
      .select('id')
      .eq('is_e2ee', true)
      .limit(1)
    if (error) return 'error'
    if (!rows || rows.length === 0) {
      localStorage.removeItem(GUEST_MERGE_KEY)
      return 'ok' // nothing sealed — nothing to carry
    }
    const b64 = sessionStorage.getItem(SESSION_KEY_V2)
    if (!b64) return 'locked'
    localStorage.setItem(GUEST_MERGE_KEY, b64)
    return 'ok'
  } catch {
    return 'error'
  }
}

export function readParkedGuestKey(): string | null {
  try { return localStorage.getItem(GUEST_MERGE_KEY) } catch { return null }
}

export function storeResealIds(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(MERGE_RESEAL_IDS, JSON.stringify(ids))
  } catch { /* storage unavailable */ }
}

export function readResealIds(): string[] {
  try {
    const raw = localStorage.getItem(MERGE_RESEAL_IDS)
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) ? ids : []
  } catch { return [] }
}

export function clearMergeArtifacts() {
  try {
    localStorage.removeItem(GUEST_MERGE_KEY)
    localStorage.removeItem(MERGE_RESEAL_IDS)
  } catch { /* storage unavailable */ }
}
