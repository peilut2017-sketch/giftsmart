import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Dates drive expiry logic; pin "now" so the suite doesn't drift over time.
    globals: false,
  },
})
