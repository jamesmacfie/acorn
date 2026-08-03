import { respondError } from '../respond'
import { ProviderOperationError } from './types'

// One mapping from a provider failure to a wire error, shared by core's connection lifecycle routes
// and by plugin-owned connect flows (github's device flow).
//
// Shared rather than duplicated because this decides what reaches the client: anything that is not a
// deliberate ProviderOperationError becomes a flat provider_unavailable, so an upstream exception
// message — which may quote a URL, a token fragment or a response body — never escapes. Two copies
// of that rule could drift, and the drift would be a leak.
export const providerError = (c: Parameters<typeof respondError>[0], error: unknown) => {
  if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
  return respondError(c, 502, 'provider_unavailable')
}
