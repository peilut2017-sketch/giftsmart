import { useState, useEffect, useRef } from 'react'
import { X, ZoomIn, ZoomOut, Eye, Minus, Accessibility } from 'lucide-react'

const STORAGE_KEY = 'a11y_prefs'

interface A11yPrefs {
  textSize: 0 | 1 | 2 | 3   // 0=default, 1=md, 2=lg, 3=xl
  contrast: boolean
  grayscale: boolean
  noMotion: boolean
  focusRing: boolean
}

const DEFAULT_PREFS: A11yPrefs = {
  textSize: 0,
  contrast: false,
  grayscale: false,
  noMotion: false,
  focusRing: false,
}

function loadPrefs(): A11yPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
  } catch {
    return DEFAULT_PREFS
  }
}

function applyPrefs(prefs: A11yPrefs) {
  const body = document.body
  body.classList.remove('a11y-text-md', 'a11y-text-lg', 'a11y-text-xl')
  if (prefs.textSize === 1) body.classList.add('a11y-text-md')
  else if (prefs.textSize === 2) body.classList.add('a11y-text-lg')
  else if (prefs.textSize === 3) body.classList.add('a11y-text-xl')
  body.classList.toggle('a11y-contrast', prefs.contrast)
  body.classList.toggle('a11y-grayscale', prefs.grayscale)
  body.classList.toggle('a11y-no-motion', prefs.noMotion)
  body.classList.toggle('a11y-focus', prefs.focusRing)
}

const TEXT_LABELS = ['רגיל', 'בינוני', 'גדול', 'גדול מאוד'] as const

export default function AccessibilityWidget() {
  const [open, setOpen] = useState(false)
  const [prefs, setPrefs] = useState<A11yPrefs>(loadPrefs)
  const panelRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Apply prefs on mount and whenever they change
  useEffect(() => {
    applyPrefs(prefs)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }, [prefs])

  // Close panel on Escape + restore focus
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  // Focus first element when panel opens
  useEffect(() => {
    if (open) {
      const first = panelRef.current?.querySelector<HTMLElement>('button, [tabindex]')
      first?.focus()
    }
  }, [open])

  function update<K extends keyof A11yPrefs>(key: K, value: A11yPrefs[K]) {
    setPrefs(p => ({ ...p, [key]: value }))
  }

  function resetAll() {
    setPrefs(DEFAULT_PREFS)
  }

  const anyActive = prefs.textSize > 0 || prefs.contrast || prefs.grayscale || prefs.noMotion || prefs.focusRing

  return (
    <div className="fixed bottom-24 left-3 z-50" style={{ left: 'max(12px, env(safe-area-inset-left))' }}>
      {/* Floating button */}
      <button
        ref={btnRef}
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'סגור תפריט נגישות' : 'פתח תפריט נגישות'}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-blue-500 focus-visible:ring-offset-2 ${
          anyActive
            ? 'bg-blue-600 text-white'
            : 'bg-white text-gray-700 border border-gray-200'
        }`}
      >
        <Accessibility className="w-6 h-6" aria-hidden="true" />
        {anyActive && (
          <span className="absolute top-0 right-0 w-3 h-3 bg-yellow-400 rounded-full border-2 border-white" aria-hidden="true" />
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="הגדרות נגישות"
          className="absolute bottom-14 left-0 w-72 bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden animate-fade-in"
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center gap-2">
              <Accessibility className="w-4 h-4 text-blue-600" aria-hidden="true" />
              <h2 className="text-sm font-bold text-gray-800">הגדרות נגישות</h2>
            </div>
            <button
              onClick={() => { setOpen(false); btnRef.current?.focus() }}
              aria-label="סגור"
              className="p-1.5 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4 text-gray-500" aria-hidden="true" />
            </button>
          </div>

          <div className="p-4 space-y-4">
            {/* Text size */}
            <div>
              <p className="text-xs font-semibold text-gray-500 mb-2" id="a11y-textsize-label">גודל טקסט</p>
              <div className="flex items-center gap-1" role="group" aria-labelledby="a11y-textsize-label">
                <button
                  onClick={() => update('textSize', Math.max(0, prefs.textSize - 1) as A11yPrefs['textSize'])}
                  disabled={prefs.textSize === 0}
                  aria-label="הקטן טקסט"
                  className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  <ZoomOut className="w-4 h-4" aria-hidden="true" />
                </button>
                <div className="flex-1 text-center text-sm font-medium text-gray-700">
                  {TEXT_LABELS[prefs.textSize]}
                </div>
                <button
                  onClick={() => update('textSize', Math.min(3, prefs.textSize + 1) as A11yPrefs['textSize'])}
                  disabled={prefs.textSize === 3}
                  aria-label="הגדל טקסט"
                  className="p-2 rounded-xl bg-gray-100 hover:bg-gray-200 disabled:opacity-40 transition-colors"
                >
                  <ZoomIn className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Toggles */}
            <div className="space-y-2" role="group" aria-label="אפשרויות נגישות נוספות">
              {([
                { key: 'contrast',  label: 'ניגודיות גבוהה',   icon: Eye },
                { key: 'focusRing', label: 'הדגשת פוקוס',      icon: Accessibility },
                { key: 'grayscale', label: 'גווני אפור',       icon: Minus },
                { key: 'noMotion',  label: 'עצור אנימציות',    icon: Minus },
              ] as const).map(({ key, label, icon: Icon }) => (
                <label key={key} className="flex items-center justify-between cursor-pointer">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-gray-500" aria-hidden="true" />
                    <span className="text-sm text-gray-700">{label}</span>
                  </div>
                  <button
                    role="switch"
                    aria-checked={prefs[key]}
                    onClick={() => update(key, !prefs[key])}
                    className={`relative w-10 h-5 rounded-full transition-colors ${prefs[key] ? 'bg-blue-600' : 'bg-gray-200'}`}
                    aria-label={label}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${prefs[key] ? 'translate-x-0.5' : 'right-0.5'}`} />
                  </button>
                </label>
              ))}
            </div>

            {/* Reset */}
            {anyActive && (
              <button
                onClick={resetAll}
                className="w-full py-2 text-sm text-red-600 hover:bg-red-50 rounded-xl transition-colors"
              >
                אפס הכל לברירת מחדל
              </button>
            )}

            {/* Accessibility statement link */}
            <a
              href="/accessibility"
              className="block text-center text-xs text-blue-600 hover:underline mt-1"
            >
              הצהרת נגישות
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
