// The client-side mirror of the node's capability registry
// (@acorn/node-core/server/plugin/capabilities.ts). See docs/plugins.md § Collaboration rules for
// why it exists, what it is not, and why it is a singleton unlike the node's.

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

export const clientCapabilityIds = (): string[] => [...impls.keys()].sort()

// Test-only: the module singleton would otherwise leak one test's providers into the next.
export const _resetClientCapabilities = (): void => impls.clear()
