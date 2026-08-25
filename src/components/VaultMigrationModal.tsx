import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck, Lock, Eye, EyeOff, Info } from 'lucide-react'
import { SHEET_SPRING, BACKDROP_FADE } from '../lib/motion'
import { useE2EE } from '../contexts/E2EEContext'
import { useVouchers } from '../contexts/VoucherContext'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'

interface Props {
  onDone: () => void
  onSkip: () => void
}

// Upgrades a legacy separate-passphrase vault to v3: the vouchers are re-encrypted
// under a fresh random master key and everything commits in ONE server transaction
// (commit_vault_rekey) — a mid-flight failure leaves the old vault fully intact.
// The login password is no longer needed here: its door is added automatically on
// the next login.
export default function VaultMigrationModal({ onDone, onSkip }: Props) {
  const { t } = useT()
  const reduceMotion = useReducedMotion()
  const { migrateVault } = useE2EE()
  const { vouchers, archivedVouchers, refreshVouchers } = useVouchers()
  const [passphrase, setPassphrase] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleMigrate() {
    if (!passphrase || loading) return
    setLoading(true)
    setError('')
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, failed } = await migrateVault(passphrase, undefined, e2eeVouchers)
      if (!ok) {
        if (failed && failed > 0) {
          setError(t('vault.migrate.failed.count', { n: failed }))
        } else {
          setError(t('vault.migrate.wrong.password'))
        }
        return
      }
      // Voucher rows were rewritten atomically on the server — refresh local state
      await refreshVouchers()
      toast.success(t('vault.migrate.success'))
      onDone()
    } catch {
      setError(t('vault.migrate.error'))
    } finally {
      setLoading(false)
    }
  }

  // Mounted/unmounted by the parent (VaultModals in App.tsx) inside an
  // <AnimatePresence>, so the root motion.div's exit animation plays on unmount.
  return (
    <motion.div
      className="fixed inset-0 bg-black/60 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={BACKDROP_FADE}
    >
      <motion.div
        className="bg-surface w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6 text-center max-h-[92dvh] overflow-y-auto modal-scroll"
        initial={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        animate={reduceMotion ? { opacity: 1 } : { y: 0 }}
        exit={reduceMotion ? { opacity: 0 } : { y: '100%' }}
        transition={reduceMotion ? { duration: 0.15 } : SHEET_SPRING}
      >

        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-primary-mid to-primary-dark rounded-2xl shadow-lg mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>

        <h2 className="text-lg font-bold text-text mb-2">{t('vault.migrate.title')}</h2>

        <p className="text-sm text-text2 mb-4 leading-relaxed">
          {t('vault.migrate.desc1')}
          <br />
          {t('vault.migrate.desc2.pre')} <strong>{t('vault.migrate.desc2.bold')}</strong> {t('vault.migrate.desc2.post')}
        </p>

        <div className="flex items-start gap-2 bg-primary-light/50 border border-primary/15 rounded-2xl p-3 mb-4 text-right">
          <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text2 leading-relaxed">
            {t('vault.migrate.info')}
          </p>
        </div>

        <div className="relative mb-3">
          <Lock className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text3" />
          <input
            type={showPass ? 'text' : 'password'}
            placeholder={t('vault.migrate.placeholder')}
            value={passphrase}
            onChange={e => { setPassphrase(e.target.value); setError('') }}
            onKeyDown={e => e.key === 'Enter' && handleMigrate()}
            className="w-full px-10 py-3 border border-border rounded-2xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/40"
            dir="ltr"
            autoFocus
          />
          <button
            type="button"
            onClick={() => setShowPass(!showPass)}
            aria-label={showPass ? t('auth.hide.password') : t('auth.show.password')}
            className="absolute start-3 top-1/2 -translate-y-1/2 text-text3 p-1"
          >
            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        {error && <p className="text-xs text-error mb-3 text-right leading-relaxed" role="alert">{error}</p>}

        <button
          onClick={handleMigrate}
          disabled={loading || !passphrase}
          className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md mb-3 disabled:opacity-50"
        >
          {loading ? t('vault.migrate.encrypting') : t('vault.migrate.button')}
        </button>

        <button
          onClick={onSkip}
          className="w-full text-sm text-text3 hover:text-text2 py-2"
        >
          {t('vault.migrate.not.now')}
        </button>
      </motion.div>
    </motion.div>
  )
}
