import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, ShieldCheck, Fingerprint } from 'lucide-react'
import toast from 'react-hot-toast'
import { isBiometricEnabled, getBiometricEmail, verifyBiometric } from '../lib/passkey'
import { useT } from '../lib/i18n'

const APP_VERSION = '1.0.0'

type Mode = 'login' | 'register' | 'forgot' | 'newPassword'
type LoginStep = 'email' | 'biometric' | 'password'

interface PasswordStrength {
  score: number // 0-4
  label: string
  color: string
  checks: { label: string; ok: boolean }[]
}

function getPasswordStrength(password: string, t: (k: string) => string): PasswordStrength {
  const checks = [
    { label: t('auth.check.length'), ok: password.length >= 8 },
    { label: t('auth.check.upper'), ok: /[A-Z]/.test(password) },
    { label: t('auth.check.lower'), ok: /[a-z]/.test(password) },
    { label: t('auth.check.digit'), ok: /\d/.test(password) },
    { label: t('auth.check.special'), ok: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password) },
  ]
  const score = checks.filter(c => c.ok).length
  const labels = [t('auth.strength.very.weak'), t('auth.strength.weak'), t('auth.strength.medium'), t('auth.strength.strong'), t('auth.strength.very.strong')]
  const colors = ['bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-green-400', 'bg-green-600']
  const idx = Math.min(score, labels.length - 1)
  return { score, label: labels[idx], color: colors[idx], checks }
}

export default function AuthPage({ initialMode = 'login' }: { initialMode?: Mode }) {
  const { signIn, signInWithBiometric, signUp, signInWithGoogle, resetPassword, updatePassword } = useAuth()
  const { t } = useT()
  const [googleLoading, setGoogleLoading] = useState(false)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [loginStep, setLoginStep] = useState<LoginStep>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [name, setName] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showStrength, setShowStrength] = useState(false)
  const [biometricLoading, setBiometricLoading] = useState(false)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null)

  const strength = useMemo(() => getPasswordStrength(password, t), [password, t])
  const isRegisterOrNew = mode === 'register' || mode === 'newPassword'

  // When "Continue" is clicked on the email step
  function handleEmailContinue(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return toast.error(t('auth.email.required'))
    const biometricEmail = getBiometricEmail()
    if (
      isBiometricEnabled() &&
      biometricEmail &&
      email.toLowerCase() === biometricEmail.toLowerCase()
    ) {
      setLoginStep('biometric')
    } else {
      setLoginStep('password')
    }
  }

  async function handleBiometricLogin() {
    setBiometricLoading(true)
    try {
      const ok = await verifyBiometric()
      if (!ok) {
        toast.error(t('auth.biometric.failed'))
        return
      }
      const { error } = await signInWithBiometric()
      if (error) {
        // Session expired — fall back to password
        toast(t('auth.session.expired'))
        setLoginStep('password')
      }
    } finally {
      setBiometricLoading(false)
    }
  }

  function validatePasswordStrong(): boolean {
    if (strength.score < 3) {
      toast.error(t('auth.password.too.weak'))
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
        if (!email) return toast.error(t('auth.email.required'))
        const { error } = await resetPassword(email)
        if (error) toast.error(t('auth.reset.email.error'))
        else {
          toast.success(t('auth.reset.email.sent'))
          setMode('login')
          setLoginStep('email')
          setEmail('')
        }
        return
      }

      if (mode === 'newPassword') {
        if (!password) return toast.error(t('auth.new.password.required'))
        if (password !== password2) return toast.error(t('auth.passwords.mismatch'))
        if (!validatePasswordStrong()) return
        const { error } = await updatePassword(password)
        if (error) toast.error(t('auth.update.password.error'))
        else toast.success(t('auth.password.updated'))
        return
      }

      // login – password step
      if (mode === 'login') {
        if (!password) return toast.error(t('auth.password.required'))
        const { error } = await signIn(email, password)
        if (!error) {
          // Store password transiently so E2EEProvider can derive/unlock the vault
          // without requiring a separate vault passphrase entry.
          sessionStorage.setItem('gs_vault_pw_pending', password)
        }
        if (error) {
          const msg = error.message ?? ''
          if (msg.toLowerCase().includes('not confirmed') || msg.toLowerCase().includes('email_not_confirmed')) {
            setPendingConfirmEmail(email)
            setLoginStep('email')
            setPassword('')
            toast.error(t('auth.email.not.confirmed'))
          } else {
            toast.error(t('auth.invalid.credentials'))
          }
        }
        return
      }

      // register
      if (!privacyAccepted) return toast.error(t('auth.privacy.required'))
      if (!email || !password) return toast.error(t('auth.email.password.required'))
      if (password !== password2) return toast.error(t('auth.passwords.mismatch'))
      if (!validatePasswordStrong()) return
      const { error } = await signUp(email, password, name)
      if (error) toast.error(t('auth.register.error') + ': ' + error.message)
      else {
        // Switch to login tab and show email confirmation notice
        const registeredEmail = email
        setEmail(registeredEmail)
        setPassword('')
        setPassword2('')
        setName('')
        setPrivacyAccepted(false)
        setMode('login')
        setLoginStep('email')
        setPendingConfirmEmail(registeredEmail)
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Biometric step (full-screen style within the card) ──────────────────────
  if (mode === 'login' && loginStep === 'biometric') {
    return (
      <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.png" alt="GiftSmart" className="w-40 h-40 object-contain mx-auto" />
          </div>
          <div className="bg-white rounded-3xl shadow-xl p-8 text-center">
            <div className={`inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-lg bg-gradient-to-br from-green-400 to-emerald-600`}>
              {biometricLoading
                ? <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
                : <Fingerprint className="w-10 h-10 text-white" />}
            </div>

            <p className="text-xs text-gray-400 mb-1 font-mono" dir="ltr">{email}</p>
            <h2 className="text-xl font-bold text-gray-800 mb-2">{t('auth.biometric.title')}</h2>
            <p className="text-sm text-gray-500 mb-6">
              {biometricLoading ? t('auth.biometric.waiting') : t('auth.biometric.prompt')}
            </p>

            <button
              onClick={handleBiometricLogin}
              disabled={biometricLoading}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-50 mb-3"
            >
              {biometricLoading
                ? <div className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                : <Fingerprint className="w-5 h-5" />}
              {biometricLoading ? t('auth.biometric.verifying') : t('auth.biometric.verify')}
            </button>

            <button
              onClick={() => setLoginStep('password')}
              className="w-full text-sm text-gray-400 hover:text-green-600 transition-colors py-2"
            >
              {t('auth.use.password')}
            </button>
            <button
              onClick={() => { setLoginStep('email'); setEmail('') }}
              className="flex items-center justify-center gap-1 text-sm text-gray-300 hover:text-gray-500 transition-colors py-1 mx-auto"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              {t('auth.change.account')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="GiftSmart" className="w-40 h-40 object-contain mx-auto" />
          <span className="text-xs text-gray-400 mt-1 block">{t('auth.version')} {APP_VERSION}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl p-6">

          {/* Forgot / NewPassword header */}
          {(mode === 'forgot' || mode === 'newPassword') ? (
            <div className="mb-6">
              {mode !== 'newPassword' && (
                <button
                  onClick={() => { setMode('login'); setLoginStep('email'); setEmail('') }}
                  className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 mb-3"
                >
                  <ArrowRight className="w-4 h-4" />
                  {t('app.back')}
                </button>
              )}
              <h2 className="text-lg font-bold text-gray-800">
                {mode === 'forgot' ? t('auth.reset.title') : t('auth.new.password.title')}
              </h2>
              <p className="text-sm text-gray-500 mt-1">
                {mode === 'forgot'
                  ? t('auth.reset.desc')
                  : t('auth.new.password.desc')}
              </p>
            </div>
          ) : (
            /* Login / Register Tabs */
            <div className="flex bg-gray-100 rounded-2xl p-1 mb-6">
              <button
                onClick={() => { setMode('login'); setLoginStep('email'); setEmail(''); setPassword('') }}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${
                  mode === 'login' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                }`}
              >
                {t('auth.login.tab')}
              </button>
              <button
                onClick={() => { setMode('register'); setPendingConfirmEmail(null) }}
                className={`flex-1 py-2 text-sm font-medium rounded-xl transition-all ${
                  mode === 'register' ? 'bg-white shadow text-green-600' : 'text-gray-500'
                }`}
              >
                {t('auth.register.tab')}
              </button>
            </div>
          )}

          {/* Email confirmation notice */}
          {mode === 'login' && pendingConfirmEmail && (
            <div className="mb-4 p-3 rounded-2xl bg-blue-50 border border-blue-200 text-sm text-blue-800 leading-relaxed">
              {t('auth.register.confirm.email')}
            </div>
          )}

          {/* ── LOGIN 2-STEP FLOW ─────────────────────────────────────── */}
          {mode === 'login' && loginStep === 'email' && (
            <form onSubmit={handleEmailContinue} className="space-y-4" noValidate>
              <div className="relative">
                <Mail className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                <input
                  id="auth-email"
                  type="email"
                  placeholder={t('auth.email.placeholder')}
                  aria-label={t('auth.email.placeholder')}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoComplete="email"
                  autoFocus
                  dir="ltr"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md hover:shadow-lg transition-all"
              >
                {t('auth.continue')}
              </button>
            </form>
          )}

          {/* ── LOGIN PASSWORD STEP ───────────────────────────────────── */}
          {mode === 'login' && loginStep === 'password' && (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {/* Email display with back arrow */}
              <button
                type="button"
                onClick={() => { setLoginStep('email'); setPassword('') }}
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors w-full"
              >
                <ArrowRight className="w-4 h-4 flex-shrink-0" />
                <span className="font-mono text-xs truncate" dir="ltr">{email}</span>
              </button>

              <div>
                <div className="relative">
                  <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                  <input
                    id="auth-password"
                    type={showPass ? 'text' : 'password'}
                    placeholder={t('auth.password.placeholder')}
                    aria-label={t('auth.password.placeholder')}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    autoComplete="current-password"
                    autoFocus
                    dir="ltr"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPass(!showPass)}
                    aria-label={showPass ? t('auth.hide.password') : t('auth.show.password')}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                  >
                    {showPass ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-70 active:scale-98"
              >
                {loading ? '...' : t('auth.login.tab')}
              </button>

              <button
                type="button"
                onClick={() => { setMode('forgot') }}
                className="w-full text-center text-sm text-gray-400 hover:text-green-600 transition-colors pt-1"
              >
                {t('auth.forgot.password')}
              </button>
            </form>
          )}

          {/* ── REGISTER & OTHER MODES ────────────────────────────────── */}
          {mode !== 'login' && (
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {mode === 'register' && (
                <div className="relative">
                  <User className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                  <input
                    id="auth-name"
                    type="text"
                    placeholder={t('auth.name.placeholder')}
                    aria-label={t('auth.name.placeholder')}
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
                    placeholder={t('auth.email.placeholder')}
                    aria-label={t('auth.email.placeholder')}
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                    autoComplete="email"
                    dir="ltr"
                  />
                </div>
              )}

              {mode !== 'forgot' && (
                <>
                  <div>
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden="true" />
                      <input
                        id="auth-password"
                        type={showPass ? 'text' : 'password'}
                        placeholder={mode === 'newPassword' ? t('auth.password.new.placeholder') : t('auth.password.placeholder')}
                        aria-label={mode === 'newPassword' ? t('auth.password.new.placeholder') : t('auth.password.placeholder')}
                        value={password}
                        onChange={e => { setPassword(e.target.value); if (isRegisterOrNew) setShowStrength(true) }}
                        className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                        autoComplete="new-password"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        aria-label={showPass ? t('auth.hide.password') : t('auth.show.password')}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                      >
                        {showPass ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                      </button>
                    </div>

                    {/* Password strength meter */}
                    {isRegisterOrNew && showStrength && password.length > 0 && (
                      <div className="mt-2 space-y-2">
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

                  {isRegisterOrNew && (
                    <div className="relative">
                      <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder={t('auth.password.confirm.placeholder')}
                        value={password2}
                        onChange={e => setPassword2(e.target.value)}
                        className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
                        autoComplete="new-password"
                        dir="ltr"
                      />
                    </div>
                  )}
                </>
              )}

                      {mode === 'register' && (
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={privacyAccepted}
                    onChange={e => setPrivacyAccepted(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-green-600 flex-shrink-0"
                  />
                  <span className="text-xs text-gray-500 leading-relaxed">
                    {t('auth.privacy.agree')}
                    <a
                      href="/terms"
                      target="_blank"
                      rel="noreferrer"
                      className="text-green-600 underline font-medium mx-0.5"
                      onClick={e => e.stopPropagation()}
                    >
                      {t('auth.privacy.terms')}
                    </a>
                    {t('auth.privacy.and')}
                    <a
                      href="/privacy"
                      target="_blank"
                      rel="noreferrer"
                      className="text-green-600 underline font-medium mx-0.5"
                      onClick={e => e.stopPropagation()}
                    >
                      {t('auth.privacy.policy')}
                    </a>
                    {t('auth.privacy.age')}
                  </span>
                </label>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-70 active:scale-98"
              >
                {loading ? '...' : mode === 'register' ? t('auth.register.tab') : mode === 'forgot' ? t('auth.send.link') : t('auth.update.password')}
              </button>
            </form>
          )}

          {/* Google OAuth — shown on login (email step) / register only */}
          {(mode === 'register' || (mode === 'login' && loginStep === 'email')) && (
            <>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-gray-200" />
                <span className="text-xs text-gray-400">{t('auth.or')}</span>
                <div className="flex-1 h-px bg-gray-200" />
              </div>
              <button
                type="button"
                disabled={googleLoading || (mode === 'register' && !privacyAccepted)}
                onClick={async () => {
                  if (mode === 'register' && !privacyAccepted) {
                    toast.error(t('auth.privacy.required'))
                    return
                  }
                  setGoogleLoading(true)
                  const { error } = await signInWithGoogle()
                  if (error) { toast.error(t('auth.google.error')); setGoogleLoading(false) }
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
                {mode === 'login' ? t('auth.google.login') : t('auth.google.register')}
              </button>
            </>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          {t('auth.footer')}
        </p>
      </div>
    </div>
  )
}
