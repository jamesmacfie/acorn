import { describe, expect, it } from 'vitest'
import type { Integration, IntegrationsResponse } from './api'
import type { PublicIntegrationProvider } from './integrations'
import type { ModelBackend } from './modelProviders'
import { availableModelConnections, defaultModelIdFor, parseBackendId } from './modelProviders'

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

    expect(availableModelConnections(response(providers, [openai])).map((backend) => backend.id))
      .toEqual(['connection:openai-connection'])
    expect(availableModelConnections(response(providers, [anthropic])).map((backend) => backend.id))
      .toEqual(['connection:anthropic-connection'])
    expect(availableModelConnections(response(providers, [openai, anthropic])).map((backend) => backend.id))
      .toEqual(['connection:openai-connection', 'connection:anthropic-connection'])
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

describe('the connection projection', () => {
  it('carries only what a Generate control draws, under a minted id', () => {
    const openai = provider('openai')
    openai.models = [{ id: 'gpt-5', label: 'GPT-5' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }]
    openai.defaultModelId = 'gpt-5-mini'
    const row = connection('openai')
    row.label = 'Work key'

    // The whole object, not a subset: an auth kind, a scope list or an account leaking into this
    // projection is exactly what the flat type exists to prevent, and only equality can see it.
    expect(availableModelConnections(response([openai], [row]))).toEqual([{
      id: 'connection:openai-connection',
      kind: 'connection',
      label: 'Work key',
      glyph: 'o',
      models: [{ id: 'gpt-5', label: 'GPT-5' }, { id: 'gpt-5-mini', label: 'GPT-5 mini' }],
      defaultModelId: 'gpt-5-mini',
    }])
  })

  it('falls back to the provider label and an empty catalog', () => {
    const row = connection('openai')
    row.label = ''
    const [backend] = availableModelConnections(response([provider('openai')], [row]))
    expect(backend).toMatchObject({ label: 'openai', models: [], defaultModelId: '' })
  })
})

describe('parseBackendId', () => {
  it('resolves a bare uuid and its prefixed form to the same connection', () => {
    // The compatibility rule the whole id scheme rests on: a saved workflow step and a device pref
    // both hold a bare uuid from before core minted these ids, and neither is rewritten.
    const bare = parseBackendId('7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(bare).toEqual({ kind: 'connection', id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' })
    expect(parseBackendId('connection:7c9e6679-7425-40de-944b-e07fc1f90ae7')).toEqual(bare)
  })

  it('round-trips the id the connection projection mints', () => {
    const [backend] = availableModelConnections(response([provider('openai')], [connection('openai')]))
    expect(parseBackendId(backend.id)).toEqual({ kind: 'connection', id: 'openai-connection' })
  })

  it('reads a harness id and keeps the profile id whole', () => {
    expect(parseBackendId('harness:claude-code')).toEqual({ kind: 'harness', id: 'claude-code' })
  })
})

describe('defaultModelIdFor', () => {
  const backend = (models: Array<{ id: string; label: string }>, defaultModelId: string): ModelBackend => ({
    id: 'harness:x',
    kind: 'harness',
    label: 'X',
    models,
    defaultModelId,
  })

  it('prefers the declared default, then the first model, then nothing', () => {
    expect(defaultModelIdFor(backend([{ id: 'a', label: 'A' }], 'b'))).toBe('b')
    expect(defaultModelIdFor(backend([{ id: 'a', label: 'A' }], ''))).toBe('a')
    expect(defaultModelIdFor(backend([], ''))).toBe('')
    expect(defaultModelIdFor(undefined)).toBe('')
  })
})
