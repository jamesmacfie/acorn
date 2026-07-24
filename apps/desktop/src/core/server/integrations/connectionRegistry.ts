import { isDeepStrictEqual } from 'node:util'
import type { CredentialField, PublicIntegrationProvider } from '../../shared/integrations'
import type { ConnectionProviderContribution } from './types'

const publicCredentialField = (field: CredentialField): CredentialField => ({
  id: field.id,
  label: field.label,
  type: field.type,
  required: field.required,
  ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
  ...(field.hint === undefined ? {} : { hint: field.hint }),
})

const descriptorFor = (provider: ConnectionProviderContribution): PublicIntegrationProvider => ({
  id: provider.id,
  label: provider.label,
  kind: provider.kind,
  glyph: provider.glyph,
  connection: {
    authKind: provider.connection.authKind,
    fields: provider.connection.fields.map(publicCredentialField),
    connectable: provider.connection.connectable,
    disconnectable: provider.connection.disconnectable,
    ...(provider.connection.maxConnections === undefined
      ? {}
      : { maxConnections: provider.connection.maxConnections }),
  },
  capabilities: provider.capabilities,
  ...(provider.models === undefined ? {} : { models: provider.models }),
  ...(provider.defaultModelId === undefined ? {} : { defaultModelId: provider.defaultModelId }),
})

const positiveInteger = (value: number): boolean => Number.isInteger(value) && value > 0

export class ConnectionProviderRegistry {
  readonly #providers = new Map<string, ConnectionProviderContribution>()

  register(provider: ConnectionProviderContribution): void {
    if (!provider.id.trim()) throw new Error('Connection provider id must not be empty.')
    if (this.#providers.has(provider.id)) throw new Error(`Duplicate connection provider '${provider.id}'.`)

    const fieldIds = new Set<string>()
    for (const field of provider.connection.fields) {
      if (!field.id.trim()) throw new Error(`Provider '${provider.id}' has an empty credential field id.`)
      if (fieldIds.has(field.id)) {
        throw new Error(`Provider '${provider.id}' declares duplicate credential field '${field.id}'.`)
      }
      fieldIds.add(field.id)
    }

    if (!positiveInteger(provider.budgets.maxConcurrentRequests)) {
      throw new Error(`Provider '${provider.id}' has an invalid provider request limit.`)
    }
    if (!positiveInteger(provider.budgets.maxConcurrentRequestsPerConnection)) {
      throw new Error(`Provider '${provider.id}' has an invalid connection request limit.`)
    }
    if (
      provider.connection.maxConnections !== undefined &&
      !positiveInteger(provider.connection.maxConnections)
    ) {
      throw new Error(`Provider '${provider.id}' has an invalid connection count limit.`)
    }

    const descriptor = provider.toPublic()
    if (!isDeepStrictEqual(descriptor, descriptorFor(provider))) {
      throw new Error(`Provider '${provider.id}' publishes an unsafe or inconsistent descriptor.`)
    }

    this.#providers.set(provider.id, provider)
  }

  require(id: string): ConnectionProviderContribution {
    const provider = this.#providers.get(id)
    if (!provider) throw new Error(`Unknown connection provider '${id}'.`)
    return provider
  }

  get(id: string): ConnectionProviderContribution | undefined {
    return this.#providers.get(id)
  }

  list(): readonly ConnectionProviderContribution[] {
    return [...this.#providers.values()]
  }
}

export const connectionProviderRegistry = new ConnectionProviderRegistry()
