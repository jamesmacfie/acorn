import type { Integration, IntegrationsResponse } from './api'
import type { PublicIntegrationProvider } from './integrations'

export type AvailableModelConnection = {
  provider: PublicIntegrationProvider
  connection: Integration
}

export const availableModelConnections = (
  response: IntegrationsResponse,
): AvailableModelConnection[] => {
  const providers = new Map(
    response.providers
      .filter((provider) => provider.kind === 'model-provider')
      .map((provider) => [provider.id, provider]),
  )

  return response.integrations.flatMap((connection) => {
    const provider = providers.get(connection.providerId)
    return provider &&
      connection.status === 'connected' &&
      connection.capabilities.textGeneration === 'available'
      ? [{ provider, connection }]
      : []
  })
}

/**
 * Which model a connection starts on: the provider's declared default, or the first model it lists.
 *
 * Here rather than beside the picker that used to hold it, because two sides now need the same answer
 * and neither may import the other. The desktop's `ModelConnectionPicker` opens on it, and the
 * Database plugin's node half chooses it when the palette's `Generate SQL` generates with no picker at
 * all — so the fast path and the modal start on the same model by construction
 * (docs/database.md § From the command palette, step 3).
 *
 * `''` when the provider declares neither, which is a real answer: the caller omits the model and the
 * provider runtime falls back to its adapter's recommendation.
 */
export const defaultModelIdFor = (connection: AvailableModelConnection | undefined): string =>
  connection?.provider.defaultModelId ?? connection?.provider.models?.[0]?.id ?? ''
