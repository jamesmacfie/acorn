// The client-side mirror of the node's capability registry
// (@acorn/node-core/server/plugin/capabilities.ts): a typed Map key, so one plugin can call another
// without an import edge between their packages.
//
// It exists because there was no such seam on the client, and its absence had started to bite. The
// agent task sidebar merges workflow steps into its roster, so plugins/agents needed
// plugins/workflows — while plugins/workflows' node half already needed plugins/agents to execute a
// session. Two legitimate couplings pointing opposite ways is a package cycle, which turbo refuses
// to build. Resolving one of them through a key rather than an import breaks it.
//
// Deliberately NOT a DI container, for the same reason the node's says so: it resolves nothing for
// you, constructs nothing, and orders nothing. It is a Map whose keys carry a type.
//
// Unlike the node's, this one IS a module singleton. The node's is per-runtime because the service
// can boot twice in one process; a renderer has exactly one client graph, and `_resetClientCapabilities`
// covers the only other case (a test).

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
      // Only if it is still OURS — a re-provide after disposal must not be clobbered by a stale handle.
      if (impls.get(id) === impl) impls.delete(id)
    },
  }
}

// Resolve at CALL time, never at module scope or in a component body that runs once. Plugin client
// registration order is not a dependency contract, so reading this during another plugin's init would
// cache `undefined` purely because the provider happened to be listed second.
export function clientCapability<T>(id: ClientCapabilityId<T>): T | undefined {
  return impls.get(id) as T | undefined
}

export const clientCapabilityIds = (): string[] => [...impls.keys()].sort()

// Test-only: the module singleton would otherwise leak one test's providers into the next.
export const _resetClientCapabilities = (): void => impls.clear()
