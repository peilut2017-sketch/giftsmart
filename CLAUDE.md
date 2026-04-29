# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Vision

GiftSmart is a Hebrew-first (RTL) gift-card / voucher wallet PWA. Users store vouchers, track balances, share them with family members, send them as gifts, and buy/sell them on a built-in marketplace. The app runs entirely in the browser; Supabase provides auth, database, realtime, and edge functions.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite 8 |
| Styling | Tailwind CSS 3, Framer Motion (route animations) |
| Routing | React Router v7 |
| Backend | Supabase (Postgres + Auth + Realtime + Edge Functions) |
| Deployment | Vercel (SPA: all paths rewrite to `/index.html`) |
| Extras | Tesseract.js (OCR), jsbarcode / qrcode (code display), Recharts (stats), jsPDF (export) |

Required env vars (`VITE_` prefix = exposed to browser):

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_ADMIN_EMAIL   # used to gate /admin route
VITE_APP_URL
```

Gemini API key and email credentials live in **Supabase Secrets** (never in the frontend).

## Commands

```bash
npm run dev       # dev server with HMR
npm run build     # tsc -b && vite build  (always run before pushing)
npm run lint      # eslint
npm run preview   # preview the production build locally
```

There are no automated tests.

## Architecture & Patterns

### Context provider tree (App.tsx)

Public routes (`/s/:token`, `/gift/:token`) sit outside all context providers — they are accessible without login.

Authenticated routes are wrapped in this exact nesting order:

```
ErrorBoundary
  ThemeProvider
    LocaleProvider           ← i18n (useT hook)
      BrowserRouter
        AuthProvider         ← user, profile, isAdmin
          AppRoutes (auth gate)
            E2EEProvider     ← vault encryption
              SubscriptionProvider  ← plan limits, upgrade sheet
                VoucherProvider     ← vouchers, activity log, sharing
                  MarketplaceProvider  ← listings, purchases, chat
```

`NotificationBridge` and `E2EEBridge` are render-null components that wire together realtime subscriptions and the vault's decrypted map — they live inside `AppRoutes` rather than inside individual pages.

### Database access rule

**All data mutations go through Supabase RPC functions (SECURITY DEFINER) — never via direct table writes from the frontend.** Only reads (`supabase.from(...).select(...)`) bypass this rule and then only where RLS enforces the policy. When adding a feature, write the RPC in a new `supabase-*.sql` file and call it from the context or page.

Supabase RPC always returns an array even for single rows; always access `data[0]` when expecting one record.

### i18n system (`src/lib/i18n.tsx`)

The entire app is bilingual (Hebrew / English). The source of truth is Hebrew; English is optional.

- All strings live in the flat `translations` object at the top of the file.
- Hebrew: `'key': 'טקסט'`
- English: `'key.en': 'Text'` (same key with `.en` suffix)
- Hook: `const { t, locale, dir } = useT()`
- If a key is missing, `t()` returns the key string itself — this causes visible broken UI.

**When adding any UI text:** add both the Hebrew entry and the `.en` entry to `translations` in `i18n.tsx`.

**Duplicate keys** (`'key': 'a', 'key': 'b'`) cause TypeScript error **TS1117** and break the Vercel build. Run `npm run build` before every push to catch this early.

### Variable-shadowing trap

Components that call `const { t } = useT()` must **never** use `t` as a loop/map variable name:

```tsx
// ❌ Breaks — `t` in the callback shadows the translation function
shareTokens.map(t => <div>{t.token}</div>)

// ✅ Correct
shareTokens.map(tok => <div>{tok.token}</div>)
```

### E2EE vault (`src/lib/e2ee.ts`, `src/contexts/E2EEContext.tsx`)

- Algorithm: AES-GCM-256 with PBKDF2 (100 000 iterations, SHA-256).
- Encrypted field format: `e2ee:<iv_base64>:<ciphertext_base64>`. Use `isEncryptedField()` to check.
- Vault metadata in `localStorage`: `gs_e2ee_salt`, `gs_e2ee_chk`, `gs_e2ee_hint`.
- Passphrase cached in `sessionStorage` (`gs_e2ee_session`) — survives page refresh within the tab only.
- `E2EEBridge` (render-null, in App.tsx) rebuilds the in-memory `decryptedMap` whenever the vault is unlocked or vouchers change.

### Animation (`src/components/AnimatedRoutes.tsx`)

RTL-aware tab sliding via Framer Motion. Tab order is defined in `TAB_ORDER` (index 0 = rightmost in RTL). Routes not in `TAB_ORDER` (e.g. `/checkout/:id`) are treated as deep pushes and get a subtle scale/fade instead of a slide.

### Subscription / limits

Free plan: 25 vouchers, 5 shared, 3 OCR scans/month, 7-day activity history, no export, no push.
Pro plan: unlimited everything. The `isPremium` flag is admin-toggled via `get_premium_enabled` RPC and cached in `localStorage` (`gs_premium_enabled`). `openUpgradeSheet(reason)` from `useSubscription()` triggers the upsell UI.

### Profile caching

`AuthContext` caches the profile in `sessionStorage` (`gs_profile_<uid>`) so that `isAdmin` is available synchronously on the next page load without an extra round-trip.

### SQL migration files

All `supabase-*.sql` files at the repo root are incremental migration scripts. Apply them manually in the Supabase SQL Editor — there is no automated migration runner. Each new feature gets its own file.

## Known Challenges & Decisions

- **No tests.** Verify all changes by running `npm run build` (catches TS errors) and manually testing in the browser.
- **All Supabase RPC functions are SECURITY DEFINER** to avoid RLS recursion issues with shared-wallet queries. Do not bypass this by switching to client-side table writes.
- **Hebrew is the UI default; RTL layout is assumed everywhere.** Use `dir="rtl"` or the `dir` value from `useLocale()` when rendering dynamic containers that must match locale.
- **Biometric is a local UI gate only**, not real auth. The Supabase session stays active; `BiometricGate` just blocks the UI until the platform authenticator succeeds.
- **MarketplaceContext has a 60-second TTL cache** (`CACHE_TTL_MS`) for `listings`, `myListings`, and `myPurchases` to avoid re-fetching on every tab switch.
- **GiftPage and SharedVoucherPage are fully public** (no auth required). They are registered outside `AppRoutes` in `App.tsx` and must not import anything from `VoucherProvider` or `MarketplaceProvider`.
- **Gemini vision analysis** is proxied through a Supabase Edge Function (`analyze-voucher`) so the API key is never exposed to the browser. Call it via `supabase.functions.invoke('analyze-voucher', ...)`.
