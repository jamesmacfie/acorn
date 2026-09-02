// The badge channel: the number on the app icon (docs/notifications.md § The channels).
//
// Not a sink, because it is not an event. The other channels fire once per notice; this one mirrors
// a running count, so it is an effect over the same accessor the bell's pill reads. One number with
// one meaning: if the badge and the pill ever disagreed, one of them would be wrong.
//
// Its own file rather than a few lines inside the bell, so the tracking below can be asserted
// without a DOM.
import { createEffect } from 'solid-js'
import { canSetBadge, setBadge } from '../../infra/platform'

/** Keep the app icon showing `pill()`, or nothing, for as long as the caller's reactive scope lives.
 *  A no-op where the host cannot draw a badge, which is every page.
 *
 *  `on()` is read first on purpose: switching the badge off stops tracking the pill, so this settles
 *  at one call with null rather than clearing the badge again on every unread that follows. */
export function trackBadge(pill: () => number, on: () => boolean): void {
  if (!canSetBadge()) return
  createEffect(() => setBadge(on() ? pill() || null : null))
}
