import {
  connectionProviderRegistry,
  type ConnectionProviderRegistry,
} from '../integrations/connectionRegistry'
import type { ModelProviderAdapter } from './types'

export class ModelProviderRegistry {
  readonly #adapters = new Map<string, ModelProviderAdapter>()

  constructor(
    private readonly connectionProviders: ConnectionProviderRegistry,
  ) {}

  register(adapter: ModelProviderAdapter): void {
    if (this.#adapters.has(adapter.providerId)) {
      throw new Error(`Duplicate model provider adapter '${adapter.providerId}'.`)
    }
    const connectionProvider = this.connectionProviders.get(adapter.providerId)
    if (!connectionProvider) {
      throw new Error(`Model adapter names unregistered connection provider '${adapter.providerId}'.`)
    }
    if (connectionProvider.capabilities.textGeneration !== true) {
      throw new Error(`Model provider '${adapter.providerId}' does not declare text generation.`)
    }
    if (!adapter.recommendedModelId.trim()) {
      throw new Error(`Model provider '${adapter.providerId}' has no recommended model.`)
    }
    this.#adapters.set(adapter.providerId, adapter)
  }

  require(providerId: string): ModelProviderAdapter {
    const adapter = this.#adapters.get(providerId)
    if (!adapter) throw new Error(`Unknown model provider adapter '${providerId}'.`)
    return adapter
  }

  get(providerId: string): ModelProviderAdapter | undefined {
    return this.#adapters.get(providerId)
  }

  list(): readonly ModelProviderAdapter[] {
    return [...this.#adapters.values()]
  }
}

export const modelProviderRegistry = new ModelProviderRegistry(connectionProviderRegistry)
