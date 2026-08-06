import {
  connectionProviderRegistry,
  type ConnectionProviderRegistry,
} from '../integrations/connectionRegistry'
import type { ModelProviderAdapter } from './types'

export class ModelProviderRegistry {
  readonly #adapters = new Map<string, ModelProviderAdapter>()
  readonly #owners = new Map<string, string>() // providerId → owning plugin; see integrations/registry.ts

  constructor(
    private readonly connectionProviders: ConnectionProviderRegistry,
  ) {}

  register(adapter: ModelProviderAdapter, owner?: string): void {
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
    if (owner) this.#owners.set(adapter.providerId, owner)
  }

  removeForPlugin(plugin: string): void {
    for (const [id, owner] of [...this.#owners.entries()]) {
      if (owner !== plugin) continue
      this.#adapters.delete(id)
      this.#owners.delete(id)
    }
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
