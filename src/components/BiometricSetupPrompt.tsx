import { useState } from 'react'
import { Fingerprint, X } from 'lucide-react'
import { registerBiometric, isBiometricSupported } from '../lib/passkey'
import toast from 'react-hot-toast'

interface Props {
  userId: string
  userName: string
  userEmail?: string
  onDone: () => void
}

export default function BiometricSetupPrompt({ userId, userName, userEmail, onDone }: Props) {
  const [loading, setLoading] = useState(false)

  if (!isBiometricSupported()) return null

  async function handleEnable() {
    setLoading(true)
    const ok = await registerBiometric(userId, userName, userEmail)
    setLoading(false)
    if (ok) {
      toast.success('נעילה ביומטרית הופעלה!')
      onDone()
    } else {
      toast.error('לא ניתן לרשום אימות ביומטרי — נסה שוב')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 text-center animate-slide-up">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-green-400 to-emerald-600 rounded-2xl shadow-lg mb-4">
          <Fingerprint className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-2">הפעל נעילה ביומטרית?</h2>
        <p className="text-sm text-gray-500 mb-5">
          הגן על השוברים שלך עם זיהוי פנים, טביעת אצבע, או מפתח אבטחה — כל פתיחה של האפליקציה תדרוש אימות.
        </p>

        <button
          onClick={handleEnable}
          disabled={loading}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md mb-3 disabled:opacity-50"
        >
          {loading ? 'מגדיר...' : 'הפעל אימות ביומטרי'}
        </button>

        <button
          onClick={onDone}
          className="w-full flex items-center justify-center gap-1 text-sm text-gray-400 hover:text-gray-600 py-2"
        >
          <X className="w-3.5 h-3.5" />
          לא עכשיו
        </button>
      </div>
    </div>
  )
}
