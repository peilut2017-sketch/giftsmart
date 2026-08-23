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
      toast.success(t('privacy.persist.off.toast'))
    } else {
      // If the vault is open right now, persist it immediately (the raw key of a
      // v2 vault sits in sessionStorage while unlocked).
      const raw = sessionStorage.getItem('gs_e2ee_key_v2')
      if (raw && user?.id) saveDeviceVaultKey(user.id, raw)
      toast.success(t('privacy.persist.on.toast'))
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
        toast.success(t('privacy.biometric.enabled.toast'))
        logAction('system_biometric_link', 'מערכת', undefined, { type: 'enabled' })
      } else {
        toast.error(isVaultUnlocked ? t('privacy.biometric.register.error') : t('privacy.biometric.unlock.first'))
      }
    } catch {
      toast.error(t('privacy.biometric.register.error'))
    } finally {
      setBiometricLoading(false)
    }
  }

  function handleDisableBiometric() {
    disableBiometric()
    setBiometricEnabled(false)
    toast.success(t('privacy.biometric.disabled.toast'))
    logAction('system_biometric_link', 'מערכת', undefined, { type: 'disabled' })
  }

  async function handleRegenerateRecovery() {
    if (regeneratingKey) return
    setRegeneratingKey(true)
    try {
      await regenerateRecoveryKey()
      // The new phrase is shown once via the global RecoveryKeyModal
    } catch {
      toast.error(t('privacy.recovery.error'))
    } finally {
      setRegeneratingKey(false)
    }
  }

  async function handleMigrateVault() {
    if (!migrateVaultPass) return toast.error(t('privacy.migrate.enter.pass'))
    setMigrating(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, failed } = await migrateVault(migrateVaultPass, migrateLoginPass || undefined, e2eeVouchers)
      if (!ok) {
        toast.error(failed && failed > 0
          ? t('privacy.migrate.failed.count', { count: failed })
          : t('privacy.migrate.wrong.pass'))
        return
      }
      await refreshVouchers()
      toast.success(t('privacy.migrate.success'))
      setMigrateVaultPass(''); setMigrateLoginPass(''); setShowMigrateSection(false)
    } catch {
      toast.error(t('privacy.migrate.error'))
    } finally {
      setMigrating(false)
    }
  }

  async function handleChangeVaultPassphrase() {
    if (!vaultOldPass) return toast.error(t('privacy.enter.current.pass'))
    if (vaultNewPass.length < 8) return toast.error(t('account.pass.min'))
    if (vaultNewPass !== vaultNewPass2) return toast.error(t('auth.passwords.mismatch'))
    setVaultChanging(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await changePassphrase(vaultOldPass, vaultNewPass, e2eeVouchers, vaultNewHint)
      if (!ok) { toast.error(t('account.pass.wrong')); return }
      if (entries.length > 0) {
        await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, ...(cvv != null ? { cvv } : {}) })))
      } else {
        await refreshVouchers()
      }
      toast.success(t('privacy.pass.changed'))
      setVaultOldPass(''); setVaultNewPass(''); setVaultNewPass2(''); setVaultNewHint('')
      setShowVaultSection(false)
    } catch {
      toast.error(t('privacy.pass.change.error'))
    } finally {
      setVaultChanging(false)
    }
  }

  async function handleDisableVault() {
    if (!vaultDisablePass) return toast.error(t('privacy.enter.current.pass'))
    setVaultDisabling(true)
    try {
      const e2eeVouchers = [...vouchers, ...archivedVouchers].filter(v => v.is_e2ee)
      const { ok, entries } = await disableVault(vaultDisablePass, e2eeVouchers)
      if (!ok) { toast.error(t('vault.wrong.password')); return }
      if (entries.length > 0) {
        await Promise.all(entries.map(({ id, code, cvv }) => updateVoucher(id, { code, is_e2ee: false, ...(cvv != null ? { cvv } : {}) })))
      } else {
        await refreshVouchers()
      }
      toast.success(t('privacy.disable.success'))
      setVaultDisablePass(''); setVaultDisableConfirm(false); setShowVaultSection(false)
    } catch {
      toast.error(t('privacy.disable.error'))
    } finally {
      setVaultDisabling(false)
    }
  }

  async function handleEncryptAll() {
    if (!encryptAllPass) return toast.error(t('privacy.enter.vault.pass'))
    setEncryptingAll(true)
    try {
      const ok = await unlockVault(encryptAllPass)
      if (!ok) { toast.error(t('privacy.vault.pass.wrong')); return }
      const unencrypted = [...vouchers, ...archivedVouchers].filter(v => !v.is_e2ee)
      if (unencrypted.length === 0) { toast(t('privacy.all.encrypted')); setEncryptAllConfirm(false); setEncryptAllPass(''); return }
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
      if (failures > 0) toast.error(t('privacy.encrypt.failed.count', { count: failures }), { duration: 6000 })
      if (count > 0) toast.success(t('privacy.encrypt.success.count', { count }))
      setEncryptAllConfirm(false); setEncryptAllPass('')
    } finally {
      setEncryptingAll(false)
      setEncryptProgress(null)
    }
  }

  return (
    <div className="flex-1 bg-bg">
      <SettingsSubHeader title={t('privacy.title')} />
      <div className="p-4 space-y-4 pb-10">
        {isBiometricSupported() && (
          <>
            <SL>{t('privacy.biometrics')}</SL>
            <Card>
              <div className="flex items-center gap-3 p-4">
                <div className="w-10 h-10 rounded-xl bg-bg flex items-center justify-center">
                  <Icon name="fingerprint" size={20} color="var(--c-text2)" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">{t('privacy.biometric.lock')}</p>
                  <p className="text-xs text-text3">{biometricEnabled ? t('privacy.biometric.active') : t('privacy.biometric.off')}</p>
                </div>
                {biometricEnabled ? (
                  <button onClick={handleDisableBiometric} className="text-xs text-error font-medium px-3 py-2 bg-error/10 rounded-xl">{t('privacy.biometric.disable')}</button>
                ) : (
                  <button onClick={handleEnableBiometric} disabled={biometricLoading} className="text-xs text-primary font-medium px-3 py-2 bg-primary-light rounded-xl disabled:opacity-50">
                    {biometricLoading ? '...' : t('privacy.biometric.enable')}
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
              <p className="text-sm font-bold text-text">{t('privacy.e2ee.off.title')}</p>
              <p className="text-xs text-text2 leading-relaxed max-w-xs mx-auto">
                {t('privacy.e2ee.off.desc')}
              </p>
              <button
                onClick={() => setShowVaultSetup(true)}
                className="px-6 py-3 rounded-2xl bg-gradient-to-br from-primary-mid to-primary-dark text-white text-sm font-bold shadow-fab"
              >
                {t('privacy.vault.enable')}
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
                  <p className="text-sm font-bold text-text">{t('privacy.vault.health')}</p>
                  <p className="text-xs text-text3 mt-0.5">
                    {doorCount === null
                      ? t('privacy.encrypted.count', { count: encryptedCount })
                      : doorCount >= 2
                        ? t('privacy.doors.status', { doors: doorCount, count: encryptedCount })
                        : t('privacy.doors.one')}
                  </p>
                </div>
                {!isVaultUnlocked && (
                  <button onClick={() => setShowVaultUnlock(true)} className="text-xs text-primary font-bold px-3 py-2 bg-primary-light rounded-xl">
                    {t('app.open')}
                  </button>
                )}
              </div>
              {doors && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  <DoorChip ok={doors.password} label={t('privacy.door.password')} />
                  <DoorChip ok={doors.recovery} label={t('privacy.door.recovery')} />
                  <DoorChip ok={doors.prf > 0} label={t('privacy.door.fingerprint')} />
                </div>
              )}
              {isVaultUnlocked && (
                <button
                  onClick={handleRegenerateRecovery}
                  disabled={regeneratingKey}
                  className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary disabled:opacity-50"
                >
                  {regeneratingKey ? <Spinner size={13} /> : <Icon name="key" size={13} />}
                  {doors?.recovery ? t('privacy.recovery.regen') : t('privacy.recovery.create')}
                </button>
              )}
            </div>

            <div className="flex items-center gap-3 p-4 border-b border-border">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
                <Icon name="lock_open" size={20} color="var(--c-primary)" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text">{t('privacy.persist.title')}</p>
                <p className="text-xs text-text3 mt-0.5">{t('privacy.persist.desc')}</p>
              </div>
              <Switch checked={vaultPersist} onChange={handleToggleVaultPersist} ariaLabel={t('privacy.persist.title')} />
            </div>

            <button onClick={() => setShowVaultSection(s => !s)} aria-expanded={showVaultSection} className="flex items-center gap-3 w-full p-4 text-right hover:bg-bg">
              <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center flex-shrink-0">
                <Icon name="settings" size={20} color="var(--c-primary)" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-text">{t('privacy.advanced')}</p>
                <p className="text-xs text-text3">{isVaultUnlocked ? t('privacy.vault.unlocked.now') : t('privacy.vault.locked')} · {t('privacy.advanced.desc')}</p>
              </div>
              <Icon name={showVaultSection ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} color="var(--c-text3)" />
            </button>

            {showVaultSection && (
              <div className="px-4 pb-4 space-y-3">
                <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-bold text-warning flex items-center gap-2">
                    <Icon name="shield" size={14} className="flex-shrink-0" /> {t('privacy.important')}
                  </p>
                  {isUnifiedVault ? (
                    <ul className="text-xs text-warning space-y-1 list-disc pr-4">
                      <li>{t('privacy.info.unified.password.a')} <strong>{t('privacy.info.unified.password.b')}</strong> {t('privacy.info.unified.password.c')}</li>
                      <li>{t('privacy.info.unified.reset')}</li>
                      <li>{t('privacy.info.share')}</li>
                    </ul>
                  ) : (
                    <>
                      <p className="text-xs text-warning leading-relaxed">
                        <strong>{t('privacy.info.legacy.a')}</strong> {t('privacy.info.legacy.b')}
                      </p>
                      <p className="text-xs text-warning">{t('privacy.info.share')}</p>
                    </>
                  )}
                </div>

                {hint && (
                  <div className="bg-primary-light/60 rounded-xl px-3 py-2 text-xs text-text2">
                    {t('privacy.current.hint')} <span className="font-medium">{hint}</span>
                  </div>
                )}

                {!isUnifiedVault && (
                  <div className="bg-primary-light/50 border border-primary/20 rounded-xl p-3 space-y-2">
                    <p className="text-xs font-bold text-primary flex items-center gap-1"><Icon name="shield" size={14} /> {t('privacy.migrate.title')}</p>
                    <p className="text-xs text-text2 leading-relaxed">{t('privacy.migrate.desc')}</p>
                    {!showMigrateSection ? (
                      <button onClick={() => setShowMigrateSection(true)} className="text-xs font-semibold text-primary">{t('privacy.migrate.now')}</button>
                    ) : (
                      <div className="space-y-2 pt-1">
                        <input type="password" placeholder={t('privacy.vault.pass.current.placeholder')} value={migrateVaultPass} onChange={e => setMigrateVaultPass(e.target.value)} className="w-full px-3 py-2.5 border border-primary/20 rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" />
                        <div className="flex gap-2">
                          <button onClick={handleMigrateVault} disabled={migrating || !migrateVaultPass} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                            {migrating ? t('privacy.migrating') : t('privacy.migrate.button')}
                          </button>
                          <button onClick={() => { setShowMigrateSection(false); setMigrateVaultPass(''); setMigrateLoginPass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {!isUnifiedVault && (
                  <>
                    <input type="password" value={vaultOldPass} onChange={e => setVaultOldPass(e.target.value)} placeholder={t('account.pass.current.placeholder')} className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" name="vault-current-password" />
                    <input type="password" value={vaultNewPass} onChange={e => setVaultNewPass(e.target.value)} placeholder={t('account.pass.new.placeholder')} className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="new-password" name="vault-new-password" />
                    <input type="password" value={vaultNewPass2} onChange={e => setVaultNewPass2(e.target.value)} placeholder={t('account.pass.confirm.placeholder')} className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="new-password" name="vault-new-password-confirm" />
                    <input type="text" value={vaultNewHint} onChange={e => setVaultNewHint(e.target.value)} placeholder={t('privacy.new.hint.placeholder')} className="w-full px-4 py-2.5 border border-border rounded-xl text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" autoComplete="off" name="vault-new-hint" />
                    <button onClick={handleChangeVaultPassphrase} disabled={vaultChanging || !vaultOldPass || !vaultNewPass || !vaultNewPass2} className="w-full py-2.5 bg-primary text-white rounded-xl text-sm font-semibold disabled:opacity-50">
                      {vaultChanging ? t('privacy.reencrypting') : t('e2ee.change')}
                    </button>
                  </>
                )}

                <div className="border-t border-border pt-3 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-text">{t('privacy.e2ee.default')}</p>
                      <p className="text-xs text-text3 mt-0.5">{t('privacy.e2ee.default.desc')}</p>
                    </div>
                    <Switch
                      checked={e2eeDefaultNew}
                      onChange={() => { const next = !e2eeDefaultNew; setE2eeDefaultNew(next); localStorage.setItem('gs_e2ee_default', String(next)) }}
                      ariaLabel={t('privacy.e2ee.default')}
                    />
                  </div>

                  {!encryptAllConfirm ? (
                    <button onClick={() => setEncryptAllConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-bg text-sm font-medium text-text flex items-center gap-2">
                      <Icon name="lock" size={16} color="var(--c-primary)" /> {t('privacy.encrypt.all')}
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs font-bold text-warning flex items-center gap-1"><Icon name="shield" size={14} /> {t('privacy.note')}</p>
                      <p className="text-xs text-warning">
                        {t('privacy.encrypt.all.warning.a')}
                        <strong> {t('privacy.encrypt.all.warning.b')}</strong>
                      </p>
                      <input type="password" placeholder={t('privacy.verify.vault.pass')} value={encryptAllPass} onChange={e => setEncryptAllPass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary/30" dir="ltr" autoComplete="current-password" />
                      <div className="flex gap-2">
                        <button onClick={handleEncryptAll} disabled={encryptingAll || !encryptAllPass} className="flex-1 py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                          {encryptProgress ? t('privacy.encrypting.progress', { done: encryptProgress.done, total: encryptProgress.total }) : encryptingAll ? t('privacy.encrypting') : t('privacy.encrypt.all.button')}
                        </button>
                        <button onClick={() => { setEncryptAllConfirm(false); setEncryptAllPass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {!vaultDisableConfirm ? (
                    <button onClick={() => setVaultDisableConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-warning/10 text-sm font-medium text-warning flex items-center gap-2">
                      <Icon name="lock_open" size={16} /> {t('privacy.remove.encryption.button')}
                    </button>
                  ) : (
                    <div className="bg-warning/10 border border-warning/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-warning font-medium">{t('privacy.disable.confirm.desc')}</p>
                      <input type="password" placeholder={t('privacy.vault.pass.current.placeholder')} value={vaultDisablePass} onChange={e => setVaultDisablePass(e.target.value)} className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-warning/40" dir="ltr" autoComplete="current-password" />
                      <div className="flex gap-2">
                        <button onClick={handleDisableVault} disabled={vaultDisabling || !vaultDisablePass} className="flex-1 py-2.5 bg-warning text-white rounded-xl text-xs font-semibold disabled:opacity-50">
                          {vaultDisabling ? t('privacy.decrypting') : t('privacy.remove.encryption')}
                        </button>
                        <button onClick={() => { setVaultDisableConfirm(false); setVaultDisablePass('') }} className="flex-1 py-2.5 bg-bg text-text2 rounded-xl text-xs">{t('app.cancel')}</button>
                      </div>
                    </div>
                  )}

                  {!vaultResetConfirm ? (
                    <button onClick={() => setVaultResetConfirm(true)} className="w-full text-right px-3 py-3 rounded-xl bg-error/10 text-sm font-medium text-error flex items-center gap-2">
                      <Icon name="delete" size={16} /> {t('e2ee.reset')}
                    </button>
                  ) : (
                    /* Reset is the MOST destructive action on the page — it now
                       requires typing a confirmation word and states exactly what
                       will be lost, instead of a bare two-tap text link */
                    <div className="bg-error/10 border border-error/30 rounded-xl p-3 space-y-2">
                      <p className="text-xs text-error font-bold">
                        {encryptedCount > 0
                          ? t('privacy.reset.warning.count', { count: encryptedCount })
                          : t('privacy.reset.no.encrypted')}
                      </p>
                      <p className="text-xs text-error">{t('privacy.reset.confirm')} <strong>מחק</strong></p>
                      <input
                        type="text" value={resetTyped} onChange={e => setResetTyped(e.target.value)}
                        placeholder={t('privacy.reset.placeholder')}
                        className="w-full border border-error/40 rounded-xl px-3 py-2.5 text-base bg-surface text-text focus:outline-none focus:ring-2 focus:ring-error/40"
                        autoComplete="off"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { resetVault(); toast.success(t('privacy.reset.done')); setVaultResetConfirm(false); setResetTyped(''); setShowVaultSection(false); refreshDoors() }}
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
