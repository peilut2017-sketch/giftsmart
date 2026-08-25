import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import VoucherForm from './VoucherForm'
import { useVouchers } from '../contexts/VoucherContext'
import { useSubscription } from '../contexts/SubscriptionContext'
import { useT } from '../lib/i18n'

/**
 * Opens the add-voucher wizard as an overlay on WHATEVER page is currently
 * showing — the BottomNav FAB used to navigate to /?add=1, which yanked the
 * user to the home page just to show a modal. The FAB now dispatches
 * 'gs-open-add-voucher' and this render-null-until-opened component (mounted
 * once inside the provider tree in App.tsx) presents the form in place.
 * The /?add=1 deep link (TWA shortcut) still works via HomePage.
 */
export default function GlobalAddVoucher() {
  const { vouchers, addVoucher } = useVouchers()
  const { limits, openUpgradeSheet } = useSubscription()
  const { t } = useT()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onOpen() {
      if (vouchers.length >= limits.maxVouchers) {
        openUpgradeSheet(t('upgrade.limit.reached', { max: limits.maxVouchers }))
        return
      }
      setOpen(true)
    }
    window.addEventListener('gs-open-add-voucher', onOpen)
    return () => window.removeEventListener('gs-open-add-voucher', onOpen)
  }, [vouchers.length, limits.maxVouchers, openUpgradeSheet, t])

  async function handleSave(vData: Parameters<typeof addVoucher>[0]) {
    try {
      const newVoucher = await addVoucher(vData)
      toast.success(t('voucher.added'))
      return newVoucher
    } catch (err) {
      toast.error((err instanceof Error && err.message) || t('voucher.save.error'))
      // Re-throw so VoucherForm stays on the form instead of showing success
      throw err
    }
  }

  return (
    <AnimatePresence>
      {open && <VoucherForm onClose={() => setOpen(false)} onSave={handleSave} />}
    </AnimatePresence>
  )
}
