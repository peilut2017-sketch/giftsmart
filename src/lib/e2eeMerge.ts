import { supabase } from './supabase'
import { importVaultKey, decryptField, isEncryptedField } from './e2ee'
import { SESSION_KEY_V2 } from './vaultBundle'

export type GuestMergePrep = 'ok' | 'locked' | 'error'

/**
 * Runs BEFORE a guest logs into an EXISTING account.
 *
 * A guest's E2EE codes are sealed under the guest vault's master key, and that
 * vault dies with the anonymous account once the merge completes — the merged
 * rows would become permanently unreadable. So, while this device still holds
 * the open guest vault, the encrypted fields are unsealed back into the rows;
 * immediately after the merge the target account re-seals them under ITS own
 * vault (see the gs-merge-completed handler in App.tsx). The server-side
 * claim_merge_ticket refuses to merge while sealed rows remain, so this can
 * never be skipped silently.
 *
 * Requires the guest vault to be open in this tab ('locked' otherwise —
 * the caller offers the unlock sheet and retries).
 */
export async function prepareGuestE2EEForMerge(): Promise<GuestMergePrep> {
  try {
    const { data: rows, error } = await supabase
      .from('vouchers')
      .select('id, code, cvv')
      .eq('is_e2ee', true)
    if (error) return 'error'
    if (!rows || rows.length === 0) return 'ok'

    const b64 = sessionStorage.getItem(SESSION_KEY_V2)
    if (!b64) return 'locked'
    const key = await importVaultKey(b64)

    for (const r of rows) {
      const code = isEncryptedField(r.code) ? await decryptField(key, r.code) : r.code
      const cvv = r.cvv && isEncryptedField(r.cvv) ? await decryptField(key, r.cvv) : r.cvv
      const { error: upErr } = await supabase
        .from('vouchers')
        .update({ code, cvv, is_e2ee: false })
        .eq('id', r.id)
      if (upErr) return 'error'
    }
    return 'ok'
  } catch {
    // Includes a failed decrypt (stale key) — abort the login, nothing was lost.
    return 'error'
  }
}
