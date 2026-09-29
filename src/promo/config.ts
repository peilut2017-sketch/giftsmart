/**
 * Everything a non-developer would want to tweak lives here:
 * captions, the dummy gift cards, colors and the closing CTA.
 *
 * ⚠ All vouchers, balances, codes and barcodes below are FAKE demo data.
 *   Never paste a real gift-card code or a real user's data into this file.
 */

// ── Brand tokens (mirrors src/index.css :root) ──────────────────────────────
export const BRAND = {
  green: '#22c55e',        // --c-primary-mid, theme-color
  greenDeep: '#117f3a',    // --c-primary (text-safe green)
  greenDark: '#15803d',    // --c-primary-dark
  greenLight: '#dcfce7',   // --c-primary-light
  purple: '#9333ea',       // logo accent
  bg: '#f8fafc',           // promo background
  appBg: '#f2f4f3',        // --c-bg (inside the phone)
  surface: '#ffffff',
  border: '#e0e8e6',
  text: '#0f1c1a',
  text2: '#4a6260',
  text3: '#5a726f',
  urgent: '#de1313',
  urgentBg: '#fef2f2',
}

// ── Captions ────────────────────────────────────────────────────────────────
// `at` / `out` are absolute seconds on the master timeline (see timeline.ts).
// `accent` colors a line green; `highlightWords` lights words one by one.
export interface CaptionLine {
  text: string
  at: number
  accent?: boolean
  sub?: boolean
  /** [wordIndex, time] pairs — the word turns green at that time. */
  highlightWords?: [number, number][]
}
export interface CaptionBlock { lines: CaptionLine[]; out: number }

export const CAPTIONS: CaptionBlock[] = [
  { out: 3.95, lines: [
    { text: 'כמה גיפט קארדים יש לך עכשיו?', at: 0.3 },
    { text: 'ואיפה הם?', at: 1.75, accent: true },
  ] },
  { out: 6.8, lines: [
    { text: 'הכירו את Gift Smart', at: 5.05 },
    { text: 'כל השוברים שלך. במקום אחד.', at: 5.4, sub: true },
  ] },
  { out: 9.95, lines: [
    { text: 'הכול מסודר.', at: 7.25 },
  ] },
  { out: 11.9, lines: [
    { text: 'יתרה. תוקף. קוד.', at: 10.1, highlightWords: [[0, 10.3], [1, 10.85], [2, 11.4]] },
  ] },
  { out: 16.85, lines: [
    { text: 'בקופה?', at: 12.15 },
    { text: 'השובר אצלך תוך שנייה.', at: 14.6, accent: true },
  ] },
  { out: 20.85, lines: [
    { text: 'השתמשת רק בחלק?', at: 17.15 },
    { text: 'היתרה נשארת איתך.', at: 19.45, accent: true },
  ] },
  { out: 24.8, lines: [
    { text: 'לא נותנים', at: 21.65 },
    { text: 'לכסף לפוג.', at: 21.85, accent: true },
  ] },
]

// ── Closing hero (scene 7) ──────────────────────────────────────────────────
export const HERO = {
  title: 'GiftSmart', // rendered as the app's two-tone wordmark (first 4 letters dark, rest green)
  tagline: 'כל הגיפט קארדים שלך. במקום אחד.',
  cta: 'התחילו להשתמש עכשיו',
  url: 'giftsmart.site',
}

// ── Dummy vouchers shown inside the phone ───────────────────────────────────
export interface DemoVoucher {
  id: string
  store: string
  category: string
  balance: number
  amount: number
  expiry: string       // shown on the card chip
  expiryFull: string   // shown on the opened voucher
  color: string        // category strip + avatar tint
  code: string         // FAKE code
}

export const VOUCHERS: DemoVoucher[] = [
  { id: 'zara',  store: 'ZARA',     category: 'אופנה', balance: 240, amount: 240, expiry: 'עד 12/2027', expiryFull: '31.12.2027', color: '#111827', code: 'GS-7Q4K-2291' },
  { id: 'fox',   store: 'FOX',      category: 'אופנה', balance: 175, amount: 200, expiry: 'עד 03/2027', expiryFull: '31.03.2027', color: '#6366f1', code: 'GS-3M8D-5510' },
  { id: 'buyme', store: 'BUYME',    category: 'מתנה',  balance: 320, amount: 320, expiry: 'עד 08/2027', expiryFull: '31.08.2027', color: '#f97316', code: 'GS-9T2P-0184' },
  { id: 'shuf',  store: 'שופרסל',   category: 'סופר',  balance: 110, amount: 150, expiry: 'עד 01/2028', expiryFull: '31.01.2028', color: '#e11d48', code: 'GS-5W1H-7736' },
  { id: 'golf',  store: 'Golf & Co', category: 'בית',   balance: 90,  amount: 90,  expiry: 'עד 06/2027', expiryFull: '30.06.2027', color: '#0ea5e9', code: 'GS-2B6N-4420' },
]

/** The voucher the search / checkout / balance scenes use. */
export const FOCUS_ID = 'zara'
/** Search text typed in scene 4 (should match FOCUS voucher's store). */
export const SEARCH_TEXT = 'ZARA'
/** Amount spent in scene 5. */
export const SPEND = 80
/** The voucher whose expiry warning fires in scene 6. */
export const EXPIRY_ID = 'fox'
export const EXPIRY_DAYS_LEFT = 7
