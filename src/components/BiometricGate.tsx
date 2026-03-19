import { useState, useEffect } from 'react'
import { Fingerprint, ShieldCheck, X } from 'lucide-react'
import { isBiometricEnabled, verifyBiometric, disableBiometric } from '../lib/passkey'
import toast from 'react-hot-toast'

interface Props {
  onUnlock: () => void
  onSignOut: () => void
}

export default function BiometricGate({ onUnlock, onSignOut }: Props) {
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  // Auto-trigger biometric on mount
  useEffect(() => {
    handleVerify()
  }, [])

  async function handleVerify() {
    if (loading) return
    setLoading(true)
    setFailed(false)
    try {
      const ok = await verifyBiometric()
      if (ok) {
        onUnlock()
      } else {
        setFailed(true)
        toast.error('אימות ביומטרי נכשל')
      }
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  function handleDisable() {
    disableBiometric()
    onUnlock()
  }

  return (
    <div className="min-h-dvh bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8 text-center">
        <div className={`inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-5 shadow-lg ${failed ? 'bg-gradient-to-br from-red-400 to-red-600' : 'bg-gradient-to-br from-green-400 to-emerald-600'}`}>
          {failed
            ? <X className="w-10 h-10 text-white" />
            : loading
              ? <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              : <Fingerprint className="w-10 h-10 text-white" />
          }
        </div>

        <h2 className="text-xl font-bold text-gray-800 mb-2">אימות ביומטרי</h2>
        <p className="text-sm text-gray-500 mb-6">
          {loading
            ? 'ממתין לאימות...'
            : failed
              ? 'האימות נכשל. נסה שוב.'
              : 'השתמש בזיהוי פנים או טביעת אצבע כדי להיכנס'}
        </p>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-50 mb-3"
        >
          {loading ? 'מאמת...' : 'אמת זהות'}
        </button>

        <button
          onClick={handleDisable}
          className="w-full text-sm text-gray-400 hover:text-gray-600 py-2"
        >
          בטל נעילה ביומטרית
        </button>

        <button
          onClick={onSignOut}
          className="w-full text-sm text-red-400 hover:text-red-600 py-2"
        >
          יציאה מהחשבון
        </button>
      </div>

      <div className="flex items-center gap-2 mt-4 text-xs text-gray-400">
        <ShieldCheck className="w-4 h-4" />
        <span>מוגן על ידי WebAuthn / Passkey</span>
      </div>
    </div>
  )
}
