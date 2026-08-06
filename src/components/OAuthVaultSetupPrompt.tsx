import { useState } from 'react'
import { ShieldCheck, Lock, Eye, EyeOff, X } from 'lucide-react'
import { useE2EE } from '../contexts/E2EEContext'
import { useAuth } from '../contexts/AuthContext'
import toast from 'react-hot-toast'

// Shown to Google/OAuth users who have no E2EE vault.
// They have no login password we can derive a key from, so they choose a passphrase explicitly.
// After setup they can enable biometric to avoid entering it every session.
export default function OAuthVaultSetupPrompt() {
  const { setupVaultFromPassword, dismissRecoveryPhrase } = useE2EE()
  const { user } = useAuth()
  const [passphrase, setPassphrase] = useState('')
  const [passphrase2, setPassphrase2] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSetup() {
    if (passphrase.length < 8) return toast.error('הסיסמה חייבת להיות לפחות 8 תווים')
    if (passphrase !== passphrase2) return toast.error('הסיסמאות אינן תואמות')
    if (!user?.id) return
    setLoading(true)
    try {
      // v2 vault: metadata synced to Supabase (works on any device), recovery
      // phrase generated and shown once. The legacy setupVault path kept the
      // passphrase in sessionStorage, never synced, and broke on a second device.
      await setupVaultFromPassword(passphrase, user.id)
      toast.success('כספת הוגדרה בהצלחה!')
    } catch {
      toast.error('שגיאה בהגדרת הכספת')
    } finally {
      setLoading(false)
    }
  }

  // Dismiss without setting up — vault remains disabled
  function handleSkip() {
    dismissRecoveryPhrase()
  }

  const provider = user?.app_metadata?.provider ?? 'OAuth'
  const providerName = provider === 'google' ? 'Google' : provider

  return (
    <div className="fixed inset-0 bg-black/50 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 animate-slide-up">

        <div className="flex items-center justify-between mb-4">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl shadow-lg">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <button onClick={handleSkip} className="text-gray-400 hover:text-gray-600 p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-1">הגדר כספת מוצפנת</h2>
        <p className="text-sm text-gray-500 mb-4 leading-relaxed">
          כיוון שנכנסת דרך {providerName}, אין לנו סיסמה לגזירת מפתח הכספת.
          בחר סיסמת כספת ייעודית — לאחר מכן תוכל לאפשר ביומטרי כדי לדלג עליה.
        </p>

        <div className="space-y-3 mb-4">
          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showPass ? 'text' : 'password'}
              placeholder="סיסמת כספת (לפחות 8 תווים)"
              value={passphrase}
              onChange={e => setPassphrase(e.target.value)}
              className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
              dir="ltr"
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <div className="relative">
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type={showPass ? 'text' : 'password'}
              placeholder="אמת סיסמת כספת"
              value={passphrase2}
              onChange={e => setPassphrase2(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSetup()}
              className="w-full pr-10 pl-4 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-green-300"
              dir="ltr"
            />
          </div>
        </div>

        <button
          onClick={handleSetup}
          disabled={loading || passphrase.length < 8 || !passphrase2}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md mb-3 disabled:opacity-50"
        >
          {loading ? 'מגדיר...' : 'הגדר כספת'}
        </button>

        <button
          onClick={handleSkip}
          className="w-full text-sm text-gray-400 hover:text-gray-600 py-2"
        >
          לא עכשיו
        </button>
      </div>
    </div>
  )
}
