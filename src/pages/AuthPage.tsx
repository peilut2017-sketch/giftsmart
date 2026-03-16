import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Wallet, Mail, Lock, User, ArrowRight } from 'lucide-react'
import toast from 'react-hot-toast'

const APP_VERSION = '1.0.0'

type Mode = 'login' | 'register' | 'forgot' | 'newPassword'

export default function AuthPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { signIn, signUp, resetPassword, updatePassword } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [name, setName] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)

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
        if (password.length < 6) return toast.error('הסיסמה חייבת להכיל לפחות 6 תווים')
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
        if (password.length < 6) return toast.error('הסיסמה חייבת להכיל לפחות 6 תווים')
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
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-400 to-emerald-600 rounded-3xl shadow-lg mb-4">
            <Wallet className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-800">ארנק שוברים</h1>
          <p className="text-sm text-gray-500 mt-1">נהל את השוברים שלך בקלות</p>
          <span className="text-xs text-gray-400">גרסה {APP_VERSION}</span>
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

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="שם מלא"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
            )}

            {mode !== 'newPassword' && (
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  placeholder="כתובת אימייל"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoComplete="email"
                  dir="ltr"
                />
              </div>
            )}

            {mode !== 'forgot' && (
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder={mode === 'newPassword' ? 'סיסמה חדשה' : 'סיסמה'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            )}

            {(mode === 'register' || mode === 'newPassword') && (
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="אימות סיסמה"
                  value={password2}
                  onChange={e => setPassword2(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          ארנק שוברים — ניהול חכם של הנכסים הדיגיטליים שלך
        </p>
      </div>
    </div>
  )
}
