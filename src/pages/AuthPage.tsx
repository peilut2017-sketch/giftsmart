import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, ShieldCheck } from 'lucide-react'
import { GiftSmartLogoFull } from '../components/GiftSmartLogo'
import toast from 'react-hot-toast'

const APP_VERSION = '1.0.0'

type Mode = 'login' | 'register' | 'forgot' | 'newPassword'

interface PasswordStrength {
  score: number // 0-4
  label: string
  color: string
  checks: { label: string; ok: boolean }[]
}

function getPasswordStrength(password: string): PasswordStrength {
  const checks = [
    { label: 'לפחות 8 תווים', ok: password.length >= 8 },
    { label: 'אותיות גדולות (A-Z)', ok: /[A-Z]/.test(password) },
    { label: 'אותיות קטנות (a-z)', ok: /[a-z]/.test(password) },
    { label: 'מספרים (0-9)', ok: /\d/.test(password) },
    { label: 'תווים מיוחדים (!@#$...)', ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
  ]
  const score = checks.filter(c => c.ok).length
  const labels = ['חלשה מאוד', 'חלשה', 'בינונית', 'חזקה', 'חזקה מאוד']
  const colors = ['bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-green-400', 'bg-green-600']
  return { score, label: labels[score] ?? labels[0], color: colors[score] ?? colors[0], checks }
}

export default function AuthPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { signIn, signUp, signInWithGoogle, resetPassword, updatePassword } = useAuth()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [name, setName] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showStrength, setShowStrength] = useState(false)

  const strength = useMemo(() => getPasswordStrength(password), [password])
  const isRegisterOrNew = mode === 'register' || mode === 'newPassword'

  function validatePasswordStrong(): boolean {
    if (strength.score < 3) {
      toast.error('הסיסמה חלשה מדי — צריך לפחות ציון "חזקה"')
      setShowStrength(true)
      return false
    }
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'forgot') {
        if (!email) return toast.error('יש להזין כתובת אימייל')
        const { error } = await resetPassword(email)
        if (error) toast.error('שגיאה בשליחת המייל')
        else {
          toast.success('נשלח מייל לאיפוס סיסמה — בדוק את תיבת הדואר')
          setMode('login')
        }
        return
      }

      if (mode === 'newPassword') {
        if (!password) return toast.error('יש להזין סיסמה חדשה')
        if (password !== password2) return toast.error('הסיסמאות אינן תואמות')
        if (!validatePasswordStrong()) return
        const { error } = await updatePassword(password)
        if (error) toast.error('שגיאה בעדכון הסיסמה')
        else toast.success('הסיסמה עודכנה בהצלחה!')
        return
      }

      if (!email || !password) return toast.error('יש למלא אימייל וסיסמה')

      if (mode === 'login') {
        const { error } = await signIn(email, password)
        if (error) toast.error('אימייל או סיסמה שגויים')
      } else {
        if (password !== password2) return toast.error('הסיסמאות אינן תואמות')
        if (!validatePasswordStrong()) return
        const { error } = await signUp(email, password, name)
        if (error) toast.error('שגיאה בהרשמה: ' + error.message)
        else toast.success('נרשמת בהצלחה!')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <GiftSmartLogoFull iconSize={72} />
          <span className="text-xs text-gray-400 mt-2 block">גרסה {APP_VERSION}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl p-6">

          {/* Forgot / NewPassword header */}
          {(mode === 'forgot' || mode === 'newPassword') ? (
            <div className="mb-6">
              {mode !== 'newPassword' && (
                <button
                  onClick={() => setMode('login')}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-3"
                >
                  <ArrowRight className="w-4 h-4" />
                  חזרה
                </button>
              )}
              <h2 className="text-lg font-bold text-gray-800">
                {mode === 'forgot' ? 'איפוס סיסמה' : 'סיסמה חדשה'}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {mode === 'forgot'
                  ? 'הזן את האימייל שלך ונשלח לך קישור לאיפוס'
                  : 'הזן סיסמה חדשה לחשבון שלך'}
              </p>
            </div>
          ) : (
            /* Login / Register Tabs */
            <div className="flex bg-gray-100 rounded-2xl p-1 mb-6">
              <button
                onClick={() => setMode('login')}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${
                  mode === 'login' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                }`}
              >
                כניסה
              </button>
              <button
                onClick={() => setMode('register')}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${
                  mode === 'register' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                }`}
              >
                הרשמה
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                <input
                  id="auth-name"
                  type="text"
                  placeholder="שם מלא"
                  aria-label="שם מלא"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
            )}

            {mode !== 'newPassword' && (
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                <input
                  id="auth-email"
                  type="email"
                  placeholder="כתובת אימייל"
                  aria-label="כתובת אימייל"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoComplete="email"
                  dir="ltr"
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                  <input
                    id="auth-password"
                    type={showPass ? 'text' : 'password'}
                    placeholder={mode === 'newPassword' ? 'סיסמה חדשה' : 'סיסמה'}
                    aria-label={mode === 'newPassword' ? 'סיסמה חדשה' : 'סיסמה'}
                    value={password}
                    onChange={e => { setPassword(e.target.value); if (isRegisterOrNew) setShowStrength(true) }}
                    className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    aria-label={showPass ? 'הסתר סיסמה' : 'הצג סיסמה'}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>

                {/* Password strength meter */}
                {isRegisterOrNew && showStrength && password.length > 0 && (
                  <div className="mt-2 space-y-2">
                    {/* Bar */}
                    <div className="flex gap-1">
                      {[0,1,2,3,4].map(i => (
                        <div
                          key={i}
                          className={`flex-1 h-1.5 rounded-full transition-all ${i < strength.score ? strength.color : 'bg-gray-100'}`}
                        />
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs font-medium ${strength.score >= 3 ? 'text-green-600' : 'text-orange-500'}`}>
                        {strength.label}
                      </span>
                      {strength.score >= 3 && <ShieldCheck className="w-4 h-4 text-green-500" />}
                    </div>
                    {/* Requirements */}
                    <div className="grid grid-cols-1 gap-0.5">
                      {strength.checks.map(c => (
                        <div key={c.label} className={`flex items-center gap-1.5 text-xs ${c.ok ? 'text-green-600' : 'text-gray-400'}`}>
                          <span>{c.ok ? '✓' : '○'}</span>
                          {c.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {isRegisterOrNew && (
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="אימות סיסמה"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoComplete="new-password"
                  dir="ltr"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-70 active:scale-98"
            >
              {loading ? '...' : mode === 'login' ? 'כניסה' : mode === 'register' ? 'הרשמה' : mode === 'forgot' ? 'שלח קישור' : 'עדכן סיסמה'}
            </button>

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => setMode('forgot')}
                className="w-full text-center text-sm text-gray-400 hover:text-green-600 transition-colors pt-1"
              >
                שכחתי סיסמה
              </button>
            )}
          </form>

          {/* Google OAuth — shown on login/register only */}
          {(mode === 'login' || mode === 'register') && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">או</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <button
                type="button"
                disabled={googleLoading}
                onClick={async () => {
                  setGoogleLoading(true)
                  const { error } = await signInWithGoogle()
                  if (error) { toast.error('שגיאה בהתחברות עם Google'); setGoogleLoading(false) }
                }}
                className="w-full flex items-center justify-center gap-3 py-3 border border-gray-200 rounded-2xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                {googleLoading ? (
                  <div className="w-5 h-5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-5 h-5" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                )}
                {mode === 'login' ? 'כניסה עם Google' : 'הרשמה עם Google'}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          ארנק שוברים — ניהול חכם של הנכסים הדיגיטליים שלך
        </p>
      </div>
    </div>
  )
}
