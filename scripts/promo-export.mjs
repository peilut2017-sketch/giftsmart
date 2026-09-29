#!/usr/bin/env node
/**
 * Frame-exact MP4 export of the promo (1080×1920, 60fps, H.264).
 *
 * Because every frame of the promo is a pure function of time, this script does
 * NOT screen-record. It seeks the page to each frame's exact timestamp, takes a
 * 1:1 screenshot of the 1080×1920 stage and pipes the frames into ffmpeg — so the
 * result is perfectly smooth regardless of how fast the machine is.
 *
 * One-time setup (does not touch package.json):
 *   npm i --no-save playwright && npx playwright install chromium
 *   (+ ffmpeg on your PATH:  brew install ffmpeg  /  winget install ffmpeg)
 *
 * Run:
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/promo-export.mjs                      → giftsmart-promo.mp4
 *   node scripts/promo-export.mjs --fps 30 --out a.mp4 --url http://localhost:5173/promo/
 */
import { spawn } from 'node:child_process'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
)
const FPS = Number(args.fps ?? 60)
const OUT = args.out ?? 'giftsmart-promo.mp4'
const URL_BASE = args.url ?? 'http://localhost:4173/promo/'

const { chromium } = await import('playwright').catch(() => {
  console.error('Playwright is missing. Run:  npm i --no-save playwright && npx playwright install chromium')
  process.exit(1)
})

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 })
await page.goto(`${URL_BASE}?export=1&t=0`)
await page.waitForFunction(() => window.__promo)
await page.evaluate(() => window.__promo.ready)
const duration = await page.evaluate(() => window.__promo.duration)
const total = Math.round(duration * FPS)

const ff = spawn('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-movflags', '+faststart',
  OUT,
], { stdio: ['pipe', 'inherit', 'inherit'] })

const started = Date.now()
for (let i = 0; i <= total; i++) {
  await page.evaluate(s => window.__promo.seek(s), i / FPS)
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: 1080, height: 1920 }, type: 'png' })
  if (!ff.stdin.write(png)) await new Promise(r => ff.stdin.once('drain', r))
  if (i % FPS === 0) process.stdout.write(`\r  frame ${i}/${total}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}
ff.stdin.end()
await new Promise((res, rej) => ff.on('close', code => (code === 0 ? res() : rej(new Error(`ffmpeg exited ${code}`)))))
await browser.close()
console.log(`\n✓ ${OUT}  ${total} frames @ ${FPS}fps`)
