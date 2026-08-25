# Store readiness — technical state

What is prepared in this repo for shipping GiftSmart to Google Play and the App Store, and which placeholders must be filled before release. The step-by-step owner guide (Hebrew, non-technical) is published separately as an artifact.

## Strategy

- **Android → TWA (Trusted Web Activity)** via Bubblewrap or PWABuilder. The app runs in Chrome, so Web Push, WebAuthn/biometrics and the service worker all keep working.
- **iOS → Capacitor** wrapper (`ios/` project in this repo). Web assets are bundled from `dist`; backend is the same Supabase project.

## Files in this repo

| File | Purpose | Placeholder to fill |
|---|---|---|
| `public/manifest.json` | PWA manifest (id, scope, display_override, any+maskable icons) | screenshots (optional) |
| `public/.well-known/assetlinks.json` | Android Digital Asset Links — removes the browser URL bar in the TWA | `sha256_cert_fingerprints` from Play Console → App signing |
| `public/.well-known/apple-app-site-association` | iOS universal links (`/gift/*`, `/s/*`) + passkey domain association | `REPLACE_TEAMID` with the Apple Team ID |
| `vercel.json` | Serves the two files above with correct headers (static files bypass the SPA rewrite on Vercel) | — |
| `twa-manifest.json` | Bubblewrap config: package `site.giftsmart.app`, host `giftsmart.site`, notifications on | `appVersionCode` bump per release |
| `capacitor.config.ts` | iOS wrapper config (`webDir: dist`) | — |
| `ios/` | Generated Xcode project: icons/splash generated, Info.plist has camera/photos usage strings + `ITSAppUsesNonExemptEncryption=false`, `App.entitlements` with associated domains wired into both build configs | Signing team in Xcode |
| `resources/` | Source assets for `@capacitor/assets` (1024 icon, 2732 splash light/dark) | Replace with original-quality artwork if available |
| `supabase-delete-account.sql` | `delete_own_account()` RPC — in-app account deletion, required by both stores | Run in SQL Editor |

## npm scripts

- `npm run ios:sync` — build web + copy into the iOS project (run before opening Xcode)
- `npm run ios:assets` — regenerate iOS icons/splash from `resources/`

## Known platform caveats

- **iOS wrapper**: WebAuthn (passkeys/biometric vault door) is not available inside WKWebView — the app detects this and falls back to password/recovery unlock. Web Push does not run in the wrapper either; expiry reminders on iOS need a future APNs integration (`@capacitor/push-notifications` + a variant of the `send-push` edge function). Android TWA has both working.
- **Account deletion**: the in-app flow calls `delete_own_account()`; until the SQL is applied it falls back to the old support-request path.
- **Analytics disclosure**: the app ships PostHog + Vercel Analytics — must be declared in Play Data Safety and Apple privacy labels (see the owner guide for prefilled answers).
