import { describe, expect, it } from 'vitest'
import { publicConnectionProvider } from './providers/shared'
import { ConnectionProviderRegistry } from './connectionRegistry'

const provider = (id = 'test-provider') =>
  publicConnectionProvider({
    id,
    label: 'Test provider',
    glyph: 'T',
    kind: 'generic',
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
          label: 'Test provider',
          account: null,
          scopes: [],
          config: {},
          capabilities: {},
        }
      },
      async test() {
        return { ok: true }
      },
    },
    capabilities: {},
    budgets: { maxConcurrentRequests: 2, maxConcurrentRequestsPerConnection: 1 },
  })

describe('ConnectionProviderRegistry', () => {
  it('registers a connection-only provider without external-item contracts', () => {
    const registry = new ConnectionProviderRegistry()
    const contribution = provider()

    registry.register(contribution)

    expect(registry.require(contribution.id)).toBe(contribution)
    expect(registry.list()).toEqual([contribution])
  })

  it('rejects duplicate providers and credential field ids', () => {
    const registry = new ConnectionProviderRegistry()
    registry.register(provider())

    expect(() => registry.register(provider())).toThrow("Duplicate connection provider 'test-provider'.")

    const invalid = provider('duplicate-fields')
    invalid.connection.fields.push({ id: 'apiKey', label: 'Again', type: 'password', required: true })
    expect(() => registry.register(invalid)).toThrow("duplicate credential field 'apiKey'")
  })

  it('rejects invalid request and connection-count limits', () => {
    const invalidRequests = provider('invalid-requests')
    invalidRequests.budgets.maxConcurrentRequests = 0
    expect(() => new ConnectionProviderRegistry().register(invalidRequests)).toThrow('invalid provider request limit')

    const invalidConnections = provider('invalid-connections')
    invalidConnections.connection.maxConnections = 0
    expect(() => new ConnectionProviderRegistry().register(invalidConnections)).toThrow('invalid connection count limit')
  })

  it('rejects descriptors that publish fields outside the safe projection', () => {
    const invalid = provider('unsafe')
    invalid.toPublic = () => ({
      ...provider('safe').toPublic(),
      id: 'unsafe',
      apiKey: 'plaintext',
    } as ReturnType<typeof invalid.toPublic>)

    expect(() => new ConnectionProviderRegistry().register(invalid)).toThrow('unsafe or inconsistent descriptor')
  })

  it('strips undeclared credential-field metadata from public descriptors', () => {
    const contribution = provider('safe-fields')
    Object.assign(contribution.connection.fields[0], { secret: 'plaintext' })

    const descriptor = contribution.toPublic()

    expect(descriptor.connection.fields[0]).toEqual({
      id: 'apiKey',
      label: 'API key',
      type: 'password',
      required: true,
    })
    expect(JSON.stringify(descriptor)).not.toContain('plaintext')
  })
})
