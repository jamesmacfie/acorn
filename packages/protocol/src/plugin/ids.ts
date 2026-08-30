// The two phantom-typed ids a plugin's contract/ exports so another package can address a capability
// or an extension point without importing its implementation (docs/plugins.md § Collaboration rules).
// Here rather than in node-core so a contract module imports wire types only.

// A capability id that remembers its own signature. `__signature` is never read at runtime and is
// optional so the brand cannot be constructed by accident. It makes `get(AGENTS_SESSION_EXECUTE)`
// return the provider's type rather than `unknown`, with no registry-wide type parameter to thread.
export type CapabilityId<T> = string & { readonly __signature?: (value: T) => void }

export const capabilityId = <T>(id: string): CapabilityId<T> => id as CapabilityId<T>

// A point id that remembers what its entries are. Same phantom-brand trick as CapabilityId, for the
// same reason: two packages agree on a type without an import edge between their implementations.
export type ExtensionPointId<T> = string & { readonly __entry?: (value: T) => void }

/** `<ownerPluginId>:<pointId>`, the same shape the client's points take. The owner half is checked
 *  against the declaring plugin at `open`, so a package cannot open a point under a stranger's name. */
export const extensionPointId = <T>(id: string): ExtensionPointId<T> => id as ExtensionPointId<T>
