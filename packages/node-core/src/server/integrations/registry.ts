import type { IntegrationProviderContribution, ProviderRouteContribution } from './types'

// A MODULE SINGLETON, like routeRegistry and unlike the capability registry, because a provider
// contribution is a static descriptor rather than a per-boot object bound to a database handle. But it is
// now written by plugin INIT rather than by a one-time side-effect import, and that changes one thing:
// `startServiceRuntime` can run several times in one process (its own test does it four times), so a
// second boot would hit the duplicate-id guards below and fail the whole boot. Hence `removePluginProviders`
// — the exact counterpart of `removePluginRoutes`, called by the plugin host before each init.
//
// Owner is tracked rather than inferred from the id: a plugin may contribute several providers
// (model-providers registers two), and the ids are not derived from the plugin name.
class IntegrationProviderRegistry {
  readonly #providers = new Map<string, IntegrationProviderContribution>()
  readonly #owners = new Map<string, string>() // providerId → owning plugin
  readonly #routes: ProviderRouteContribution[] = []

  register(provider: IntegrationProviderContribution, owner?: string): void {
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
    if (owner) this.#owners.set(provider.id, owner)
  }

  // Drop everything `plugin` contributed on a previous boot, providers and their routers alike. Routes go
  // first: a route contribution is validated against a REGISTERED provider, so removing the provider first
  // would leave a router referring to nothing.
  removeForPlugin(plugin: string): void {
    const ids = [...this.#owners.entries()].filter(([, owner]) => owner === plugin).map(([id]) => id)
    if (!ids.length) return
    for (let i = this.#routes.length - 1; i >= 0; i--) {
      if (ids.includes(this.#routes[i]!.providerId)) this.#routes.splice(i, 1)
    }
    for (const id of ids) {
      this.#providers.delete(id)
      this.#owners.delete(id)
    }
  }

  require(id: string): IntegrationProviderContribution {
    const provider = this.#providers.get(id)
    if (!provider) throw new Error(`Unknown integration provider '${id}'.`)
    return provider
  }

  get(id: string): IntegrationProviderContribution | undefined {
    return this.#providers.get(id)
  }

  ownerOf(id: string): string | undefined {
    return this.#owners.get(id)
  }

  assertOwnedBy(id: string, plugin: string): void {
    this.validateContribution(id, 'Plugin provider runtime')
    if (this.#owners.get(id) !== plugin) {
      throw new Error(`Plugin '${plugin}' cannot use integration provider '${id}' because it does not own it.`)
    }
  }

  list(): readonly IntegrationProviderContribution[] {
    return [...this.#providers.values()]
  }

  registerRoute(route: ProviderRouteContribution): void {
    this.validateContribution(route.providerId, 'Provider route')
    // Keyed by (providerId, prefix): the prefix is namespace-relative now, so two providers may both
    // contribute the empty prefix — only the same provider doing it twice is a collision.
    if (this.#routes.some((candidate) => candidate.providerId === route.providerId && candidate.prefix === route.prefix)) {
      throw new Error(`Duplicate provider route prefix '${route.prefix}' for provider '${route.providerId}'.`)
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
