/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Heebo', 'system-ui', 'sans-serif'],
      },
      colors: {
        primary: {
          DEFAULT: 'var(--c-primary)',
          light: 'var(--c-primary-light)',
          mid: 'var(--c-primary-mid)',
          dark: 'var(--c-primary-dark)',
        },
        gold: {
          DEFAULT: 'var(--c-gold)',
          light: 'var(--c-gold-light)',
          mid: 'var(--c-gold-mid)',
        },
        bg: 'var(--c-bg)',
        surface: 'var(--c-surface)',
        border: 'var(--c-border)',
        text: {
          DEFAULT: 'var(--c-text)',
          2: 'var(--c-text2)',
          3: 'var(--c-text3)',
        },
        success: 'var(--c-success)',
        warning: 'var(--c-warning)',
        error: 'var(--c-error)',
        urgent: {
          DEFAULT: 'var(--c-urgent)',
          bg: 'var(--c-urgent-bg)',
        },
      },
      borderRadius: {
        card: 'var(--r-card)',
        btn: 'var(--r-btn)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        fab: 'var(--shadow-fab)',
        nav: 'var(--shadow-nav)',
      },
      transitionTimingFunction: {
        // Mirrors the --ease-* tokens in index.css / src/lib/motion.ts
        'out-strong': 'var(--ease-out)',
        'in-out-strong': 'var(--ease-in-out)',
        drawer: 'var(--ease-drawer)',
      },
    },
  },
  plugins: [],
}

