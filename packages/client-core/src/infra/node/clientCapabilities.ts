// The client-side mirror of the node's capability registry
// (@acorn/node-core/server/pluginHost/capabilities.ts). See docs/plugins.md § Collaboration rules for
// why it exists, what it is not, and why it is a singleton unlike the node's.

// Where a key lives: with whichever side would otherwise have to import the other. Usually that is the
// provider, matching the node's rule that "the signature lives in the provider's contract/, never
// here". WORKFLOW_CONTROL is the exception and the reason the rule is written as "otherwise": agents
// declares it, workflows provides it, and the id string still names the provider, because agents draws
// the control and workflows already imports agents. Cycle-breaking wins over provider-ownership; put
// the key wherever it does not create the import you were avoiding, and say which in its own file.

// A phantom-typed string. The brand is optional so a plain string literal still satisfies the type at
// the declaration site, but `provide`/`get` infer T from it.
export type ClientCapabilityId<T> = string & { readonly __signature?: (value: T) => void }

export const clientCapabilityId = <T>(id: string): ClientCapabilityId<T> => id

export type Disposable = { dispose(): void }

const impls = new Map<string, unknown>()

// A duplicate id is a programming error, not a replacement: silently overwriting would make
// registration order observable, which is the bug the two-phase plugin lifecycle exists to prevent.
export function provideClientCapability<T>(id: ClientCapabilityId<T>, impl: T): Disposable {
  if (impls.has(id)) throw new Error(`client capability already provided: ${id}`)
  impls.set(id, impl)
  let disposed = false
  return {
    dispose: () => {
      if (disposed) return
      disposed = true
      // Only if the map still holds this exact implementation. A re-provide after disposal must not
      // be cleared by a stale handle.
      if (impls.get(id) === impl) impls.delete(id)
    },
  }
}

// Resolve at call time, never at module scope or in a component body that runs once
// (docs/plugins.md § Collaboration rules).
export function clientCapability<T>(id: ClientCapabilityId<T>): T | undefined {
  return impls.get(id) as T | undefined
}

// For a capability whose provider cannot be disabled, so absence is a wiring bug rather than a state a
// caller should branch on. Mirrors the node's `ctx.capabilities.require`.
export function requireClientCapability<T>(id: ClientCapabilityId<T>): T {
  const impl = impls.get(id)
  if (impl === undefined) throw new Error(`client capability not provided: ${id}`)
  return impl as T
}

export const clientCapabilityIds = (): string[] => [...impls.keys()].sort()

// Test-only: the module singleton would otherwise leak one test's providers into the next.
export const _resetClientCapabilities = (): void => impls.clear()
