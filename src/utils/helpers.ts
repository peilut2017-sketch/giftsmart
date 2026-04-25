import { differenceInDays, format, isValid, parseISO } from 'date-fns'
import { he } from 'date-fns/locale'

export function formatCurrency(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
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
  if (days < 0) return 'פג תוקף'
  if (days === 0) return 'פג היום!'
  if (days === 1) return 'נותר יום אחד'
  if (days <= 14) return `נותרו ${days} ימים`
  return formatDate(dateStr)
}

export function isAlphanumeric(code: string): boolean {
  return /[A-Za-z]/.test(code)
}

export function generateId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
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

/**
 * Parses a combined "amount + store name" input string.
 * Examples:
 *   "150 קופיקס"  → { amount: 150, storeName: "קופיקס" }
 *   "150"         → { amount: 150, storeName: null }
 *   "קופיקס 150"  → { amount: 150, storeName: "קופיקס" }
 *   "150.5 רמי לוי" → { amount: 150.5, storeName: "רמי לוי" }
 */
export function parseBalanceInput(input: string): { amount: number | null; storeName: string | null } {
  const trimmed = input.trim()
  if (!trimmed) return { amount: null, storeName: null }
  const numberMatch = trimmed.match(/\d+([.,]\d+)?/)
  if (!numberMatch) return { amount: null, storeName: null }
  const amount = parseFloat(numberMatch[0].replace(',', '.'))
  const storeName = trimmed.replace(numberMatch[0], '').trim() || null
  return { amount, storeName }
}
