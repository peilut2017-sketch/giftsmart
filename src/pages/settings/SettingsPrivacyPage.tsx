import { useState } from 'react'
import { useVouchers } from '../../contexts/VoucherContext'
import { useE2EE } from '../../contexts/E2EEContext'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../../lib/passkey'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import { SettingsSubHeader, Card, SL, Spinner } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsPrivacyPage() {
  usePageView('settings_privacy')
  const { t } = useT()
  const { user, profile } = useAuth()
  const { vouchers, archivedVouchers, updateVoucher, logAction } = useVouchers()
  const {
    hasVault, hint, isVaultUnlocked, isUnifiedVault, unlockVault, unlockVaultFromRecovery,
    encrypt, resetVault, changePassphrase, disableVault, migrateVault, regenerateRecoveryKey,
    enableBiometricVaultUnlock,
  } = useE2EE()

  const [biometricEnabled, setBiometricEnabled] = useState(isBiometricEnabled)
  const [biometricLoading, setBiometricLoading] = useState(false)

  const [showVaultSection, setShowVaultSection] = useState(false)
  const [showMigrateSection, setShowMigrateSection] = useState(false)
  const [migrateVaultPass, setMigrateVaultPass] = useState('')
  const [migrateLoginPass, setMigrateLoginPass] = useState('')
  const [migrating, setMigrating] = useState(false)
  const [vaultOldPass, setVaultOldPass] = useState('')
  const [vaultNewPass, setVaultNewPass] = useState('')
  const [vaultNewPass2, setVaultNewPass2] = useState('')
  const [vaultNewHint, setVaultNewHint] = useState('')
  const [vaultChanging, setVaultChanging] = useState(false)
  const [vaultResetConfirm, setVaultResetConfirm] = useState(false)
  const [vaultDisablePass, setVaultDisablePass] = useState('')
  const [vaultDisabling, setVaultDisabling] = useState(false)
  const [vaultDisableConfirm, setVaultDisableConfirm] = useState(false)
  const [showRecoveryUnlock, setShowRecoveryUnlock] = useState(false)
  const [recoveryPhrase, setRecoveryPhrase] = useState('')
  const [recoveryUnlocking, setRecoveryUnlocking] = useState(false)

  const [e2eeDefaultNew, setE2eeDefaultNew] = useState(() => localStorage.getItem('gs_e2ee_default') !== 'false')
  const [encryptAllConfirm, setEncryptAllConfirm] = useState(false)
  const [encryptAllPass, setEncryptAllPass] = useState('')
  const [encryptingAll, setEncryptingAll] = useState(false)

  async function handleEnableBiometric() {
    setBiometricLoading(true)
    const ok = isVaultUnlocked
      ? await enableBiometricVaultUnlock(user?.id || '', profile?.name || user?.email || '', user?.email)
      : await registerBiometric(user?.id || '', profile?.name || user?.email || '', user?.email)
    setBiometricLoading(false)
    if (ok) {
      setBiometricEnabled(true)
      toast.success('נעילה ביומטרית הופעלה!')
      logAction('system_biometric_link', 'מערכת', undefined, { type: 'enabled' })
    } else toast.error('לא ניתן לרשום אימות ביומטרי')
  }

  function handleDisableBiometric() {
    disableBiometric()
    setBiometricEnabled(false)
    toast.success('נעילה ביומטרית בוטלה')
    logAction('system_biometric_link', 'מערכת', undefined, { type: 'disabled' })
  }

  async function handleMigrateVault() {
    if (!migrateVaultPass) return toast.error('הזן את סיסמת הכספת הנוכחית')
    if (!migrateLoginPass) return toast.error('הזן את סיסמת הכניסה שלך')
    setMigrating(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await migrateVault(migrateVaultPass, migrateLoginPass, e2eeVouchers)
      if (!ok) { toast.error('אחת הסיסמאות שגויה — נסה שוב'); return }
      await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })))
      toast.success(`הכספת אוחדה! ${entries.length} שוברים הוצפנו מחדש`)
      setMigrateVaultPass(''); setMigrateLoginPass(''); setShowMigrateSection(false)
    } finally {
      setMigrating(false)
    }
  }

  async function handleRecoveryUnlock() {
    if (!recoveryPhrase.trim()) return
    setRecoveryUnlocking(true)
    try {
      const ok = await unlockVaultFromRecovery(recoveryPhrase.trim())
      if (!ok) { toast.error('מפתח שחזור שגוי — בדוק את הטקסט ונסה שוב'); return }
      toast.success('הכספת נפתחה עם מפתח השחזור!')
      setShowRecoveryUnlock(false); setRecoveryPhrase('')
    } finally {
      setRecoveryUnlocking(false)
    }
  }

  async function handleChangeVaultPassphrase() {
    if (!vaultOldPass) return toast.error('הזן סיסמה נוכחית')
    if (vaultNewPass.length < 8) return toast.error('סיסמה חדשה: לפחות 8 תווים')
    if (vaultNewPass !== vaultNewPass2) return toast.error('הסיסמאות אינן תואמות')
    setVaultChanging(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await changePassphrase(vaultOldPass, vaultNewPass, e2eeVouchers, vaultNewHint)
      if (!ok) { toast.error('סיסמה נוכחית שגויה'); return }
      await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })))
      toast.success(`סיסמת כספת שונתה — ${entries.length} שוברים הוצפנו מחדש`)
      setVaultOldPass(''); setVaultNewPass(''); setVaultNewPass2(''); setVaultNewHint('')
      setShowVaultSection(false)
    } finally {
      setVaultChanging(false)
    }
  }

  async function handleDisableVault() {
    if (!vaultDisablePass) return toast.error('הזן סיסמה נוכחית')
    setVaultDisabling(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await disableVault(vaultDisablePass, e2eeVouchers)
      if (!ok) { toast.error('סיסמה שגויה'); return }
      await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, is_e2ee: false, ...(cvv != null ? { cvv } : {}) })))
      toast.success(`ההצפנה הוסרה — ${entries.length} שוברים פוענחו ונשמרו`)
      setVaultDisablePass(''); setVaultDisableConfirm(false); setShowVaultSection(false)
    } finally {
      setVaultDisabling(false)
    }
  }

  async function handleEncryptAll() {
    if (!encryptAllPass) return toast.error('הזן סיסמת כספת')
    setEncryptingAll(true)
    try {
      const ok = await unlockVault(encryptAllPass)
      if (!ok) { toast.error('סיסמת כספת שגויה'); return }
      const unencrypted = [...vouchers, ...archivedVouchers].filter(v => !v.is_e2ee)
      if (unencrypted.length === 0) { toast('כל השוברים כבר מוצפנים'); setEncryptAllConfirm(false); setEncryptAllPass(''); return }
      let count = 0
      for (const v of unencrypted) {
        try {
          const encCode = await encrypt(v.code)
          const encCvv = v.cvv ? await encrypt(v.cvv) : undefined
          await updateVoucher(v.id, { code: encCode, is_e2ee: true, ...(encCvv != null ? { cvv: encCvv } : {}) })
          count++
        } catch { /* skip individual failures */ }
      }
      toast.success(`${count} שוברים הוצפנו בהצלחה`)
      setEncryptAllConfirm(false); setEncryptAllPass('')
    } finally {
      setEncryptingAll(false)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title="פרטיות" />
      <div className="p-4 space-y-4 pb-10">
        {isBiometricSupported() && (
          <>
            <SL>ביומטריה</SL>
            <Card>
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
                  <Icon name="fingerprint" size={20} color="var(--c-text2)" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">נעילה ביומטרית</p>
                  <p className="text-xs text-text3">{biometricEnabled ? 'פעיל — Face ID / טביעת אצבע' : 'כבוי'}</p>
                </div>
                {biometricEnabled ? (
                  <button onClick={handleDisableBiometric} className="text-xs text-error font-medium px-3 py-1.5 bg-error/10 rounded-xl">בטל</button>
                ) : (
                  <button onClick={handleEnableBiometric} disabled={biometricLoading} className="text-xs text-primary font-medium px-3 py-1.5 bg-primary-light rounded-xl disabled:opacity-50">
                    {biometricLoading ? '...' : 'הפעל'}
                  </button>
                )}
              </div>
            </Card>
          </>
        )}

        {hasVault && (
          <>
            <SL>{t('settings.vault')}</SL>
            <Card>
              <button onClick={() => setShowVaultSection(s => !s)} className="flex items-center gap-3 w-full p-4 text-right hover:bg-bg">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <Icon name="shield" size={20} color="#6366f1" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{t('settings.vault')}</p>
                  <p className="text-xs text-text3">{isVaultUnlocked ? 'פתוחה כעת' : 'נעולה'} · שנה סיסמה או אפס</p>
                </div>
                <Icon name={showVaultSection ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
              </button>

              {showVaultSection && (
                <div className="px-4 pb-4 space-y-3">
                  <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-warning flex items-center gap-2">
                      <Icon name="shield" size={14} className="flex-shrink-0" /> חובה לקרוא — כדי לא לאבד את הנתונים שלך
                    </p>
                    {isUnifiedVault ? (
                      <>
                        <p className="text-xs text-warning leading-relaxed">
                          הכספת מוצפנת עם <strong>סיסמת הכניסה שלך</strong> — הסיסמה אינה נשמרת בשרתנו.
                        </p>
                        <ul className="text-xs text-warning space-y-1 list-disc pr-4">
                          <li><strong>שחזור סיסמה בדוא"ל לא ישחזר נתונים מוצפנים</strong> — שמור את מפתח השחזור במקום בטוח.</li>
                          <li>לשינוי סיסמה: עבור אל הגדרות → חשבון — הכספת תוצפן מחדש אוטומטית.</li>
                          <li>שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</li>
                        </ul>
                        {isVaultUnlocked && (
                          <button onClick={() => regenerateRecoveryKey().catch(() => {})} className="text-xs font-semibold text-warning flex items-center gap-1">
                            <Icon name="key" size={12} /> הצג / חדש מפתח שחזור
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-warning leading-relaxed">
                          <strong>הסיסמה אינה ניתנת לשחזור</strong> — שמור אותה במקום בטוח. איבוד הסיסמה יגרום לאיבוד הנתונים המוצפנים לצמיתות.
                        </p>
                        <p className="text-xs text-warning">שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</p>
                        <p className="text-xs text-warning">שינוי סיסמה יצפין מחדש אוטומטית את כל השוברים המוצפנים שלך.</p>
                      </>
                    )}
                  </div>

                  {hint && (
                    <div className="bg-indigo-50 rounded-xl px-3 py-2 text-xs text-indigo-700">
                      רמז נוכחי: <span className="font-medium">{hint}</span>
                    </div>
                  )}

                  {!isVaultUnlocked && localStorage.getItem('gs_e2ee_recovery_wrapped') && (
                    <div className="bg-primary-light border border-primary/20 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-primary flex items-center gap-1"><Icon name="key" size={14} /> פתח עם מפתח שחזור</p>
                      <p className="text-xs text-primary">שכחת סיסמה? הזן את מפתח השחזור שקיבלת בעת הגדרת הכספת.</p>
                      {!showRecoveryUnlock ? (
                        <button onClick={() => setShowRecoveryUnlock(true)} className="text-xs font-semibold text-primary">השתמש במפתח שחזור ←</button>
                      ) : (
                        <div className="space-y-2 pt-1">
                          <input
                            type="text" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={recoveryPhrase}
                            onChange={e => setRecoveryPhrase(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRecoveryUnlock()}
                            className="w-full px-3 py-2 border border-primary/30 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono tracking-widest"
                            dir="ltr" autoFocus autoComplete="off"
                          />
                          <div className="flex gap-2">
                            <button onClick={handleRecoveryUnlock} disabled={recoveryUnlocking || !recoveryPhrase.trim()} className="flex-1 py-2 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50 flex items-center justify-center gap-1">
                              {recoveryUnlocking ? <Spinner size={14} color="#fff" /> : <Icon name="key" size={12} />}
                              {recoveryUnlocking ? 'פותח...' : 'פתח כספת'}
                            </button>
                            <button onClick={() => { setShowRecoveryUnlock(false); setRecoveryPhrase('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isUnifiedVault && (
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-blue-800 flex items-center gap-1"><Icon name="shield" size={14} /> שדרג לסיסמה אחת</p>
                      <p className="text-xs text-blue-700 leading-relaxed">הכספת שלך עדיין דורשת סיסמה נפרדת מסיסמת הכניסה. לאחד — הכספת תיפתח אוטומטית בכל כניסה.</p>
                      {!showMigrateSection ? (
                        <button onClick={() => setShowMigrateSection(true)} className="text-xs font-semibold text-blue-600">אחד עכשיו ←</button>
                      ) : (
                        <div className="space-y-2 pt-1">
                          <input type="password" placeholder="סיסמת כספת נוכחית" value={migrateVaultPass} onChange={e => setMigrateVaultPass(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-blue-300" dir="ltr" autoComplete="current-password" />
                          <input type="password" placeholder="סיסמת כניסה לאתר" value={migrateLoginPass} onChange={e => setMigrateLoginPass(e.target.value)} className="w-full px-3 py-2 border border-blue-200 rounded-xl text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-blue-300" dir="ltr" autoComplete="current-password" />
                          <div className="flex gap-2">
                            <button onClick={handleMigrateVault} disabled={migrating || !migrateVaultPass || !migrateLoginPass} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                              {migrating ? 'מאחד...' : 'אחד סיסמאות'}
                            </button>
                            <button onClick={() => { setShowMigrateSection(false); setMigrateVaultPass(''); setMigrateLoginPass('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs">ביטול</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {!isUnifiedVault && (
                    <>
                      <input type="password" value={vaultOldPass} onChange={e => setVaultOldPass(e.target.value)} placeholder="סיסמה נוכחית" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" dir="ltr" autoComplete="current-password" name="vault-current-password" />
                      <input type="password" value={vaultNewPass} onChange={e => setVaultNewPass(e.target.value)} placeholder="סיסמה חדשה (לפחות 8 תווים)" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" dir="ltr" autoComplete="new-password" name="vault-new-password" />
                      <input type="password" value={vaultNewPass2} onChange={e => setVaultNewPass2(e.target.value)} placeholder="אימות סיסמה חדשה" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" dir="ltr" autoComplete="new-password" name="vault-new-password-confirm" />
                      <input type="text" value={vaultNewHint} onChange={e => setVaultNewHint(e.target.value)} placeholder="רמז לסיסמה החדשה (אופציונלי)" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" autoComplete="off" name="vault-new-hint" />
                      <button onClick={handleChangeVaultPassphrase} disabled={vaultChanging || !vaultOldPass || !vaultNewPass || !vaultNewPass2} className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                        {vaultChanging ? 'מצפין מחדש...' : t('e2ee.change')}
                      </button>
                    </>
                  )}

                  <div className="border-t border-border pt-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text">הצפן שוברים חדשים כברירת מחדל</p>
                        <p className="text-xs text-text3 mt-0.5">כל שובר חדש שיתווסף יוצפן אוטומטית</p>
                      </div>
                      <button
                        role="switch" aria-checked={e2eeDefaultNew}
                        onClick={() => { const next = !e2eeDefaultNew; setE2eeDefaultNew(next); localStorage.setItem('gs_e2ee_default', String(next)) }}
                        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${e2eeDefaultNew ? 'bg-indigo-600' : 'bg-border'}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${e2eeDefaultNew ? 'translate-x-0.5' : 'right-0.5'}`} />
                      </button>
                    </div>

                    {!encryptAllConfirm ? (
                      <button onClick={() => setEncryptAllConfirm(true)} className="text-xs text-indigo-600 font-medium">הצפן את כל השוברים שעדיין לא מוצפנים</button>
                    ) : (
                      <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                        <p className="text-xs font-bold text-warning flex items-center gap-1"><Icon name="shield" size={14} /> שים לב — פעולה בלתי הפיכה</p>
                        <p className="text-xs text-warning">
                          קודי השוברים יוצפנו עם סיסמת הכספת הנוכחית.
                          <strong> אם תשכח את הסיסמה — הנתונים יאבדו לצמיתות.</strong>
                          <br />ודא שהסיסמה שמורה במקום בטוח לפני המשך.
                        </p>
                        <input type="password" placeholder="אמת סיסמת כספת" value={encryptAllPass} onChange={e => setEncryptAllPass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-indigo-300" dir="ltr" autoComplete="current-password" />
                        <div className="flex gap-2">
                          <button onClick={handleEncryptAll} disabled={encryptingAll || !encryptAllPass} className="flex-1 py-2 bg-indigo-600 text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                            {encryptingAll ? 'מצפין...' : 'הצפן הכל'}
                          </button>
                          <button onClick={() => { setEncryptAllConfirm(false); setEncryptAllPass('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs">ביטול</button>
                        </div>
                      </div>
                    )}

                    {!vaultDisableConfirm ? (
                      <button onClick={() => setVaultDisableConfirm(true)} className="text-xs text-warning">הסר הצפנה (פענח שוברים ושמור בטקסט רגיל)</button>
                    ) : (
                      <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                        <p className="text-xs text-warning font-medium">הקודים יפוענחו ויישמרו ב-DB ללא הצפנה. הנתונים לא ימחקו.</p>
                        <input type="password" placeholder="סיסמת כספת נוכחית" value={vaultDisablePass} onChange={e => setVaultDisablePass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-warning/40" autoComplete="current-password" />
                        <div className="flex gap-2">
                          <button onClick={handleDisableVault} disabled={vaultDisabling || !vaultDisablePass} className="flex-1 py-2 bg-warning text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                            {vaultDisabling ? 'מפענח...' : 'הסר הצפנה'}
                          </button>
                          <button onClick={() => { setVaultDisableConfirm(false); setVaultDisablePass('') }} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                        </div>
                      </div>
                    )}

                    {!vaultResetConfirm ? (
                      <button onClick={() => setVaultResetConfirm(true)} className="text-xs text-error">אפס כספת (מחק את כל ההצפנה)</button>
                    ) : (
                      <div className="bg-error/10 border border-error/30 rounded-xl p-3 space-y-2">
                        <p className="text-xs text-error font-medium">אזהרה: איפוס הכספת ישאיר את קודי השוברים בDB מוצפנים ולא ניתן יהיה לקרוא אותם! יש לוודא תחילה שאין שוברי E2EE חשובים.</p>
                        <div className="flex gap-2">
                          <button onClick={() => { resetVault(); toast.success('כספת אופסה'); setVaultResetConfirm(false); setShowVaultSection(false) }} className="flex-1 py-2 bg-error text-white rounded-xl text-xs font-semibold">
                            {t('e2ee.reset')}
                          </button>
                          <button onClick={() => setVaultResetConfirm(false)} className="flex-1 py-2 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
