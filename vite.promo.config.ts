import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Separate build for the isolated promo page (/promo/).
 * Runs after the main app build and only ADDS files to dist/ — the app's own
 * bundle, chunk graph and hashes are untouched.
 */
export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    assetsDir: 'promo-assets',
    rollupOptions: {
      input: { promo: resolve(__dirname, 'promo/index.html') },
    },
  },
})
