import { respondError } from '../respond'
import { createLogger, describeError } from '../telemetry/logger'
import { isProviderOperationError } from './types'

const log = createLogger('integrations:provider')

// One mapping from a provider failure to a wire error, shared by core's connection lifecycle routes
// and by plugin-owned connect flows; see docs/integrations.md § Provider boundaries for why it must
// stay the only one.
export const providerError = (c: Parameters<typeof respondError>[0], error: unknown) => {
  if (isProviderOperationError(error)) return respondError(c, error.status, error.code)
  // Nothing that reaches here was thrown on purpose, so `provider_unavailable` is a shrug: a provider
  // that was down, a response shaped the way nothing expected, and a failed write all land on it. The
  // one line below is the only record any of them leaves, and without it the code on the caller's
  // screen points at nothing. `describeError` is what keeps a credential out of the message, the same
  // guarantee respond.ts's backstop relies on.
  const { name, message } = describeError(error)
  log.warn(`unexpected provider failure: ${name}: ${message}`, { 'request.id': c.get('requestId') ?? 'unknown' })
  return respondError(c, 502, 'provider_unavailable')
}
