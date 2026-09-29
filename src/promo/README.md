# Gift Smart — vertical promo (`/promo/`)

A 30-second, 1080×1920 (9:16) animated ad built from the app's own design tokens.
Fully isolated: its own Vite entry and its own build — no app providers, no Supabase,
no analytics, no service worker. All vouchers/codes are fake demo data.

## Open it
- Dev: `npm run dev` → http://localhost:5173/promo/
- Prod build: `npm run build && npm run preview` → http://localhost:4173/promo/
- Deployed: https://giftsmart.site/promo/

URL options: `?autoplay=false` · `?loop=true` · `?t=12.5` (freeze a frame) · `?ui=0` (hide controls).
Keys: Space play/pause · R replay · ←/→ ±1s. The Replay button is in the bottom control bar.

## Edit it
| What | Where |
|---|---|
| Captions + their timing | `config.ts` → `CAPTIONS` |
| Dummy vouchers (store, balance, expiry, color, fake code) | `config.ts` → `VOUCHERS` (+ `FOCUS_ID`, `SEARCH_TEXT`, `SPEND`, `EXPIRY_ID`) |
| Closing tagline / CTA / URL | `config.ts` → `HERO` |
| Total length | `timeline.ts` → `TIME_SCALE` (1 = 30s, 1.15 ≈ 34.5s) |
| Per-scene timing | the `T` object in `Phone.tsx`, marks in `layout.ts`, `Chaos.tsx`, `Hero.tsx` |

Everything on screen is a pure function of one clock `t` (see `timeline.ts`), so scenes
can't drift apart and any frame can be rendered exactly.

## Export to MP4 (1080×1920, 60fps)
```bash
npm i --no-save playwright && npx playwright install chromium   # one time, needs ffmpeg on PATH
npm run build && npx vite preview --port 4173 &
node scripts/promo-export.mjs            # → giftsmart-promo.mp4   (--fps 30, --out name.mp4)
```
The exporter seeks frame-by-frame and pipes 1:1 stage screenshots to ffmpeg — no screen
recording, so the output is perfectly smooth on any machine.
