# Gift Smart — vertical promo (`/promo/`)

A 30-second, 1080×1920 (9:16) animated ad. Fully isolated: its own Vite entry and
its own build — no app providers, no Supabase, no analytics, no service worker.

**What's real:** the phone plays genuine screenshots of the GiftSmart app
(`src/promo/screens/`), captured from the unmodified app code with fake demo data,
and the logo is the official artwork (`src/promo/assets/`). The page transitions
mirror `AnimatedRoutes.tsx`, and the push notification uses the exact wording from
`supabase/functions/push-expiry`. Nothing shows a real account, code or person.

## Open it
- Dev: `npm run dev` → http://localhost:5173/promo/
- Prod build: `npm run build && npm run preview` → http://localhost:4173/promo/
- Deployed: https://giftsmart.site/promo/

URL options: `?autoplay=false` · `?loop=true` · `?t=12.5` (freeze a frame) · `?ui=0` (hide controls).
Keys: Space play/pause · R replay · ←/→ ±1s. The Replay button is in the bottom control bar.

## Edit it
| What | Where |
|---|---|
| Captions + timing | `config.ts` → `CAPTIONS` |
| Closing tagline / CTA / URL, push text | `config.ts` → `HERO`, `NOTIFICATION` |
| Demo vouchers shown in the app | `scripts/promo-screens/supabase-mock.ts` → `DEFAULT_VOUCHERS`, then re-capture (below) |
| Which screen shows when, taps, highlight rings | `Phone.tsx` → `SHOTS`, `TAPS`, `RINGS` |
| Total length | `timeline.ts` → `TIME_SCALE` (1 = 30s, 1.15 ≈ 34.5s) |

Everything on screen is a pure function of one clock `t` (see `timeline.ts`), so
scenes can't drift apart and any frame can be rendered exactly.

## Refresh the app screenshots (after a UI change)
```bash
npm i --no-save playwright sharp && npx playwright install chromium   # one time
npx vite -c scripts/promo-screens/vite.screens.config.ts --port 5199 &
node scripts/promo-screens/capture.mjs
```
This runs the real app against a local mock backend, walks home → vouchers →
search "ZARA" → open → use ₪80 → back, and rewrites `src/promo/screens/`
(images + `manifest.ts` with the positions of everything the ad highlights).

## Export to MP4 (1080×1920, 60fps)
```bash
npm run build && npx vite preview --port 4173 &   # needs ffmpeg on PATH
node scripts/promo-export.mjs                     # → giftsmart-promo.mp4   (--fps 30, --out name.mp4)
```
The exporter seeks frame-by-frame and pipes 1:1 stage screenshots to ffmpeg — no
screen recording, so the output is perfectly smooth on any machine.
