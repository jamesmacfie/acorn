import { ProviderOperationError } from '../../../core/server/integrations/types'

const statusOf = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

export const modelProviderError = (error: unknown): ProviderOperationError => {
  if (error instanceof ProviderOperationError) return error
  const status = statusOf(error)
  if (status === 401 || status === 403) return new ProviderOperationError('provider_needs_auth', 401)
  if (status === 429) return new ProviderOperationError('provider_rate_limited', 429)
  return new ProviderOperationError('provider_unavailable', 502)
}

export const modelProviderHealth = (
  error: unknown,
): { ok: false; error: 'provider_needs_auth' | 'provider_rate_limited' | 'provider_unavailable' } => {
  const mapped = modelProviderError(error)
  if (mapped.code === 'provider_needs_auth' || mapped.code === 'provider_rate_limited') {
    return { ok: false, error: mapped.code }
  }
  return { ok: false, error: 'provider_unavailable' }
}
