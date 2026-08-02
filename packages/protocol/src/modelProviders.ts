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
