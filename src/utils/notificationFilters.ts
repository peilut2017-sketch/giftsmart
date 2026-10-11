/**
 * Drops items dated before the account existed, so a new user never sees broadcasts,
 * deals or updates from before they signed up. With no usable signup date everything
 * is kept (better an old item than an empty feed for an account we can't date).
 * An item whose own date can't be parsed is dropped when a signup date is known —
 * "can't prove it's after signup" must not leak history.
 */
export function sinceSignup<T extends { timestamp: string }>(items: T[], signupIso: string | null | undefined): T[] {
  const signupMs = signupIso ? Date.parse(signupIso) : NaN
  if (!Number.isFinite(signupMs)) return items
  return items.filter(i => Date.parse(i.timestamp) >= signupMs)
}
