import { useState } from 'react'
import { ShieldCheck, Copy, CheckCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

interface Props {
  phrase: string
  onDone: () => void
}

export default function RecoveryKeyModal({ phrase, onDone }: Props) {
  const [copied, setCopied] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(phrase)
      setCopied(true)
      toast.success('מפתח השחזור הועתק')
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast.error('לא ניתן להעתיק — העתק ידנית')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl p-6 text-center">

        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl shadow-lg mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-1">שמור את מפתח השחזור</h2>
        <p className="text-xs text-gray-500 mb-4 leading-relaxed">
          אם תשכח את הסיסמה, מפתח זה הוא הדרך היחידה לשחזר את הכספת המוצפנת שלך.
          <br />
          <strong>לא ניתן לשחזרו לאחר סגירת חלון זה.</strong>
        </p>

        {/* Recovery phrase display */}
        <div
          dir="ltr"
          className="bg-gray-50 border border-gray-200 rounded-2xl p-4 mb-3 font-mono text-base font-bold tracking-widest text-gray-800 select-all"
        >
          {phrase}
        </div>

        <button
          onClick={handleCopy}
          className="w-full flex items-center justify-center gap-2 border border-gray-200 text-gray-600 hover:bg-gray-50 py-2.5 rounded-2xl text-sm font-medium mb-4 transition-colors"
        >
          {copied
            ? <><CheckCircle className="w-4 h-4 text-green-500" /> הועתק!</>
            : <><Copy className="w-4 h-4" /> העתק מפתח שחזור</>
          }
        </button>

        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4 text-right">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 leading-relaxed">
            שמור את המפתח במקום מאובטח — לא בצ'אט, לא בדוא"ל. אנחנו לא שומרים עותק שלו.
          </p>
        </div>

        <label className="flex items-center gap-2.5 cursor-pointer mb-4 text-right">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="w-4 h-4 accent-green-600 flex-shrink-0"
          />
          <span className="text-xs text-gray-600">שמרתי את מפתח השחזור במקום בטוח</span>
        </label>

        <button
          onClick={onDone}
          disabled={!confirmed}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-40 transition-all"
        >
          המשך
        </button>
      </div>
    </div>
  )
}
