#!/usr/bin/env node
/**
 * Captures REAL GiftSmart screens for the promo, with fake demo data only.
 *
 * It runs the actual app (unmodified pages and components) against a local mock
 * backend (supabase-mock.ts) and walks the story the ad tells: home → vouchers
 * → search "ZARA" → open it → use ₪80 → back. Each state is saved as a 390×800pt
 * @3x screenshot, plus the on-screen positions of the things the ad highlights.
 *
 *   npx vite -c scripts/promo-screens/vite.screens.config.ts --port 5199 &
 *   node scripts/promo-screens/capture.mjs
 *
 * Output: src/promo/screens/*.webp + src/promo/screens/manifest.ts
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const OUT = resolve(root, 'src/promo/screens')
const BASE = process.argv[2] ?? 'http://localhost:5199'
const VIEW = { width: 390, height: 800 }
const fonts = resolve(root, 'src/promo/fonts')

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: VIEW, deviceScaleFactor: 3, locale: 'he-IL', timezoneId: 'Asia/Jerusalem',
  serviceWorkers: 'block', reducedMotion: 'no-preference', isMobile: true, hasTouch: true,
})
await ctx.addInitScript(() => {
  localStorage.setItem('welcome_seen_demo-user', '1')
  localStorage.setItem('onboarding_seen_v2', '1')
  localStorage.setItem('gs_locale', 'he')
  localStorage.setItem('gs_theme', 'light')
  localStorage.setItem('a11y_widget_enabled', 'false')
})
// Deterministic fonts: serve the bundled Heebo instead of Google Fonts.
await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({
  contentType: 'text/css',
  body: `@font-face{font-family:'Heebo';font-weight:100 900;src:url(/__f/he.woff2) format('woff2');unicode-range:U+0590-05FF,U+200C-2010,U+20AA,U+25CC,U+FB1D-FB4F}
@font-face{font-family:'Heebo';font-weight:100 900;src:url(/__f/la.woff2) format('woff2');unicode-range:U+0000-00FF,U+2000-206F,U+2212}`,
}))
await ctx.route('**/__f/he.woff2', r => r.fulfill({ path: resolve(fonts, 'heebo-hebrew-wght-normal.woff2'), contentType: 'font/woff2' }))
await ctx.route('**/__f/la.woff2', r => r.fulfill({ path: resolve(fonts, 'heebo-latin-wght-normal.woff2'), contentType: 'font/woff2' }))
await ctx.route('http://mock.invalid/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }))

const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
await page.goto(BASE + '/')
await page.evaluate(() => document.fonts.ready)
// Desktop-Chromium-only input chrome that an iPhone never shows.
await page.addStyleTag({ content: `
  input::-webkit-search-cancel-button, input::-webkit-search-decoration { -webkit-appearance: none; display: none; }
  input[type=number]::-webkit-inner-spin-button, input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  input[type=number] { -moz-appearance: textfield; }
  ::-webkit-scrollbar { display: none; }` })
await page.waitForTimeout(2500)

const manifest = { viewport: VIEW, scale: 3, screens: {}, top: {}, boxes: {} }
const settle = (ms = 1100) => page.waitForTimeout(ms)

async function shot(name) {
  await page.evaluate(() => document.fonts.ready)
  const png = await page.screenshot({ type: 'png' })
  await sharp(png).webp({ quality: 88, effort: 5 }).toFile(resolve(OUT, `${name}.webp`))
  manifest.screens[name] = `${name}.webp`
  // Colour of the screen's top edge (left corner, clear of buttons) — the promo paints the phone's status bar with it.
  const { data, info } = await sharp(png).extract({ left: 30, top: 3, width: 12, height: 3 }).raw().toBuffer({ resolveWithObject: true })
  const avg = [0, 1, 2].map(c => { let t = 0; for (let i = c; i < data.length; i += info.channels) t += data[i]; return Math.round(t / (data.length / info.channels)) })
  manifest.top[name] = '#' + avg.map(c => c.toString(16).padStart(2, '0')).join('')
  console.log('  ✓', name)
}

/** Box (in 390×800 viewport points) of the smallest visible element whose text matches. */
async function box(name, text, { within, pad = 0, pick = 'smallest' } = {}) {
  const b = await page.evaluate(([text, within, pick]) => {
    const scope = within ? [...document.querySelectorAll(within)] : [document.body]
    const all = scope.flatMap(s => [s, ...s.querySelectorAll('*')])
    const hits = all.filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight &&
        (el.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text)
    })
    if (!hits.length) return null
    hits.sort((a, c) => {
      const ra = a.getBoundingClientRect(), rc = c.getBoundingClientRect()
      return pick === 'smallest' ? ra.width * ra.height - rc.width * rc.height : rc.width * rc.height - ra.width * ra.height
    })
    const r = hits[0].getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }, [text, within ?? null, pick])
  if (!b) throw new Error(`box not found: ${name} (${text})`)
  manifest.boxes[name] = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }
  return b
}
async function boxOf(name, selector, pad = 0) {
  const b = await page.locator(selector).first().boundingBox()
  if (!b) throw new Error(`box not found: ${name} (${selector})`)
  manifest.boxes[name] = { x: b.x - pad, y: b.y - pad, w: b.width + pad * 2, h: b.height + pad * 2 }
  return b
}

// 1 ─ Home
await shot('home')
await box('nav_vouchers', 'שוברים', { within: 'nav' })

// 2 ─ Vouchers list
await page.locator('nav').getByText('שוברים', { exact: true }).click()
await settle(1400)
await shot('list')
await box('list_zara_balance', '₪240', { pad: 5 })
await box('list_zara_expiry', '02/01/2028', { pad: 2 })
await box('list_fox_expiry', 'נותרו 7 ימים', { pad: 2 })
const input = page.locator('input[type="search"], input[placeholder*="חיפוש"]').first()
await boxOf('search_input', 'input[placeholder*="חיפוש"]', 4)

// 3 ─ Search, one real frame per typed letter
await input.focus()
await settle(400)
await shot('search_0')
for (const [i, part] of ['Z', 'ZA', 'ZAR', 'ZARA'].entries()) {
  await input.fill(part)
  await settle(700)
  await shot(`search_${i + 1}`)
}
await box('search_zara_card', 'ZARA', { within: 'main, #root', pick: 'smallest' })

// 4 ─ Open the voucher (checkout / in-store screen)
await page.getByText('ZARA', { exact: true }).first().click()
await settle(1600)
await page.evaluate(() => window.scrollTo(0, 0))
await settle(600)
await shot('voucher')
{
  // The QR / barcode: the biggest svg, canvas or img on screen.
  const qr = await page.evaluate(() => {
    const els = [...document.querySelectorAll('svg, canvas, img')].map(el => el.getBoundingClientRect())
      .filter(r => r.width > 120 && r.top > 0 && r.bottom < innerHeight)
      .sort((a, b) => b.width * b.height - a.width * a.height)
    const r = els[0]
    return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
  })
  if (!qr) throw new Error('QR not found')
  manifest.boxes.voucher_code = { x: qr.x - 10, y: qr.y - 10, w: qr.w + 20, h: qr.h + 20 }
}
await box('voucher_codeText', 'GS7Q4K2291', { pad: 4 })
await box('voucher_balance', '₪240', { pad: 6 })
await box('voucher_fab', 'שימוש בשובר', { pick: 'smallest' })

// 5 ─ Use ₪80
await page.getByText('שימוש בשובר', { exact: true }).last().click()
await settle(1400)
await shot('use_0')
const amount = page.locator('input[type="number"]').first()
await boxOf('use_amount', 'input[type="number"]', 2)
await amount.focus()
await amount.fill('8')
await settle(400)
await shot('use_8')
await amount.fill('80')
await settle(500)
await shot('use_80')
await box('use_fab', 'עדכן יתרה', { pick: 'smallest' })
await page.getByText('עדכן יתרה', { exact: true }).last().click()
await settle(1500)
await page.evaluate(() => window.scrollTo(0, 0))
await settle(700)
await shot('voucher_after')
await box('after_balance', '₪160', { pad: 6 })

// 6 ─ Back to the list, then home
await page.goBack()
await settle(1400)
const again = page.locator('input[placeholder*="חיפוש"]').first()
if (await again.inputValue().catch(() => '')) { await again.fill(''); await page.locator('body').click({ position: { x: 5, y: 5 } }) }
await page.evaluate(() => { (document.activeElement)?.blur?.(); window.scrollTo(0, 0) })
await settle(900)
await shot('list_after')
await box('list_after_fox_expiry', 'נותרו 7 ימים', { pad: 2 })
await page.locator('nav').getByText('ארנק', { exact: true }).click()
await settle(1600)
await shot('home_after')

await writeFile(resolve(OUT, 'manifest.ts'),
  `// Generated by scripts/promo-screens/capture.mjs — do not edit by hand.\nexport default ${JSON.stringify(manifest, null, 2)} as const\n`)
await browser.close()
if (errors.length) console.warn('page errors:', errors.slice(0, 5))
console.log(`\n✓ ${Object.keys(manifest.screens).length} screens → ${OUT}`)
