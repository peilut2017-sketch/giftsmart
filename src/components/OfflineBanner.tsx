import { useVouchers } from '../contexts/VoucherContext'
import { useState } from 'react'

export default function OfflineBanner() {
  const { isOnline, pendingOpsCount } = useVouchers()
  const [expanded, setExpanded] = useState(false)

  if (isOnline && pendingOpsCount === 0) return null

  // Just came back online and syncing
  if (isOnline && pendingOpsCount > 0) {
    return (
      <div className="bg-blue-500 text-white text-sm px-4 py-2 flex items-center justify-center gap-2" dir="rtl">
        <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
        <span>מסנכרן {pendingOpsCount} פעולות שהמתינו...</span>
      </div>
    )
  }

  // Offline
  return (
    <div className="bg-amber-500 text-white text-sm" dir="rtl">
      <div
        className="px-4 py-2 flex items-center justify-between gap-2 cursor-pointer"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-center gap-2">
          <span className="text-base">📵</span>
          <span className="font-medium">
            מצב לא מקוון
            {pendingOpsCount > 0 && (
              <span className="mr-1 bg-white text-amber-600 text-xs font-bold rounded-full px-1.5 py-0.5">
                {pendingOpsCount} ממתינות
              </span>
            )}
          </span>
        </div>
        <span className="text-xs opacity-75">{expanded ? '▲' : '▼'} פרטים</span>
      </div>

      {expanded && (
        <div className="px-4 pb-3 space-y-1 text-xs opacity-90 border-t border-amber-400">
          <p className="pt-2 font-medium">מה עובד עכשיו:</p>
          <p>✓ צפייה בשוברים (מהזיכרון המקומי)</p>
          <p>✓ הוספת שוברים (יסונכרנו בחיבור הבא)</p>
          <p>✓ עדכון יתרה, ארכיב, מחיקה (יסונכרנו בחיבור הבא)</p>
          <p className="mt-1 font-medium">מה לא עובד:</p>
          <p>✗ שיתוף שוברים</p>
          <p>✗ שליחת מתנות</p>
          <p>✗ התחברות חשבון חדש</p>
          {pendingOpsCount > 0 && (
            <p className="mt-1 bg-amber-600 rounded px-2 py-1">
              {pendingOpsCount} פעולות ממתינות לסנכרון עם השרת
            </p>
          )}
        </div>
      )}
    </div>
  )
}
