import { differenceInCalendarDays, format, isValid, parseISO } from 'date-fns'
import { he } from 'date-fns/locale'

// These helpers are called from everywhere without access to useT(), so they
// read the active locale directly. Locale changes re-render the whole tree
// (LocaleProvider context), which re-invokes them with the fresh value.
function currentLocale(): 'he' | 'en' {
  try { return (localStorage.getItem('gs_locale') as 'he' | 'en') || 'he' } catch { return 'he' }
}

export function formatCurrency(amount: number | null | undefined): string {
  // Guard null/undefined/NaN: callers pass voucher.balance directly, and a single
  // bad/legacy row used to throw here or render "₪NaN".
  const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : Number(amount)
  const safe = Number.isFinite(n) ? n : 0
  const locale = currentLocale() === 'he' ? 'he-IL' : 'en-US'
  return `₪${safe.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
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
    // differenceInCalendarDays counts calendar-day boundaries crossed, not full
    // 24-hour periods — differenceInDays (used previously) under-counted by 1
    // for any "now" after local midnight, e.g. a voucher expiring in 5 calendar
    // days showed "4 days left" once the clock passed 00:00 on the current day.
    return differenceInCalendarDays(date, new Date())
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
  d.setFullYear(d.getFullYear() + 1)
  return d.toISOString().split('T')[0]
}

// Darkened from the raw Tailwind-500 shades: those read fine as decoration but every
// one of them fell short of 4.5:1 for the white text/icons rendered directly on top of
// them (store-avatar circles, category chips) — same hue, just deep enough to read.
export function getCategoryColor(category: string): string {
  const colors: Record<string, string> = {
    'אופנה': '#e0177a',
    'מזון': '#c35305',
    'אלקטרוניקה': '#1e6ff5',
    'יופי': '#9e42f6',
    'בית': '#54820e',
    'ספורט': '#047f94',
    'נסיעות': '#a36907',
    'בידור': '#eb1515',
    'ילדים': '#8452f5',
    'בריאות': '#0c855d',
    'ספרים': '#5e61f1',
    'מסעדות': '#c35305',
    'סופר': '#178841',
    'מתנה': '#e0177a',
    'אחר': '#627793',
  }
  return colors[category] || '#627793'
}

export function getStoreInitials(name: string): string {
  return name.slice(0, 2).toUpperCase()
}

// Quote a CSV cell AND neutralize spreadsheet formula injection: a user-controlled
// value like "=HYPERLINK(...)" or "@SUM(...)" executes as a formula when the CSV is
// opened in Excel/Sheets. Prefixing a leading =,+,-,@,tab,CR with an apostrophe
// makes the cell inert text.
export function csvCell(value: unknown): string {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return `"${s.replace(/"/g, '""')}"`
}
