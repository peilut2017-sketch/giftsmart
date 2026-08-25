import { useState } from 'react'
import { ShieldCheck, Copy, CheckCircle, AlertTriangle, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { useT } from '../lib/i18n'

interface Props {
  phrase: string
  onDone: () => void
}

// One-time display of the vault recovery code. v2 gated "המשך" on a 16px checkbox
// that verified nothing; this version verifies the user actually saved it by asking
// them to retype two of the six groups, and offers a real file download alongside
// copy — pen-and-paper was previously the only sanctioned storage method.
export default function RecoveryKeyModal({ phrase, onDone }: Props) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const [step, setStep] = useState<'show' | 'verify'>('show')
  const groups = phrase.split('-')
  // Verify groups 2 and 5 (indexes 1 and 4)
  const [check1, setCheck1] = useState('')
  const [check2, setCheck2] = useState('')
  const [verifyError, setVerifyError] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(phrase)
      setCopied(true)
      toast.success(t('recovery.copied.toast'))
      setTimeout(() => setCopied(false), 3000)
    } catch {
      toast.error(t('recovery.copy.failed'))
    }
  }

  function handleDownload() {
    const content = [
      t('recovery.file.title'),
      t('recovery.file.created', { date: new Date().toLocaleDateString('he-IL') }),
      '',
      phrase,
      '',
      t('recovery.file.store'),
      t('recovery.file.warning'),
    ].join('\n')
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'giftsmart-recovery-key.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  function handleVerify() {
    const ok =
      check1.trim().toUpperCase() === groups[1]?.toUpperCase() &&
      check2.trim().toUpperCase() === groups[4]?.toUpperCase()
    if (!ok) {
      setVerifyError(true)
      return
    }
    onDone()
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-[110] flex items-center justify-center p-4">
      <div className="bg-surface w-full max-w-sm rounded-3xl shadow-2xl p-6 text-center max-h-[92dvh] overflow-y-auto modal-scroll">

        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-amber-400 to-orange-500 rounded-2xl shadow-lg mb-4">
          <ShieldCheck className="w-8 h-8 text-white" />
        </div>

        {step === 'show' ? (
          <>
            <h2 className="text-lg font-bold text-text mb-1">{t('recovery.title')}</h2>
            <p className="text-xs text-text2 mb-4 leading-relaxed">
              {t('recovery.subtitle')}
              <br />
              <strong>{t('recovery.once')}</strong>
            </p>

            <div
              dir="ltr"
              className="bg-bg border border-border rounded-2xl p-4 mb-3 font-mono text-base font-bold tracking-widest text-text select-all break-all"
            >
              {phrase}
            </div>

            <div className="flex gap-2 mb-4">
              <button
                onClick={handleCopy}
                className="flex-1 flex items-center justify-center gap-1.5 border border-border text-text2 hover:bg-bg py-2.5 rounded-2xl text-sm font-medium transition-colors"
              >
                {copied
                  ? <><CheckCircle className="w-4 h-4 text-primary" /> {t('checkout.copied')}</>
                  : <><Copy className="w-4 h-4" /> {t('market.payment.copy')}</>
                }
              </button>
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-1.5 border border-border text-text2 hover:bg-bg py-2.5 rounded-2xl text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" /> {t('recovery.download')}
              </button>
            </div>

            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4 text-right">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 leading-relaxed">
                {t('recovery.warning')}
              </p>
            </div>

            <button
              onClick={() => setStep('verify')}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md transition-colors duration-150"
            >
              {t('recovery.saved.continue')}
            </button>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-text mb-1">{t('recovery.verify.title')}</h2>
            <p className="text-xs text-text2 mb-4 leading-relaxed">
              {t('recovery.verify.subtitle')}
            </p>

            <div dir="ltr" className="flex items-center justify-center gap-1.5 mb-4 font-mono text-sm text-text3">
              <span>{groups[0]}</span>
              <input
                value={check1}
                onChange={e => { setCheck1(e.target.value); setVerifyError(false) }}
                maxLength={4}
                className={`w-16 text-center py-1.5 border rounded-lg bg-surface text-text font-bold uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 ${verifyError ? 'border-error' : 'border-border'}`}
                autoCapitalize="characters"
                autoFocus
                aria-label={t('recovery.group2')}
              />
              <span>{groups[2]}</span>
              <span>{groups[3]}</span>
              <input
                value={check2}
                onChange={e => { setCheck2(e.target.value); setVerifyError(false) }}
                maxLength={4}
                className={`w-16 text-center py-1.5 border rounded-lg bg-surface text-text font-bold uppercase focus:outline-none focus:ring-2 focus:ring-primary/40 ${verifyError ? 'border-error' : 'border-border'}`}
                autoCapitalize="characters"
                aria-label={t('recovery.group5')}
              />
              <span>{groups[5]}</span>
            </div>

            {verifyError && (
              <p className="text-xs text-error mb-3" role="alert">{t('recovery.verify.error')}</p>
            )}

            <button
              onClick={handleVerify}
              disabled={check1.length < 4 || check2.length < 4}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white py-3 rounded-2xl font-semibold text-sm shadow-md disabled:opacity-40 transition-opacity duration-150 mb-2"
            >
              {t('app.done')}
            </button>
            <button onClick={() => setStep('show')} className="w-full text-xs text-text3 py-2">
              {t('recovery.back.to.code')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
