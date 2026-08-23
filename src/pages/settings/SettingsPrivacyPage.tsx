import { useState } from 'react'
import { useVouchers } from '../../contexts/VoucherContext'
import { useE2EE } from '../../contexts/E2EEContext'
import { isVaultPersistEnabled, setVaultPersistEnabled, saveDeviceVaultKey, clearDeviceVaultKey } from '../../lib/vaultKeyStore'
import { isBiometricEnabled, isBiometricSupported, registerBiometric, disableBiometric } from '../../lib/passkey'
import { useAuth } from '../../contexts/AuthContext'
import toast from 'react-hot-toast'
import { useT } from '../../lib/i18n'
import Icon from '../../components/ui/Icon'
import VaultSetupSheet from '../../components/VaultSetupSheet'
import VaultUnlockSheet from '../../components/VaultUnlockSheet'
import { SettingsSubHeader, Card, SL, Spinner, Switch } from '../../components/settings/SettingsUI'
import { usePageView } from '../../hooks/usePageView'

export default function SettingsPrivacyPage() {
  usePageView('settings_privacy')
  const { t } = useT()
  const { user, profile } = useAuth()
  const { vouchers, archivedVouchers, updateVoucher, refreshVouchers, logAction } = useVouchers()
  const {
    hasVault, hint, isVaultUnlocked, isUnifiedVault, unlockVault,
    encrypt, resetVault, changePassphrase, disableVault, migrateVault, regenerateRecoveryKey,
    enableBiometricVaultUnlock, doors, refreshDoors,
  } = useE2EE()

  const [biometricEnabled, setBiometricEnabled] = useState(isBiometricEnabled)
  const [biometricLoading, setBiometricLoading] = useState(false)

  const [showVaultSetup, setShowVaultSetup] = useState(false)
  const [showVaultUnlock, setShowVaultUnlock] = useState(false)
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
  const [resetTyped, setResetTyped] = useState('')
  const [vaultDisablePass, setVaultDisablePass] = useState('')
  const [vaultDisabling, setVaultDisabling] = useState(false)
  const [vaultDisableConfirm, setVaultDisableConfirm] = useState(false)
  const [regeneratingKey, setRegeneratingKey] = useState(false)

  const [e2eeDefaultNew, setE2eeDefaultNew] = useState(() => localStorage.getItem('gs_e2ee_default') !== 'false')
  const [vaultPersist, setVaultPersist] = useState(isVaultPersistEnabled)

  const encryptedCount = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee).length
  const doorCount = doors ? (doors.password ? 1 : 0) + (doors.recovery ? 1 : 0) + (doors.prf > 0 ? 1 : 0) : null

  function handleToggleVaultPersist() {
    const next = !vaultPersist
    setVaultPersist(next)
    setVaultPersistEnabled(next)
    if (!next) {
      clearDeviceVaultKey()
      toast.success('הכספת תינעל בסגירת האפליקציה')
    } else {
      // If the vault is open right now, persist it immediately (the raw key of a
      // v2 vault sits in sessionStorage while unlocked).
      const raw = sessionStorage.getItem('gs_e2ee_key_v2')
      if (raw && user?.id) saveDeviceVaultKey(user.id, raw)
      toast.success('הכספת תישאר פתוחה במכשיר זה')
    }
  }
  const [encryptAllConfirm, setEncryptAllConfirm] = useState(false)
  const [encryptAllPass, setEncryptAllPass] = useState('')
  const [encryptingAll, setEncryptingAll] = useState(false)
  const [encryptProgress, setEncryptProgress] = useState<{ done: number; total: number } | null>(null)

  async function handleEnableBiometric() {
    setBiometricLoading(true)
    try {
      const ok = isVaultUnlocked
        ? await enableBiometricVaultUnlock(user?.id || '', profile?.name || user?.email || '', user?.email)
        : await registerBiometric(user?.id || '', profile?.name || user?.email || '', user?.email)
      if (ok) {
        setBiometricEnabled(true)
        toast.success('נעילה ביומטרית הופעלה!')
        logAction('system_biometric_link', 'מערכת', undefined, { type: 'enabled' })
      } else {
        toast.error(isVaultUnlocked ? 'לא ניתן לרשום אימות ביומטרי' : 'פתח קודם את הכספת כדי שהביומטריה תוכל לפתוח אותה')
      }
    } catch {
      toast.error('לא ניתן לרשום אימות ביומטרי')
    } finally {
      setBiometricLoading(false)
    }
  }

  function handleDisableBiometric() {
    disableBiometric()
    setBiometricEnabled(false)
    toast.success('נעילה ביומטרית בוטלה')
    logAction('system_biometric_link', 'מערכת', undefined, { type: 'disabled' })
  }

  async function handleRegenerateRecovery() {
    if (regeneratingKey) return
    setRegeneratingKey(true)
    try {
      await regenerateRecoveryKey()
      // The new phrase is shown once via the global RecoveryKeyModal
    } catch {
      toast.error('לא ניתן ליצור קוד שחזור כרגע — בדוק את החיבור')
    } finally {
      setRegeneratingKey(false)
    }
  }

  async function handleMigrateVault() {
    if (!migrateVaultPass) return toast.error('הזן את סיסמת הכספת הנוכחית')
    setMigrating(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, failed } = await migrateVault(migrateVaultPass, migrateLoginPass || undefined, e2eeVouchers)
      if (!ok) {
        toast.error(failed && failed > 0
          ? `${failed} שוברים לא ניתנים לפענוח — השדרוג בוטל כדי לא לאבד אותם`
          : 'סיסמת הכספת שגויה — נסה שוב')
        return
      }
      await refreshVouchers()
      toast.success('הכספת שודרגה! שמור את קוד השחזור החדש')
      setMigrateVaultPass(''); setMigrateLoginPass(''); setShowMigrateSection(false)
    } catch {
      toast.error('שגיאה בשדרוג הכספת — נסה שוב')
    } finally {
      setMigrating(false)
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
      if (entries.length > 0) {
        await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })))
      } else {
        await refreshVouchers()
      }
      toast.success('סיסמת הכספת שונתה')
      setVaultOldPass(''); setVaultNewPass(''); setVaultNewPass2(''); setVaultNewHint('')
      setShowVaultSection(false)
    } catch {
      toast.error('שגיאה בשינוי הסיסמה — נסה שוב')
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
      if (entries.length > 0) {
        await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, is_e2ee: false, ...(cvv != null ? { cvv } : {}) })))
      } else {
        await refreshVouchers()
      }
      toast.success('ההצפנה הוסרה מכל השוברים')
      setVaultDisablePass(''); setVaultDisableConfirm(false); setShowVaultSection(false)
    } catch {
      toast.error('שגיאה בהסרת ההצפנה — נסה שוב')
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
      let failures = 0
      setEncryptProgress({ done: 0, total: unencrypted.length })
      for (const v of unencrypted) {
        try {
          const encCode = await encrypt(v.code)
          const encCvv = v.cvv ? await encrypt(v.cvv) : undefined
          await updateVoucher(v.id, { code: encCode, is_e2ee: true, ...(encCvv != null ? { cvv: encCvv } : {}) })
          count++
        } catch {
          failures++
        }
        setEncryptProgress({ done: count + failures, total: unencrypted.length })
      }
      // Failures are reported, not swallowed — the old success toast counted only
      // the winners and never mentioned what was left behind
      if (failures > 0) toast.error(`${failures} שוברים לא הוצפנו — נסה שוב`, { duration: 6000 })
      if (count > 0) toast.success(`${count} שוברים הוצפנו בהצלחה`)
      setEncryptAllConfirm(false); setEncryptAllPass('')
    } finally {
      setEncryptingAll(false)
      setEncryptProgress(null)
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
                  <button onClick={handleDisableBiometric} className="text-xs text-error font-medium px-3 py-2 bg-error/10 rounded-xl">בטל</button>
                ) : (
                  <button onClick={handleEnableBiometric} disabled={biometricLoading} className="text-xs text-primary font-medium px-3 py-2 bg-primary-light rounded-xl disabled:opacity-50">
                    {biometricLoading ? '...' : 'הפעל'}
                  </button>
                )}
              </div>
            </Card>
          </>
        )}

        <SL>{t('settings.vault')}</SL>

        {!hasVault ? (
          /* The page used to render completely EMPTY here (no biometrics + no vault
             = nothing at all), with no way to create a vault from the page named
             "Privacy". Now it's the entry point. */
          <Card>
            <div className="p-5 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary-light">
                <Icon name="lock" size={26} color="var(--c-primary)" />
              </div>
              <p className="text-sm font-bold text-text">הצפנה מקצה לקצה כבויה</p>
              <p className="text-xs text-text2 leading-relaxed max-w-xs mx-auto">
                הפעל את הכספת כדי שקודי השוברים יהיו קריאים רק לך — גם אנחנו לא נוכל לראות אותם.
              </p>
              <button
                onClick={() => setShowVaultSetup(true)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-br from-primary-mid to-primary-dark text-white text-sm font-bold shadow-fab"
              >
                הפעל הצפנה
              </button>
            </div>
          </Card>
        ) : (
          <Card>
            {/* ── Vault health — how many "doors" can open the vault ── */}
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${doorCount !== null && doorCount >= 2 ? 'bg-primary-light' : 'bg-warning/15'}`}>
                  <Icon name="shield" size={20} color={doorCount !== null && doorCount >= 2 ? 'var(--c-primary)' : 'var(--c-warning)'} filled />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-text">בריאות הכספת</p>
                  <p className="text-xs text-text3 mt-0.5">
                    {doorCount === null
                      ? `${encryptedCount} שוברים מוצפנים`
                      : doorCount >= 2
                        ? `${doorCount} דרכי פתיחה פעילות · ${encryptedCount} שוברים מוצפנים`
                        : 'דרך פתיחה אחת בלבד — מומלץ להוסיף עוד אחת'}
                  </p>
                </div>
                {!isVaultUnlocked && (
                  <button onClick={() => setShowVaultUnlock(true)} className="text-xs text-primary font-bold px-3 py-2 bg-primary-light rounded-xl">
                    פתח
                  </button>
                )}
              </div>
              {doors && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <DoorChip ok={doors.password} label="סיסמת כניסה" />
                  <DoorChip ok={doors.recovery} label="קוד שחזור" />
                  <DoorChip ok={doors.prf > 0} label="טביעת אצבע" />
                </div>
              )}
              {isVaultUnlocked && (
                <button
                  onClick={handleRegenerateRecovery}
                  disabled={regeneratingKey}
                  className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {regeneratingKey ? <Spinner size={13} /> : <Icon name="key" size={13} />}
                  {doors?.recovery ? 'צור קוד שחזור חדש (הקודם יפסיק לעבוד)' : 'צור קוד שחזור'}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 p-4 border-b border-border">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
                <Icon name="lock_open" size={20} color="var(--c-primary)" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text">השאר כספת פתוחה במכשיר זה</p>
                <p className="text-xs text-text3 mt-0.5">המפתח נשמר מאובטח במכשיר — אין צורך להזין סיסמה בכל כניסה</p>
              </div>
              <Switch checked={vaultPersist} onChange={handleToggleVaultPersist} ariaLabel="השאר כספת פתוחה במכשיר זה" />
            </div>

            <button onClick={() => setShowVaultSection(s => !s)} aria-expanded={showVaultSection} className="flex items-center gap-3 w-full p-4 text-right hover:bg-bg">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
                <Icon name="settings" size={20} color="var(--c-primary)" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text">הגדרות מתקדמות</p>
                <p className="text-xs text-text3">{isVaultUnlocked ? 'פתוחה כעת' : 'נעולה'} · הצפנה גורפת, הסרה, איפוס</p>
              </div>
              <Icon name={showVaultSection ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
            </button>

            {showVaultSection && (
              <div className="px-4 pb-4 space-y-3">
                <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-warning flex items-center gap-2">
                    <Icon name="shield" size={14} className="flex-shrink-0" /> חשוב לדעת
                  </p>
                  {isUnifiedVault ? (
                    <ul className="text-xs text-warning space-y-1 list-disc pr-4">
                      <li>הכספת נפתחת עם <strong>סיסמת הכניסה שלך</strong> — היא לא נשמרת אצלנו.</li>
                      <li>איפוס סיסמה בדוא"ל ידרוש פתיחה חד-פעמית עם טביעת אצבע או קוד שחזור.</li>
                      <li>שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</li>
                    </ul>
                  ) : (
                    <>
                      <p className="text-xs text-warning leading-relaxed">
                        <strong>הסיסמה אינה ניתנת לשחזור</strong> — שמור אותה במקום בטוח. איבוד הסיסמה יגרום לאיבוד הנתונים המוצפנים לצמיתות.
                      </p>
                      <p className="text-xs text-warning">שיתוף שובר מוצפן חושף את הקוד בשרת לצורך השיתוף בלבד.</p>
                    </>
                  )}
                </div>

                {hint && (
                  <div className="bg-primary-light/60 rounded-xl px-3 py-2 text-xs text-text2">
                    רמז נוכחי: <span className="font-medium">{hint}</span>
                  </div>
                )}

                {!isUnifiedVault && (
                  <div className="bg-primary-light/50 border border-primary/20 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-primary flex items-center gap-1"><Icon name="shield" size={14} /> שדרג לסיסמה אחת</p>
                    <p className="text-xs text-text2 leading-relaxed">הכספת שלך עדיין דורשת סיסמה נפרדת מסיסמת הכניסה. שדרג — והכספת תיפתח אוטומטית בכל כניסה, עם קוד שחזור חדש.</p>
                    {!showMigrateSection ? (
                      <button onClick={() => setShowMigrateSection(true)} className="text-xs font-semibold text-primary">שדרג עכשיו ←</button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <input type="password" placeholder="סיסמת כספת נוכחית" value={migrateVaultPass} onChange={e => setMigrateVaultPass(e.target.value)} className="w-full px-3 py-2.5 border border-primary/20 rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" />
                        <div className="flex gap-2">
                          <button onClick={handleMigrateVault} disabled={migrating || !migrateVaultPass} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                            {migrating ? 'משדרג…' : 'שדרג כספת'}
                          </button>
                          <button onClick={() => { setShowMigrateSection(false); setMigrateVaultPass(''); setMigrateLoginPass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isUnifiedVault && (
                  <>
                    <input type="password" value={vaultOldPass} onChange={e => setVaultOldPass(e.target.value)} placeholder="סיסמה נוכחית" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" name="vault-current-password" />
                    <input type="password" value={vaultNewPass} onChange={e => setVaultNewPass(e.target.value)} placeholder="סיסמה חדשה (לפחות 8 תווים)" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="new-password" name="vault-new-password" />
                    <input type="password" value={vaultNewPass2} onChange={e => setVaultNewPass2(e.target.value)} placeholder="אימות סיסמה חדשה" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="new-password" name="vault-new-password-confirm" />
                    <input type="text" value={vaultNewHint} onChange={e => setVaultNewHint(e.target.value)} placeholder="רמז לסיסמה החדשה (אופציונלי)" className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete="off" name="vault-new-hint" />
                    <button onClick={handleChangeVaultPassphrase} disabled={vaultChanging || !vaultOldPass || !vaultNewPass || !vaultNewPass2} className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                      {vaultChanging ? 'מצפין מחדש...' : t('e2ee.change')}
                    </button>
                  </>
                )}

                <div className="border-t border-border pt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">הצפן שוברים חדשים כברירת מחדל</p>
                      <p className="text-xs text-text3 mt-0.5">כל שובר חדש שיתווסף יוצפן אוטומטית</p>
                    </div>
                    <Switch
                      checked={e2eeDefaultNew}
                      onChange={() => { const next = !e2eeDefaultNew; setE2eeDefaultNew(next); localStorage.setItem('gs_e2ee_default', String(next)) }}
                      ariaLabel="הצפן שוברים חדשים כברירת מחדל"
                    />
                  </div>

                  {!encryptAllConfirm ? (
                    <button onClick={() => setEncryptAllConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-bg text-sm font-medium text-text flex items-center gap-2">
                      <Icon name="lock" size={16} color="var(--c-primary)" /> הצפן את כל השוברים שעדיין לא מוצפנים
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-warning flex items-center gap-1"><Icon name="shield" size={14} /> שים לב</p>
                      <p className="text-xs text-warning">
                        קודי השוברים יוצפנו עם סיסמת הכספת הנוכחית.
                        <strong> ודא ששמרת את קוד השחזור לפני שממשיכים.</strong>
                      </p>
                      <input type="password" placeholder="אמת סיסמת כספת" value={encryptAllPass} onChange={e => setEncryptAllPass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" />
                      <div className="flex gap-2">
                        <button onClick={handleEncryptAll} disabled={encryptingAll || !encryptAllPass} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                          {encryptProgress ? `מצפין ${encryptProgress.done}/${encryptProgress.total}…` : encryptingAll ? 'מצפין…' : 'הצפן הכל'}
                        </button>
                        <button onClick={() => { setEncryptAllConfirm(false); setEncryptAllPass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {!vaultDisableConfirm ? (
                    <button onClick={() => setVaultDisableConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-warning/10 text-sm font-medium text-warning flex items-center gap-2">
                      <Icon name="lock_open" size={16} /> הסר הצפנה (שמור קודים גלויים)
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-warning font-medium">הקודים יפוענחו ויישמרו ללא הצפנה. הנתונים עצמם לא יימחקו.</p>
                      <input type="password" placeholder="סיסמת כספת נוכחית" value={vaultDisablePass} onChange={e => setVaultDisablePass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-warning/40" dir="ltr" autoComplete="current-password" />
                      <div className="flex gap-2">
                        <button onClick={handleDisableVault} disabled={vaultDisabling || !vaultDisablePass} className="flex-1 py-2.5 bg-warning text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                          {vaultDisabling ? 'מפענח...' : 'הסר הצפנה'}
                        </button>
                        <button onClick={() => { setVaultDisableConfirm(false); setVaultDisablePass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {!vaultResetConfirm ? (
                    <button onClick={() => setVaultResetConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-error/10 text-sm font-medium text-error flex items-center gap-2">
                      <Icon name="delete" size={16} /> אפס כספת
                    </button>
                  ) : (
                    /* Reset is the MOST destructive action on the page — it now
                       requires typing a confirmation word and states exactly what
                       will be lost, instead of a bare two-tap text link */
                    <div className="bg-error/10 border border-error/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-error font-bold">
                        {encryptedCount > 0
                          ? `אזהרה: ${encryptedCount} שוברים מוצפנים יהפכו לבלתי-קריאים לצמיתות!`
                          : 'איפוס הכספת ימחק את הגדרות ההצפנה במכשיר זה.'}
                      </p>
                      <p className="text-xs text-error">שאר הנתונים (שמות, יתרות, תוקף) אינם נפגעים. כדי לאשר, הקלד: <strong>מחק</strong></p>
                      <input
                        type="text" value={resetTyped} onChange={e => setResetTyped(e.target.value)}
                        placeholder="הקלד: מחק"
                        className="w-full border border-error/40 rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-error/40"
                        autoComplete="off"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { resetVault(); toast.success('הכספת אופסה'); setVaultResetConfirm(false); setResetTyped(''); setShowVaultSection(false); refreshDoors() }}
                          disabled={resetTyped.trim() !== 'מחק'}
                          className="flex-1 py-2.5 bg-error text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        >
                          {t('e2ee.reset')}
                        </button>
                        <button onClick={() => { setVaultResetConfirm(false); setResetTyped('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      <VaultSetupSheet open={showVaultSetup} onClose={() => setShowVaultSetup(false)} onDone={() => refreshDoors()} />
      <VaultUnlockSheet open={showVaultUnlock} onClose={() => setShowVaultUnlock(false)} />
    </div>
  )
}

function DoorChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full ${ok ? 'bg-primary-light text-primary-dark' : 'bg-bg text-text3'}`}>
      <Icon name={ok ? 'check_circle' : 'cancel'} size={12} color={ok ? 'var(--c-primary)' : 'var(--c-text3)'} filled={ok} />
      {label}
    </span>
  )
}
