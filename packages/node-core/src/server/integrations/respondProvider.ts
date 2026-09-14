import { respondError } from '../respond'
import { OnePasswordError } from '../core/onePassword'
import { ProviderOperationError } from './types'

// One mapping from a provider failure to a wire error, shared by core's connection lifecycle routes
// and by plugin-owned connect flows; see docs/integrations.md § Provider boundaries for why it must
// stay the only one.
export const providerError = (c: Parameters<typeof respondError>[0], error: unknown) => {
  if (error instanceof ProviderOperationError) return respondError(c, error.status, error.code)
  // Not 401: nothing about the credential was rejected. This node could not read it, which is a
  // fact about this machine's 1Password setup and is what the Security page explains.
  if (error instanceof OnePasswordError) return respondError(c, 502, 'provider_secret_ref_unreadable')
  return respondError(c, 502, 'provider_unavailable')
}
