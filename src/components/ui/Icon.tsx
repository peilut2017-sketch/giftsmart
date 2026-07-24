import { useMemo } from 'react'

// Self-hosted Material Symbols, bundled as individual SVGs (no font/ligature dependency —
// see the commit that replaced the Google-Fonts-CDN + ligature-substitution approach,
// which kept breaking in production for reasons invisible from a curl/build-only sandbox:
// CSP edge cases, ad-blockers, and this app's own service worker cache-first-ing the font
// file forever). Vite bundles exactly the icons this manifest lists — extend it (and the
// matching entry in svg-400/rounded) if a new icon name is introduced.
const rawIcons = import.meta.glob<string>(
  [
  '../../../node_modules/@material-symbols/svg-400/rounded/account_balance_wallet.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/account_balance_wallet-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/add.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/add-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/all_inclusive.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/all_inclusive-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/archive.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/archive-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/arrow_forward.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/arrow_forward-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/bar_chart.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/bar_chart-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/barcode_scanner.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/barcode_scanner-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/bolt.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/bolt-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/calendar_month.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/calendar_month-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/calendar_today.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/calendar_today-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/call.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/call-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/cancel.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/cancel-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/chat.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/chat-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_box.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_box-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_box_outline_blank.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_box_outline_blank-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_circle.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/check_circle-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/checklist.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/checklist-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/chevron_left.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/chevron_left-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/close.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/close-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/content_copy.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/content_copy-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/credit_card.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/credit_card-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/dark_mode.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/dark_mode-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/delete.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/delete-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/done_all.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/done_all-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/download.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/download-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/edit.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/edit-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/error.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/error-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/event.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/event-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/favorite.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/favorite-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/fingerprint.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/fingerprint-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/flag.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/flag-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/grid_view.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/grid_view-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/group.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/group-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/history.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/history-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/info.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/info-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/inventory_2.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/inventory_2-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/ios_share.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/ios_share-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/key.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/key-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/keyboard_arrow_down.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/keyboard_arrow_down-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/keyboard_arrow_up.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/keyboard_arrow_up-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/language.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/language-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/light_mode.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/light_mode-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lightbulb.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lightbulb-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/link.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/link-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/link_off.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/link_off-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lock.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lock-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lock_open.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/lock_open-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/login.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/login-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/mail.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/mail-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/more_horiz.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/more_horiz-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/north_east.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/north_east-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/notifications.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/notifications-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/notifications_active.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/notifications_active-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/open_in_new.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/open_in_new-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/percent.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/percent-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/person.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/person-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/person_add.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/person_add-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/progress_activity.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/progress_activity-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/qr_code_2.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/qr_code_2-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/redeem.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/redeem-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/restore_from_trash.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/restore_from_trash-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/schedule.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/schedule-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/search.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/search-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/sell.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/sell-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/send.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/send-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/settings.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/settings-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/share.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/share-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shield.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shield-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shopping_bag.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shopping_bag-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shopping_cart.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/shopping_cart-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/star.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/star-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/stars.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/stars-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/storefront.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/storefront-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/swap_vert.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/swap_vert-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/tune.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/tune-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/verified.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/verified-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/verified_user.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/verified_user-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/view_list.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/view_list-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/visibility.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/visibility-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/visibility_off.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/visibility_off-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/warning.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/warning-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/wifi_off.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/wifi_off-fill.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/workspace_premium.svg',
  '../../../node_modules/@material-symbols/svg-400/rounded/workspace_premium-fill.svg',
  ],
  { eager: true, query: '?raw', import: 'default' },
)

interface ParsedIcon {
  viewBox: string
  inner: string
}

const iconCache = new Map<string, ParsedIcon>()

function parseIcon(raw: string): ParsedIcon {
  const viewBoxMatch = raw.match(/viewBox="([^"]+)"/)
  const innerMatch = raw.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return {
    viewBox: viewBoxMatch?.[1] ?? '0 -960 960 960',
    inner: innerMatch?.[1] ?? '',
  }
}

function getIcon(name: string, filled: boolean): ParsedIcon | undefined {
  const key = filled ? `${name}-fill` : name
  if (iconCache.has(key)) return iconCache.get(key)
  const path = Object.keys(rawIcons).find(p => p.endsWith(`/${key}.svg`))
  if (!path) return undefined
  const parsed = parseIcon(rawIcons[path])
  iconCache.set(key, parsed)
  return parsed
}

interface IconProps {
  /** Material Symbols icon name, e.g. "search", "account_balance_wallet" */
  name: string
  size?: number
  /** Filled (solid) variant vs outline */
  filled?: boolean
  color?: string
  className?: string
  'aria-label'?: string
  'aria-hidden'?: boolean
}

/** Thin wrapper rendering a self-hosted Material Symbols SVG inline — no webfont involved. */
export default function Icon({
  name,
  size = 24,
  filled = false,
  color,
  className = '',
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
}: IconProps) {
  const icon = useMemo(() => getIcon(name, filled), [name, filled])

  if (!icon) return null

  return (
    <svg
      viewBox={icon.viewBox}
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      style={{ color, flexShrink: 0 }}
      aria-hidden={ariaHidden ?? (ariaLabel ? undefined : true)}
      aria-label={ariaLabel}
      dangerouslySetInnerHTML={{ __html: icon.inner }}
    />
  )
}
