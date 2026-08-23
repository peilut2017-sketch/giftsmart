import type { CapacitorConfig } from '@capacitor/cli'

// iOS app wrapper configuration. The web app is bundled from `dist` (run
// `npm run build && npx cap copy ios` before opening Xcode) and talks to the
// same Supabase backend as the website. Android ships as a TWA instead (see
// twa-manifest.json) so Web Push keeps working there.
const config: CapacitorConfig = {
  appId: 'site.giftsmart.app',
  appName: 'GiftSmart',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#f8fafc',
  },
  server: {
    // Keep app links on-domain inside the app; everything else opens the browser
    allowNavigation: ['giftsmart.site'],
  },
}

export default config
