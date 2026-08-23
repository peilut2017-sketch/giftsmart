import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { useT } from '../../lib/i18n'
import { supabase } from '../../lib/supabase'
import Button from '../ui/Button'
import BottomSheet from '../ui/BottomSheet'
import toast from 'react-hot-toast'
import type { SellerProfileRow } from './shared'

function SellerProfileModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: SellerProfileRow | null
  onClose: () => void
  onSaved: (profile: SellerProfileRow) => void
}) {
  const { t } = useT()
  const { user } = useAuth()
  const [fullName, setFullName] = useState(existing?.full_name ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? user?.email ?? '')
  const [idNumber, setIdNumber] = useState(existing?.id_number ?? '')
  const [saving, setSaving] = useState(false)

  const isPending = existing?.verification_status === 'pending'
  const isRejected = existing?.verification_status === 'rejected'
  const readOnly = isPending

  async function handleSubmit() {
    if (!fullName.trim() || !phone.trim() || !idNumber.trim()) {
      toast.error(t('seller.profile.required')); return
    }
    setSaving(true)
    try {
      const { data, error } = await supabase.rpc('upsert_seller_profile', {
        p_full_name: fullName.trim(),
        p_phone: phone.trim(),
        p_email: email.trim() || null,
        p_id_number: idNumber.trim(),
      })
      if (error) throw error
      toast.success(t('seller.profile.saved'))
      onSaved((data as SellerProfileRow) ?? { user_id: user!.id, full_name: fullName, phone, email, id_number: idNumber, verification_status: 'pending', admin_note: null })
    } catch {
      toast.error(t('seller.profile.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t('seller.profile.title')}
      className="max-h-[90dvh]"
      footer={
        readOnly ? (
          <Button variant="secondary" onClick={onClose} fullWidth>{t('app.close')}</Button>
        ) : (
          <Button onClick={handleSubmit} disabled={saving} loading={saving} fullWidth>
            {t('seller.profile.submit')}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {isPending && (
          <div className="bg-warning/10 border border-warning/30 rounded-2xl p-4 text-sm text-warning">
            <p className="font-semibold mb-1">{t('admin.sellers.status.pending')}</p>
            <p>{t('seller.profile.pending')}</p>
          </div>
        )}

        {isRejected && (
          <div className="bg-error/10 border border-error/30 rounded-2xl p-4 text-sm text-error space-y-1">
            <p className="font-semibold">{t('seller.profile.rejected')}</p>
            {existing?.admin_note && (
              <p>{t('seller.profile.rejected.note')} {existing.admin_note}</p>
            )}
            <p className="text-xs mt-1">{t('mkt.seller.rejected.retry')}</p>
          </div>
        )}

        {!isPending && (
          <p className="text-sm text-text3">{t('seller.profile.subtitle')}</p>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.full_name')}</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={fullName} onChange={e => setFullName(e.target.value)} disabled={readOnly}
              placeholder={t('seller.profile.full_name')}
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.phone')}</label>
            <input
              type="tel" className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={phone} onChange={e => setPhone(e.target.value)} disabled={readOnly}
              placeholder="05X-XXXXXXX"
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.email')}</label>
            <input
              type="email" className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={email} onChange={e => setEmail(e.target.value)} disabled={readOnly}
              placeholder="user@example.com"
            />
          </div>
          <div>
            <label className="text-xs text-text3 mb-1 block">{t('seller.profile.id_number')}</label>
            <input
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-surface text-text disabled:bg-bg"
              value={idNumber} onChange={e => setIdNumber(e.target.value)} disabled={readOnly}
              placeholder="XXXXXXXXX"
              maxLength={9}
            />
          </div>
        </div>
      </div>
    </BottomSheet>
  )
}

export default SellerProfileModal
