import { respondError } from '../respond'
import { ProviderOperationError } from './types'

// One mapping from a provider failure to a wire error, shared by core's connection lifecycle routes
// and by plugin-owned connect flows; see docs/integrations.md § Provider boundaries for why it must
// stay the only one.
export const providerError = (c: Parameters<typeof respondError>[0], error: unknown) => {
  if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
  return respondError(c, 502, 'provider_unavailable')
}
