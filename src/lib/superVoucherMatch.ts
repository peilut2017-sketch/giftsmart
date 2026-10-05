// Picks the super voucher a newly added voucher belongs to, by store name.
// 1. Exact (case-insensitive) match on the full name wins, as before.
// 2. Backward compatibility for renamed catalog vouchers: a voucher linked to a
//    catalog product also matches that product's previous name(s) listed below
//    (only the old Giftzone name today). The match is by catalog_product_key,
//    not by the display name, and only when exactly one super voucher carries
//    that key, so a name can never link to a different voucher or list.
// Aliases, search terms and partial names are never used.
const LEGACY_NAMES: Record<string, string[]> = {
  giftzone: ['גיפטזון'],
}

export function findSuperVoucherByName<T extends { name: string; catalog_product_key?: string | null }>(
  superVouchers: T[],
  storeName: string,
): T | undefined {
  const q = storeName.trim().toLowerCase()
  if (!q) return undefined
  const exact = superVouchers.find(sv => sv.name.toLowerCase() === q)
  if (exact) return exact
  const keys = Object.keys(LEGACY_NAMES).filter(k => LEGACY_NAMES[k].some(n => n.toLowerCase() === q))
  for (const key of keys) {
    const withKey = superVouchers.filter(sv => sv.catalog_product_key === key)
    if (withKey.length === 1) return withKey[0]
  }
  return undefined
}
