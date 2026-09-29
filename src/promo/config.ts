/**
 * Everything a non-developer would want to tweak lives here: captions, colors,
 * the closing CTA and the push-notification text.
 *
 * The phone shows REAL app screenshots. The demo vouchers inside them come from
 * scripts/promo-screens/supabase-mock.ts (DEFAULT_VOUCHERS) — edit them there and
 * re-run scripts/promo-screens/capture.mjs. All of it is fake demo data.
 */

// ── Brand tokens (mirrors src/index.css :root) ──────────────────────────────
export const BRAND = {
  green: '#22c55e',        // --c-primary-mid, theme-color
  greenDeep: '#117f3a',    // --c-primary (text-safe green)
  greenDark: '#15803d',    // --c-primary-dark
  greenLight: '#dcfce7',   // --c-primary-light
  purple: '#9333ea',       // logo accent
  bg: '#f8fafc',           // promo background
  text: '#0f1c1a',
  text2: '#4a6260',
  text3: '#5a726f',
  urgent: '#de1313',
  urgentBg: '#fef2f2',
}

// ── Captions ────────────────────────────────────────────────────────────────
// `at` / `out` are seconds on the 32s design timeline (see timeline.ts).
// Keep them in step with the narration cues in scripts/promo-voice/build-narration.sh.
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
    { text: 'ואיפה הם?', at: 2.35, accent: true },
  ] },
  { out: 6.8, lines: [
    { text: 'הכירו את Gift Smart', at: 5.05 },
    { text: 'כל השוברים שלך. במקום אחד.', at: 5.4, sub: true },
  ] },
  { out: 9.95, lines: [
    { text: 'כל השוברים במקום אחד.', at: 7.15 },
    { text: 'הכול מסודר.', at: 8.95, accent: true },
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
    { text: 'לא נותנים', at: 21.55 },
    { text: 'לכסף לפוג.', at: 21.75, accent: true },
  ] },
]

// ── Closing hero (scene 7) ──────────────────────────────────────────────────
export const HERO = {
  tagline: 'כל הגיפט קארדים שלך. במקום אחד.',
  cta: 'התחילו להשתמש עכשיו',
  url: 'giftsmart.site',
}

/** Amount used in scene 5 (must match what capture.mjs types: 80). */
export const SPEND = 80

/** Push notification in scene 6 — same wording as supabase/functions/push-expiry for 7 days left. */
export const NOTIFICATION = {
  title: 'תזכורת תוקף',
  body: 'FOX — ₪175 · עוד 7 ימים',
}
