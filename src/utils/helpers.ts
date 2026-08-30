import { differenceInDays, format, isValid, parseISO } from 'date-fns'
import { he } from 'date-fns/locale'

// These helpers are called from everywhere without access to useT(), so they
// read the active locale directly. Locale changes re-render the whole tree
// (LocaleProvider context), which re-invokes them with the fresh value.
function currentLocale(): 'he' | 'en' {
  try { return (localStorage.getItem('gs_locale') as 'he' | 'en') || 'he' } catch { return 'he' }
}

export function formatCurrency(amount: number): string {
  const locale = currentLocale() === 'he' ? 'he-IL' : 'en-US'
  return `₪${amount.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatDate(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return dateStr
    return format(date, 'dd/MM/yyyy', { locale: he })
  } catch {
    return dateStr
  }
}

export function getDaysUntilExpiry(dateStr?: string): number | null {
  if (!dateStr) return null
  try {
    const date = parseISO(dateStr)
    if (!isValid(date)) return null
    return differenceInDays(date, new Date())
  } catch {
    return null
  }
}

export function getExpiryStatus(dateStr?: string): 'expired' | 'critical' | 'warning' | 'ok' | 'none' {
  const days = getDaysUntilExpiry(dateStr)
  if (days === null) return 'none'
  if (days < 0) return 'expired'
  if (days <= 7) return 'critical'
  if (days <= 14) return 'warning'
  return 'ok'
}

export function getExpiryLabel(dateStr?: string): string {
  const days = getDaysUntilExpiry(dateStr)
  if (days === null) return ''
  const en = currentLocale() === 'en'
  if (days < 0) return en ? 'Expired' : 'פג תוקף'
  if (days === 0) return en ? 'Expires today!' : 'פג היום!'
  if (days === 1) return en ? '1 day left' : 'נותר יום אחד'
  if (days <= 14) return en ? `${days} days left` : `נותרו ${days} ימים`
  return formatDate(dateStr)
}

export function isAlphanumeric(code: string): boolean {
  return /[A-Za-z]/.test(code)
}

// Single source of truth for "does this voucher match the search box".
// Previously four screens each searched a different subset of fields, so the
// same query found a voucher in one place and not another, and item_name was
// searchable nowhere. `resolveCode` lets callers pass the DECRYPTED code for
// E2EE vouchers (raw v.code is ciphertext); super-voucher store names can be
// folded in via `extraHaystack`.
export function voucherMatchesQuery(
  v: {
    store_name: string; code: string; is_e2ee?: boolean
    categories?: string[]; tags?: string[]; notes?: string
    source?: string; item_name?: string
  },
  query: string,
  opts?: { resolveCode?: (v: any) => string; extraHaystack?: string },
): boolean {
  const q = query.toLowerCase().trim()
  if (!q) return true
  const code = opts?.resolveCode ? opts.resolveCode(v) : (v.is_e2ee ? '' : v.code)
  const parts: (string | undefined)[] = [
    v.store_name, code, v.notes, v.source, v.item_name, opts?.extraHaystack,
    ...(v.categories ?? []), ...(v.tags ?? []),
  ]
  return parts.some(p => p != null && p.toLowerCase().includes(q))
}

export function defaultExpiryDate(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() + 5)
  return d.toISOString().split('T')[0]
}

export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'אופנה': '#ec4899',
    'מזון': '#f97316',
    'אלקטרוניקה': '#3b82f6',
    'יופי': '#a855f7',
    'בית': '#84cc16',
    'ספורט': '#06b6d4',
    'נסיעות': '#f59e0b',
    'בידור': '#ef4444',
    'ילדים': '#8b5cf6',
    'בריאות': '#10b981',
    'ספרים': '#6366f1',
    'מסעדות': '#f97316',
    'סופר': '#22c55e',
    'מתנה': '#ec4899',
    'אחר': '#94a3b8',
  }
  return colors[category] || '#94a3b8'
}

export function getStoreInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}
