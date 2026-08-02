import { describe, expect, it } from 'vitest'
import { ConnectionProviderRegistry } from '../integrations/connectionRegistry'
import { publicConnectionProvider } from '../integrations/providers/shared'
import { ModelProviderRegistry } from './registry'

const connectionProvider = (textGeneration: boolean) =>
  publicConnectionProvider({
    id: 'model-test',
    label: 'Model test',
    glyph: 'M',
    kind: 'model-provider',
    connection: {
      authKind: 'api-key',
      fields: [{ id: 'apiKey', label: 'API key', type: 'password', required: true }],
      connectable: true,
      disconnectable: true,
      async validate(credentials) {
        return credentials.apiKey ?? ''
      },
      normalize(_credentials, secret) {
        return {
          secret,
          label: 'Model test',
          account: null,
          scopes: [],
          config: {},
          capabilities: { textGeneration: 'available' as const },
        }
      },
      async test() {
        return { ok: true }
      },
    },
    capabilities: { textGeneration },
    budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
  })

const adapter = {
  providerId: 'model-test',
  recommendedModelId: 'model-test-1',
  async generateText() {
    return { text: 'generated', modelId: 'model-test-1' }
  },
}

describe('ModelProviderRegistry', () => {
  it('registers an adapter for a text-generation connection provider', () => {
    const connections = new ConnectionProviderRegistry()
    connections.register(connectionProvider(true))
    const registry = new ModelProviderRegistry(connections)

    registry.register(adapter)

    expect(registry.require('model-test')).toBe(adapter)
  })

  it('rejects missing providers, missing capabilities, duplicates, and empty models', () => {
    const missing = new ModelProviderRegistry(new ConnectionProviderRegistry())
    expect(() => missing.register(adapter)).toThrow('unregistered connection provider')

    const connections = new ConnectionProviderRegistry()
    connections.register(connectionProvider(false))
    expect(() => new ModelProviderRegistry(connections).register(adapter)).toThrow('does not declare text generation')

    const enabledConnections = new ConnectionProviderRegistry()
    enabledConnections.register(connectionProvider(true))
    const duplicate = new ModelProviderRegistry(enabledConnections)
    duplicate.register(adapter)
    expect(() => duplicate.register(adapter)).toThrow('Duplicate model provider adapter')

    const empty = new ModelProviderRegistry(enabledConnections)
    expect(() => empty.register({ ...adapter, recommendedModelId: ' ' })).toThrow('has no recommended model')
  })
})
