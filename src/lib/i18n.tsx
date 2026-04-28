// Flat key-value translation dictionary
// Hebrew is the source truth; English is the translation

export type Locale = 'he' | 'en'

const translations: Record<string, string> = {
  // ── App / General ──────────────────────────────────────────────
  'app.name': 'GiftSmart',
  'app.loading': 'טוען...',
  'app.loading.en': 'Loading...',
  'app.error': 'שגיאה',
  'app.error.en': 'Error',
  'app.save': 'שמור',
  'app.save.en': 'Save',
  'app.cancel': 'ביטול',
  'app.cancel.en': 'Cancel',
  'app.close': 'סגור',
  'app.close.en': 'Close',
  'app.delete': 'מחק',
  'app.delete.en': 'Delete',
  'app.edit': 'ערוך',
  'app.edit.en': 'Edit',
  'app.add': 'הוסף',
  'app.add.en': 'Add',
  'app.done': 'סיום',
  'app.done.en': 'Done',
  'app.yes': 'כן',
  'app.yes.en': 'Yes',
  'app.no': 'לא',
  'app.no.en': 'No',
  'app.confirm': 'אישור',
  'app.confirm.en': 'Confirm',
  'app.search': 'חיפוש...',
  'app.search.en': 'Search...',
  'app.back': 'חזרה',
  'app.back.en': 'Back',
  'app.next': 'הבא',
  'app.next.en': 'Next',
  'app.prev': 'הקודם',
  'app.prev.en': 'Previous',
  'app.copied': 'הועתק',
  'app.copied.en': 'Copied',
  'app.share': 'שתף',
  'app.share.en': 'Share',
  'app.send': 'שלח',
  'app.send.en': 'Send',
  'app.update': 'עדכן',
  'app.update.en': 'Update',
  'app.remove': 'הסר',
  'app.remove.en': 'Remove',
  'app.open': 'פתח',
  'app.open.en': 'Open',
  'app.create': 'צור',
  'app.create.en': 'Create',

  // ── Bottom Nav ─────────────────────────────────────────────────
  'nav.home': 'בית',
  'nav.home.en': 'Home',
  'nav.market': 'שוק',
  'nav.market.en': 'Market',
  'nav.archive': 'ארכיון',
  'nav.archive.en': 'Archive',
  'nav.stats': 'סטטיסטיקות',
  'nav.stats.en': 'Statistics',
  'nav.settings': 'הגדרות',
  'nav.settings.en': 'Settings',
  'nav.admin': 'מנהל',
  'nav.admin.en': 'Admin',

  // ── Home Page ──────────────────────────────────────────────────
  'home.title': 'הארנק שלי',
  'home.title.en': 'My Wallet',
  'home.empty': 'אין שוברים עדיין',
  'home.empty.en': 'No vouchers yet',
  'home.empty.sub': 'לחץ על הכפתור הירוק להוספת שובר ראשון',
  'home.empty.sub.en': 'Tap the green button to add your first voucher',
  'home.tab.all': 'הכל',
  'home.tab.all.en': 'All',
  'home.tab.expiring': 'פג בקרוב',
  'home.tab.expiring.en': 'Expiring Soon',
  'home.tab.shared': 'משותף',
  'home.tab.shared.en': 'Shared',
  'home.filter': 'סינון',
  'home.filter.en': 'Filter',
  'home.sort': 'מיון',
  'home.sort.en': 'Sort',
  'home.grid': 'תצוגת רשת',
  'home.grid.en': 'Grid view',
  'home.list': 'תצוגת רשימה',
  'home.list.en': 'List view',
  'home.total': 'סה"כ',
  'home.total.en': 'Total',
  'home.vouchers': 'שוברים',
  'home.vouchers.en': 'vouchers',
  'home.select.all': 'בחר הכל',
  'home.select.all.en': 'Select all',
  'home.deselect.all': 'בטל הכל',
  'home.deselect.all.en': 'Deselect all',
  'home.archive.selected': 'ארכב נבחרים',
  'home.archive.selected.en': 'Archive selected',
  'home.delete.selected': 'מחק נבחרים',
  'home.delete.selected.en': 'Delete selected',

  // ── Voucher Card ───────────────────────────────────────────────
  'card.expires': 'פג',
  'card.expires.en': 'Expires',
  'card.balance': 'יתרה',
  'card.balance.en': 'Balance',
  'card.for.sale': 'למכירה',
  'card.for.sale.en': 'For Sale',
  'card.shared': 'משותף',
  'card.shared.en': 'Shared',
  'card.locked': 'נעול',
  'card.locked.en': 'Locked',
  'card.archived': 'בארכיון',
  'card.archived.en': 'Archived',

  // ── Voucher Form ───────────────────────────────────────────────
  'form.add.voucher': 'הוסף שובר',
  'form.add.voucher.en': 'Add Voucher',
  'form.edit.voucher': 'ערוך שובר',
  'form.edit.voucher.en': 'Edit Voucher',
  'form.store': 'חנות',
  'form.store.en': 'Store',
  'form.store.placeholder': 'שם החנות',
  'form.store.placeholder.en': 'Store name',
  'form.amount': 'סכום מקורי',
  'form.amount.en': 'Original Amount',
  'form.balance': 'יתרה נוכחית',
  'form.balance.en': 'Current Balance',
  'form.code': 'קוד שובר',
  'form.code.en': 'Voucher Code',
  'form.code.placeholder': 'קוד השובר',
  'form.code.placeholder.en': 'Voucher code',
  'form.cvv': 'CVV / PIN',
  'form.cvv.placeholder': 'CVV / PIN (אופציונלי)',
  'form.cvv.placeholder.en': 'CVV / PIN (optional)',
  'form.expiry': 'תאריך פקיעה',
  'form.expiry.en': 'Expiry Date',
  'form.notes': 'הערות',
  'form.notes.en': 'Notes',
  'form.notes.placeholder': 'הערות אופציונליות',
  'form.notes.placeholder.en': 'Optional notes',
  'form.link': 'קישור',
  'form.link.en': 'Link',
  'form.link.placeholder': 'קישור לאתר החנות (אופציונלי)',
  'form.link.placeholder.en': 'Link to store website (optional)',
  'form.categories': 'קטגוריות',
  'form.categories.en': 'Categories',
  'form.encrypt': 'הצפן קוד (E2EE)',
  'form.encrypt.en': 'Encrypt Code (E2EE)',
  'form.paste.sms': 'הדבק SMS',
  'form.paste.sms.en': 'Paste SMS',
  'form.scan.image': 'סרוק תמונה',
  'form.scan.image.en': 'Scan Image',
  'form.scan.barcode': 'סרוק ברקוד',
  'form.scan.barcode.en': 'Scan Barcode',

  // ── Checkout / Voucher Detail ──────────────────────────────────
  'checkout.balance': 'יתרה',
  'checkout.balance.en': 'Balance',
  'checkout.update.balance': 'עדכן יתרה',
  'checkout.update.balance.en': 'Update Balance',
  'checkout.new.balance': 'יתרה חדשה',
  'checkout.new.balance.en': 'New Balance',
  'checkout.barcode': 'ברקוד',
  'checkout.barcode.en': 'Barcode',
  'checkout.qr': 'QR',
  'checkout.share.link': 'שתף קישור',
  'checkout.share.link.en': 'Share Link',
  'checkout.sell': 'הצע למכירה',
  'checkout.sell.en': 'List for Sale',
  'checkout.history': 'היסטוריה',
  'checkout.history.en': 'History',
  'checkout.archive': 'ארכב שובר',
  'checkout.archive.en': 'Archive Voucher',
  'checkout.delete': 'מחק שובר',
  'checkout.delete.en': 'Delete Voucher',
  'checkout.locked.sale': 'שובר זה מוצע למכירה בשוק — נעול לשימוש',
  'checkout.locked.sale.en': 'This voucher is listed for sale — locked for personal use',
  'checkout.remove.sale': 'הסר מהמכירה',
  'checkout.remove.sale.en': 'Remove from Sale',
  'checkout.vault.locked': 'כספת נעולה — הקוד מוצפן',
  'checkout.vault.locked.en': 'Vault locked — code is encrypted',
  'checkout.open.vault': 'פתח כספת לצפייה בקוד',
  'checkout.open.vault.en': 'Open vault to view code',

  // ── Archive Page ───────────────────────────────────────────────
  'archive.title': 'ארכיון',
  'archive.title.en': 'Archive',
  'archive.empty': 'הארכיון ריק',
  'archive.empty.en': 'Archive is empty',
  'archive.restore': 'שחזר',
  'archive.restore.en': 'Restore',
  'archive.delete.all': 'מחק הכל',
  'archive.delete.all.en': 'Delete All',

  // ── Stats Page ─────────────────────────────────────────────────
  'stats.title': 'סטטיסטיקות',
  'stats.title.en': 'Statistics',
  'stats.total.value': 'שווי כולל',
  'stats.total.value.en': 'Total Value',
  'stats.active': 'פעילים',
  'stats.active.en': 'Active',
  'stats.used': 'נוצלו',
  'stats.used.en': 'Used',
  'stats.expiring': 'פגים בקרוב',
  'stats.expiring.en': 'Expiring Soon',
  'stats.by.store': 'לפי חנות',
  'stats.by.store.en': 'By Store',
  'stats.by.category': 'לפי קטגוריה',
  'stats.by.category.en': 'By Category',

  // ── Settings Page ─────────────────────────────────────────────
  'settings.title': 'הגדרות',
  'settings.title.en': 'Settings',
  'settings.profile': 'פרטי חשבון',
  'settings.profile.en': 'Account Details',
  'settings.name': 'שם תצוגה',
  'settings.name.en': 'Display Name',
  'settings.email': 'אימייל',
  'settings.email.en': 'Email',
  'settings.logout': 'התנתק',
  'settings.logout.en': 'Sign Out',
  'settings.appearance': 'מראה',
  'settings.appearance.en': 'Appearance',
  'settings.dark.mode': 'מצב לילה',
  'settings.dark.mode.en': 'Dark Mode',
  'settings.language': 'שפה',
  'settings.language.en': 'Language',
  'settings.language.he': 'עברית',
  'settings.language.he.en': 'Hebrew',
  'settings.language.en.label': 'English',
  'settings.language.en.label.en': 'English',
  'settings.notifications': 'התראות',
  'settings.notifications.en': 'Notifications',
  'settings.accessibility': 'נגישות',
  'settings.accessibility.en': 'Accessibility',
  'settings.security': 'אבטחה',
  'settings.security.en': 'Security',
  'settings.vault': 'כספת הצפנה (E2EE)',
  'settings.vault.en': 'Encryption Vault (E2EE)',
  'settings.payment.methods': 'שיטות תשלום בשוק',
  'settings.payment.methods.en': 'Marketplace Payment Methods',
  'settings.onboarding': 'מדריך שימוש',
  'settings.onboarding.en': 'Usage Guide',
  'settings.restart.guide': 'הפעל מדריך מחדש',
  'settings.restart.guide.en': 'Restart Guide',
  'settings.data': 'ניהול נתונים',
  'settings.data.en': 'Data Management',
  'settings.export': 'ייצא נתונים',
  'settings.export.en': 'Export Data',
  'settings.import': 'ייבא נתונים',
  'settings.import.en': 'Import Data',

  // ── E2EE ──────────────────────────────────────────────────────
  'e2ee.setup': 'הגדר כספת',
  'e2ee.setup.en': 'Set Up Vault',
  'e2ee.unlock': 'פתח כספת',
  'e2ee.unlock.en': 'Unlock Vault',
  'e2ee.lock': 'נעל כספת',
  'e2ee.lock.en': 'Lock Vault',
  'e2ee.reset': 'אפס כספת',
  'e2ee.reset.en': 'Reset Vault',
  'e2ee.passphrase': 'סיסמת כספת',
  'e2ee.passphrase.en': 'Vault Passphrase',
  'e2ee.hint': 'רמז לסיסמה',
  'e2ee.hint.en': 'Password Hint',
  'e2ee.change': 'שנה סיסמה',
  'e2ee.change.en': 'Change Passphrase',
  'e2ee.warning.loss': 'שכחת הסיסמה = אובדן גישה קבוע',
  'e2ee.warning.loss.en': 'Forgotten passphrase = permanent loss of access',

  // ── Marketplace ───────────────────────────────────────────────
  'market.title': 'שוק שוברים',
  'market.title.en': 'Voucher Market',
  'market.tab.browse': 'כל השוברים',
  'market.tab.browse.en': 'Browse',
  'market.tab.my.listings': 'הרשימות שלי',
  'market.tab.my.listings.en': 'My Listings',
  'market.tab.my.purchases': 'רכישות שלי',
  'market.tab.my.purchases.en': 'My Purchases',
  'market.buy': 'קנה עכשיו',
  'market.buy.en': 'Buy Now',
  'market.sell': 'הצע למכירה',
  'market.sell.en': 'List for Sale',
  'market.price': 'מחיר מבוקש',
  'market.price.en': 'Asking Price',
  'market.seller': 'מוכר',
  'market.seller.en': 'Seller',
  'market.buyer': 'קונה',
  'market.buyer.en': 'Buyer',
  'market.status.active': 'פעיל',
  'market.status.active.en': 'Active',
  'market.status.pending': 'ממתין לתשלום',
  'market.status.pending.en': 'Pending Payment',
  'market.status.sold': 'נמכר',
  'market.status.sold.en': 'Sold',
  'market.status.cancelled': 'בוטל',
  'market.status.cancelled.en': 'Cancelled',
  'market.confirm.sent': 'שלחתי תשלום',
  'market.confirm.sent.en': 'I Sent Payment',
  'market.confirm.received': 'אשר קבלת תשלום',
  'market.confirm.received.en': 'Confirm Payment Received',
  'market.rate': 'דרג',
  'market.rate.en': 'Rate',
  'market.report': 'דווח',
  'market.report.en': 'Report',
  'market.remove': 'הסר ממכירה',
  'market.remove.en': 'Remove Listing',
  'market.empty': 'אין מודעות זמינות',
  'market.empty.en': 'No listings available',
  'market.search.placeholder': 'חפש חנות...',
  'market.search.placeholder.en': 'Search stores...',

  // ── InStore Mode ──────────────────────────────────────────────
  'instore.title': 'אני בחנות',
  'instore.title.en': 'I\'m at the Store',
  'instore.search': 'חפש חנות...',
  'instore.search.en': 'Search store...',
  'instore.no.vouchers': 'אין שוברים לחנות זו',
  'instore.no.vouchers.en': 'No vouchers for this store',
  'instore.vault.locked': 'פתח כספת לצפייה',
  'instore.vault.locked.en': 'Open vault to view',

  // ── Filter / Sort ─────────────────────────────────────────────
  'filter.all': 'הכל',
  'filter.all.en': 'All',
  'filter.category': 'קטגוריה',
  'filter.category.en': 'Category',
  'sort.balance.high': 'יתרה — גבוה לנמוך',
  'sort.balance.high.en': 'Balance — High to Low',
  'sort.balance.low': 'יתרה — נמוך לגבוה',
  'sort.balance.low.en': 'Balance — Low to High',
  'sort.expiry.soon': 'תאריך פקיעה — קרוב ראשון',
  'sort.expiry.soon.en': 'Expiry Date — Soonest First',
  'sort.expiry.late': 'תאריך פקיעה — רחוק ראשון',
  'sort.expiry.late.en': 'Expiry Date — Latest First',
  'sort.name.az': 'שם — א-ת',
  'sort.name.az.en': 'Name — A to Z',
  'sort.name.za': 'שם — ת-א',
  'sort.name.za.en': 'Name — Z to A',
  'sort.added.new': 'נוסף — חדש ראשון',
  'sort.added.new.en': 'Added — Newest First',
  'sort.added.old': 'נוסף — ישן ראשון',
  'sort.added.old.en': 'Added — Oldest First',

  // ── Onboarding ────────────────────────────────────────────────
  'onboarding.welcome.title': 'ברוכים הבאים ל-GiftSmart',
  'onboarding.welcome.title.en': 'Welcome to GiftSmart',
  'onboarding.welcome.body': 'המדריך יסביר בקצרה את כל הפיצ׳רים — כולל הנסתרים שרוב המשתמשים לא מגלים. ניתן לדלג ולהפעיל מחדש מהגדרות.',
  'onboarding.welcome.body.en': 'This guide will briefly explain all features — including hidden ones most users never discover. You can skip and restart from Settings.',
  'onboarding.done.title': 'הכל ברור!',
  'onboarding.done.title.en': 'All Set!',
  'onboarding.done.body': 'עכשיו אתה מוכן להשתמש ב-GiftSmart במלואו. תוכל להפעיל מחדש את המדריך בכל עת דרך הגדרות.',
  'onboarding.done.body.en': 'You\'re now ready to use GiftSmart to its fullest. You can restart the guide anytime via Settings.',

  // ── Auth ──────────────────────────────────────────────────────
  'auth.sign.in': 'התחבר',
  'auth.sign.in.en': 'Sign In',
  'auth.sign.up': 'הרשמה',
  'auth.sign.up.en': 'Sign Up',
  'auth.email': 'אימייל',
  'auth.email.en': 'Email',
  'auth.password': 'סיסמה',
  'auth.password.en': 'Password',
  'auth.forgot.password': 'שכחתי סיסמה',
  'auth.forgot.password.en': 'Forgot Password',
  'auth.or': 'או',
  'auth.or.en': 'or',

  // ── Errors ────────────────────────────────────────────────────
  'error.required': 'שדה חובה',
  'error.required.en': 'Required field',
  'error.invalid': 'ערך לא תקין',
  'error.invalid.en': 'Invalid value',
  'error.network': 'שגיאת רשת',
  'error.network.en': 'Network error',
  'error.unknown': 'שגיאה לא ידועה',
  'error.unknown.en': 'Unknown error',

  // ── Toast / Success ───────────────────────────────────────────
  'toast.saved': 'נשמר בהצלחה',
  'toast.saved.en': 'Saved successfully',
  'toast.deleted': 'נמחק',
  'toast.deleted.en': 'Deleted',
  'toast.archived': 'הועבר לארכיון',
  'toast.archived.en': 'Archived',
  'toast.restored': 'שוחזר',
  'toast.restored.en': 'Restored',
  'toast.copied': 'הקוד הועתק',
  'toast.copied.en': 'Code copied',
}

// ── Context & Hook ─────────────────────────────────────────────────────

import { createContext, useContext, useEffect, useState } from 'react'

export type LocaleContextValue = {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, vars?: Record<string, string | number>) => string
  dir: 'rtl' | 'ltr'
}

export const LocaleContext = createContext<LocaleContextValue>({
  locale: 'he',
  setLocale: () => {},
  t: (k) => k,
  dir: 'rtl',
})

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    return (localStorage.getItem('gs_locale') as Locale) || 'he'
  })

  useEffect(() => {
    localStorage.setItem('gs_locale', locale)
    document.documentElement.setAttribute('lang', locale)
    document.body.setAttribute('dir', locale === 'he' ? 'rtl' : 'ltr')
  }, [locale])

  function setLocale(l: Locale) { setLocaleState(l) }

  function t(key: string, vars?: Record<string, string | number>): string {
    let result: string
    if (locale === 'he') {
      result = translations[key] ?? key
    } else {
      const enKey = key + '.en'
      result = translations[enKey] ?? translations[key] ?? key
    }
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
      })
    }
    return result
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t, dir: locale === 'he' ? 'rtl' : 'ltr' }}>
      {children}
    </LocaleContext.Provider>
  )
}

export function useT() {
  const ctx = useContext(LocaleContext)
  return { t: ctx.t, locale: ctx.locale, dir: ctx.dir }
}

export function useLocale() {
  return useContext(LocaleContext)
}
