// Node-side capability registry (docs/plugins.md § Collaboration rules): a plugin exports a named
// typed function, and another plugin consumes it without importing it.
//
// Not a DI container. It is a Map with a phantom-typed key, because the whole problem is two packages
// agreeing on a function type without an import edge. The key carries the type and the provider's
// contract/ entrypoint exports the key.
//
// The signature lives in the provider's contract/, never here: core has no business knowing what
// `agents.sessionExecute` returns.

export type Disposable = { dispose(): void }

// The id and its brand live in @acorn/protocol so a plugin's contract/ can mint one without importing
// this package; re-exported here for the registry's own callers.
import { type CapabilityId } from '@acorn/protocol/pluginIds.ts'
export { capabilityId, type CapabilityId } from '@acorn/protocol/pluginIds.ts'

export class CapabilityRegistry {
  readonly #impls = new Map<string, unknown>()

  // Providing twice is a programming error for the same reason the client Registry throws: the winner
  // would depend on plugin init order, which nothing guarantees.
  provide<T>(id: CapabilityId<T>, impl: T): Disposable {
    if (this.#impls.has(id)) throw new Error(`Capability already provided: ${id}`)
    this.#impls.set(id, impl)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.#impls.get(id) === impl) this.#impls.delete(id)
      },
    }
  }

  // Optional by default: an absent capability means "that plugin is disabled", which consumers degrade
  // around rather than crash on. Resolve at call time, not at init time, because init order between
  // two plugins is undefined and a consumer that caches at init may cache `undefined`.
  get<T>(id: CapabilityId<T>): T | undefined {
    return this.#impls.get(id) as T | undefined
  }

  // For consumers of a `required: true` plugin (agents, memory, notes, terminal) where absence is a bug,
  // not a configuration.
  require<T>(id: CapabilityId<T>): T {
    const impl = this.get(id)
    if (impl === undefined) throw new Error(`Required capability not provided: ${id}`)
    return impl
  }

  ids(): readonly string[] {
    return [...this.#impls.keys()].sort()
  }
}

// Not a module singleton, unlike routeRegistry.ts, whose contributions arrive by side-effect import.
// The plugin graph belongs to a service runtime: startServiceRuntime is a construct-and-teardown unit
// one process can run several times, and a shared registry would throw "already provided" on the
// second boot. The composition root creates one and threads it through.
//
// It is also kept off `Env` and RuntimeBindings. `c.env` reaches every core and plugin route
// (server/bindings.ts), and capabilities are a plugin-composition seam, not something a route handler
// should enumerate.
