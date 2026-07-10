import type { IntegrationProviderContribution, ProviderRouteContribution } from './types'

class IntegrationProviderRegistry {
  readonly #providers = new Map<string, IntegrationProviderContribution>()
  readonly #routes: ProviderRouteContribution[] = []

  register(provider: IntegrationProviderContribution): void {
    if (this.#providers.has(provider.id)) throw new Error(`Duplicate integration provider '${provider.id}'.`)
    if (provider.capabilities.comments === 'write') {
      const mutation = provider.mutations?.find((item) => item.capability === 'comments')
      if (!mutation?.invalidates.length) throw new Error(`Provider '${provider.id}' declares writable comments without an invalidating mutation.`)
    }
    if (provider.capabilities.contextFormat && (!provider.codec || !provider.taskContext)) {
      throw new Error(`Provider '${provider.id}' declares context formatting without a codec and formatter.`)
    }
    if ((provider.capabilities.browse || provider.capabilities.promoteToTask) && !provider.resources.length) {
      throw new Error(`Provider '${provider.id}' declares browse/promotion without a mirrored resource.`)
    }
    const resourceIds = new Set<string>()
    for (const resource of provider.resources) {
      if (resourceIds.has(resource.id)) throw new Error(`Provider '${provider.id}' declares duplicate resource '${resource.id}'.`)
      resourceIds.add(resource.id)
      if (resource.ttlMs <= 0 || typeof resource.key !== 'function' || typeof resource.read !== 'function' || typeof resource.refresh !== 'function') {
        throw new Error(`Provider '${provider.id}' resource '${resource.id}' is not executable.`)
      }
    }
    if (provider.codec && !provider.conformance) throw new Error(`Provider '${provider.id}' has a codec without conformance fixtures.`)
    this.#providers.set(provider.id, provider)
  }

  require(id: string): IntegrationProviderContribution {
    const provider = this.#providers.get(id)
    if (!provider) throw new Error(`Unknown integration provider '${id}'.`)
    return provider
  }

  get(id: string): IntegrationProviderContribution | undefined {
    return this.#providers.get(id)
  }

  list(): readonly IntegrationProviderContribution[] {
    return [...this.#providers.values()]
  }

  registerRoute(route: ProviderRouteContribution): void {
    this.validateContribution(route.providerId, 'Provider route')
    if (this.#routes.some((candidate) => candidate.prefix === route.prefix)) {
      throw new Error(`Duplicate provider route prefix '${route.prefix}'.`)
    }
    this.#routes.push(route)
  }

  routes(): readonly ProviderRouteContribution[] {
    return this.#routes
  }

  validateContribution(providerId: string, kind: string): void {
    if (!this.#providers.has(providerId)) throw new Error(`${kind} names unregistered integration provider '${providerId}'.`)
  }
}

export const integrationProviderRegistry = new IntegrationProviderRegistry()
