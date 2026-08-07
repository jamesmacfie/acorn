// Node-side capability registry (docs/plugins.md § Cross-plugin collaboration): a plugin
// exports a named typed function, and another plugin consumes it WITHOUT importing it. Before this
// existed, `agents.sessionExecute` was 234 lines of app-layer glue in apps/node/src/wiring/ whose
// only reason to live in the app was that neither plugin may import the other.
//
// Deliberately not a DI container. It is a Map with a phantom-typed key, because the entire problem
// is "two packages need to agree on a function type without an import edge" — the key carries the
// type, the provider's contract/ entrypoint exports the key, and that is the whole mechanism.
//
// The signature lives in the PROVIDER's contract/, never here: core has no business knowing what
// `agents.sessionExecute` returns.

export type Disposable = { dispose(): void }

// A capability id that remembers its own signature. `__signature` is never read at runtime and is
// optional so the brand cannot be constructed accidentally; it exists so `get(AGENTS_SESSION_EXECUTE)`
// returns the provider's type rather than `unknown`, with no registry-wide type parameter to thread.
export type CapabilityId<T> = string & { readonly __signature?: (value: T) => void }

export const capabilityId = <T>(id: string): CapabilityId<T> => id as CapabilityId<T>

export class CapabilityRegistry {
  readonly #impls = new Map<string, unknown>()

  // Providing twice is a programming error for the same reason the client Registry throws: the
  // winner would depend on plugin init order, which nothing guarantees.
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

  // Optional by default — an absent capability means "that plugin is disabled", which consumers must
  // degrade around rather than crash on. Resolve at CALL time, not at init time: init order between
  // two plugins is not defined, so a consumer that caches the result at init may cache `undefined`.
  get<T>(id: CapabilityId<T>): T | undefined {
    return this.#impls.get(id) as T | undefined
  }

  // For consumers of a `required: true` plugin (agents, github, memory, notes, terminal) where absence
  // is a bug, not a configuration.
  require<T>(id: CapabilityId<T>): T {
    const impl = this.get(id)
    if (impl === undefined) throw new Error(`Required capability not provided: ${id}`)
    return impl
  }

  ids(): readonly string[] {
    return [...this.#impls.keys()].sort()
  }
}

// Deliberately NOT a module singleton (unlike routeRegistry.ts, whose contributions arrive by
// side-effect import and so are naturally once-per-process). The plugin graph belongs to a service
// RUNTIME, not to the module: startServiceRuntime is a construct-and-teardown unit that a single
// process can run several times, and a shared registry would throw "already provided" on the second
// boot. The composition root creates one and threads it through; nothing reaches for a global.
//
// It is also kept off `Env`/RuntimeBindings on purpose — `c.env` reaches every core and plugin route
// (main/bindings.ts), and capabilities are a plugin-composition seam, not something a route handler
// should be able to enumerate.
