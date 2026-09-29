import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Dev-only harness: runs the REAL GiftSmart app, but with src/lib/supabase.ts
 * swapped for a local mock full of fake demo vouchers. Used to capture honest
 * app screenshots for the promo without touching a real account or database.
 *
 *   npx vite -c scripts/promo-screens/vite.screens.config.ts --port 5199
 */
const root = resolve(__dirname, '../..')
const mock = resolve(__dirname, 'supabase-mock.ts')

function swapSupabase(): Plugin {
  return {
    name: 'promo-swap-supabase',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!importer || !/(^|\/)lib\/supabase(\.ts)?$/.test(source)) return null
      const r = await this.resolve(source, importer, { skipSelf: true })
      return r && r.id.startsWith(resolve(root, 'src/lib/supabase')) ? mock : null
    },
  }
}

export default defineConfig({
  root,
  plugins: [swapSupabase(), react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://mock.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('mock'),
  },
})
