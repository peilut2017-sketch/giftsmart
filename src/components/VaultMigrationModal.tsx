import { useState } from 'react'
import { ShieldCheck, Lock, Eye, EyeOff, LogOut, Info } from 'lucide-react'
import { useE2EE } from '../contexts/E2EEContext'
import { useAuth } from '../contexts/AuthContext'
import { useVouchers } from '../contexts/VoucherContext'
import toast from 'react-hot-toast'

interface Props {
  onDone: () => void
  onSkip: () => void
}

export default function VaultMigrationModal({ onDone, onSkip }: Props) {
  const { migrateVault } = useE2EE()
  const { signOut } = useAuth()
  const { vouchers, archivedVouchers, updateVoucher } = useVouchers()
  const [passphrase, setPassphrase] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)

  const loginPwAvailable = !!sessionStorage.getItem('gs_vault_migrate_pw')

  async function handleMigrate() {
    if (!passphrase) return toast.error('הזן את סיסמת הכספת הנוכחית')
    setLoading(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await migrateVault(passphrase, undefined, e2eeVouchers)
      if (!ok) { toast.error('סיסמת הכספת שגויה — נסה שוב'); return }
      await Promise.all(entries.map(({ id, code, cvv }) =>
        updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })
      ))
      toast.success(`הכספת שודרגה! ${entries.length} שוברים הוצפנו מחדש`)
      onDone()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 text-center animate-slide-up">

        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-blue-400 to-indigo-600 rounded-2xl shadow-lg mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-lg font-bold text-gray-800 mb-2">אחד לסיסמה אחת</h2>

        {loginPwAvailable ? (
          <>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              הכספת שלך עדיין משתמשת בסיסמה נפרדת.
              <br />
              הזן אותה פעם אחרונה — לאחר מכן <strong>סיסמת ה-login שלך</strong> תפתח את הכספת אוטומטית.
            </p>

            <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-2xl p-3 mb-4 text-right">
              <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-blue-700 leading-relaxed">
                כל השוברים המוצפנים יוצפנו מחדש תחת המפתח החדש. הסיסמה הנוכחית לא תישמר בשום מקום.
              </p>
            </div>

            <div className="relative mb-4">
              <Lock className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPass ? 'text' : 'password'}
                placeholder="סיסמת כספת נוכחית"
                value={passphrase}
                onChange={e => setPassphrase(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleMigrate()}
                className="w-full pr-10 pl-10 py-3 border border-gray-200 rounded-2xl text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
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

            <button
              onClick={handleMigrate}
              disabled={loading || !passphrase}
              className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md mb-3 disabled:opacity-50"
            >
              {loading ? 'מצפין מחדש...' : 'אחד ושדרג'}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500 mb-4 leading-relaxed">
              כדי לאחד, המערכת צריכה לדעת את סיסמת הכניסה שלך.
              <br />
              התנתק והתחבר מחדש עם הסיסמה, ואז תוכל לבצע את האיחוד.
            </p>

            <button
              onClick={() => signOut()}
              className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md mb-3"
            >
              <LogOut className="w-4 h-4" />
              התנתק והתחבר מחדש
            </button>
          </>
        )}

        <button
          onClick={onSkip}
          className="w-full text-sm text-gray-400 hover:text-gray-600 py-2"
        >
          לא עכשיו — המשך עם סיסמה נפרדת
        </button>
      </div>
    </div>
  )
}
