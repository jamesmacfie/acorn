import { describe, expect, it } from 'vitest'
import type { Integration, IntegrationsResponse } from './api'
import type { PublicIntegrationProvider } from './integrations'
import { availableModelConnections } from './modelProviders'

const provider = (id: string, kind: PublicIntegrationProvider['kind'] = 'model-provider'): PublicIntegrationProvider => ({
  id,
  label: id,
  glyph: id[0],
  kind,
  connection: {
    authKind: 'api-key',
    fields: [],
    connectable: true,
    disconnectable: true,
    maxConnections: 1,
  },
  capabilities: { textGeneration: kind === 'model-provider' },
})

const connection = (
  providerId: string,
  status: Integration['status'] = 'connected',
  capability: Integration['capabilities'][string] | null = 'available',
): Integration => ({
  id: `${providerId}-connection`,
  providerId,
  label: providerId,
  status,
  authKind: 'api-key',
  account: null,
  scopes: [],
  capabilities: capability === null ? {} : { textGeneration: capability },
  createdAt: 1,
  updatedAt: 1,
})

const response = (
  providers: PublicIntegrationProvider[],
  integrations: Integration[],
): IntegrationsResponse => ({ providers, integrations })

describe('availableModelConnections', () => {
  it('returns no connections when no model provider is configured', () => {
    expect(availableModelConnections(response([provider('openai')], []))).toEqual([])
  })

  it('returns OpenAI, Anthropic, or both by opaque connection id', () => {
    const providers = [provider('openai'), provider('anthropic')]
    const openai = connection('openai')
    const anthropic = connection('anthropic')

    expect(availableModelConnections(response(providers, [openai])).map((item) => item.connection.id))
      .toEqual(['openai-connection'])
    expect(availableModelConnections(response(providers, [anthropic])).map((item) => item.connection.id))
      .toEqual(['anthropic-connection'])
    expect(availableModelConnections(response(providers, [openai, anthropic])).map((item) => item.connection.id))
      .toEqual(['openai-connection', 'anthropic-connection'])
  })

  it.each([
    ['disabled', 'available'],
    ['degraded', 'available'],
    ['needs-auth', 'available'],
    ['connected', 'degraded'],
    ['connected', null],
  ] as const)('excludes status %s with capability %s', (status, capability) => {
    const item = connection(
      'openai',
      status as Integration['status'],
      capability as Integration['capabilities'][string] | null,
    )
    expect(availableModelConnections(response([provider('openai')], [item]))).toEqual([])
  })

  it('excludes a non-model provider even when it advertises the capability', () => {
    const github = provider('github', 'identity')
    github.capabilities.textGeneration = true
    expect(availableModelConnections(response([github], [connection('github')]))).toEqual([])
  })
})
