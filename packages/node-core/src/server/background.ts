// Serve-then-revalidate helpers (docs/caching.md § Provider mirrors): routes answer from the local
// mirror and kick the refresh off here, fire-and-forget, in the long-lived Node process. Failures are
// logged, never surfaced, since the stale response already went out. The set exists so tests can
// await completion via settleBackground(); production never awaits.
import { emitError } from './telemetry/collector'
import { createLogger, describeError } from './telemetry/logger'

const log = createLogger('background')

const background = new Set<Promise<unknown>>()

/** `resource` is the caller-defined name of the thing being refreshed, and it must not carry an
 *  account: it reaches every sink, and a login is the owner's identity rather than a fact about the
 *  work (docs/telemetry.md § What never leaves the machine). */
export const trackBackgroundRefresh = (resource: string, promise: Promise<unknown>) => {
  const p = promise
    .catch((error) => {
      const described = describeError(error)
      log.error(`${resource} background refresh failed: ${described.message}`)
      // Handled, because the caller already had its answer: this is the refresh behind a stale
      // response, and nobody is waiting on it. The owner comes off the ambient context, which is
      // the route or the schedule that asked for the stale read (./telemetry/context.ts).
      emitError('core', { ...described, handled: true, attrs: { seam: 'background.refresh', resource } })
    })
    .finally(() => background.delete(p))
  background.add(p)
}

export const settleBackground = () => Promise.all(background)
