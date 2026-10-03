//
// See docs/plugins/publishing.md § What is published, and what acorn promises about it.

/** A type this package names but does not describe. See the header. `T` is the owning declaration, for
 *  the reader and for the contract test; nothing reads it at runtime because there is no runtime. */
export type HostOwned<T extends string> = { readonly __hostOwned?: T }
