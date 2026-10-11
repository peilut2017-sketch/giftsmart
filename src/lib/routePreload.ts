/**
 * Starts loading a lazy route's chunk ahead of the navigation. A shared-element
 * transition captures the new page the moment the router renders it — if the route were
 * still loading, that frame would be the Suspense spinner and the card would morph into
 * a spinner. Same `import()` specifiers as the `lazy()` calls in App.tsx, so the bundler
 * serves one shared chunk.
 */
const LOADERS: Array<[RegExp, () => Promise<unknown>]> = [
  [/^\/checkout\//, () => import('../pages/CheckoutPage')],
  [/^\/market\/listing\//, () => import('../pages/ListingDetailPage')],
  [/^\/settings\/account/, () => import('../pages/settings/SettingsAccountPage')],
  [/^\/settings\/wallet/, () => import('../pages/settings/SettingsWalletPage')],
  [/^\/settings\/notifications/, () => import('../pages/settings/SettingsNotificationsPage')],
  [/^\/settings\/privacy/, () => import('../pages/settings/SettingsPrivacyPage')],
  [/^\/settings\/appearance/, () => import('../pages/settings/SettingsAppearancePage')],
  [/^\/settings\/backup/, () => import('../pages/settings/SettingsBackupPage')],
  [/^\/settings\/accessibility/, () => import('../pages/settings/SettingsAccessibilityPage')],
  [/^\/settings\/about/, () => import('../pages/settings/SettingsAboutPage')],
]

/** Never rejects: a failed preload just means the navigation loads the chunk itself. */
export async function preloadRoute(path: string): Promise<void> {
  const pathname = path.split('?')[0]
  const hit = LOADERS.find(([re]) => re.test(pathname))
  if (!hit) return
  try { await hit[1]() } catch { /* the lazy() boundary will retry and show its own error */ }
}
