// ── Extension points ──────────────────────────────────────────────────────────────────────────────

/** A point id that carries the type of its entries, the same phantom brand `CapabilityId` uses and for
 *  the same reason. The owning plugin's package exports the constant; you import that and nothing
 *  else. */
export type ExtensionPointId<T> = string & { readonly __entry?: (value: T) => void }

/** One entry in a point. `id` is `<yourPluginId>:<entryId>`, minted by the host, so two plugins can
 *  use the same entry name without shadowing each other. */
export type Extension<T> = {
  id: string
  pluginId: string
  order: number
  value: T
}

/** The node's many-to-many seam, beside the single-provider one above (docs/plugins.md § Cooperative
 *  extension points). Reach for a capability when there is one right answer, and for a point when
 *  there are many: several plugins each adding a workflow step kind, an event sink, a run backend.
 *
 * A point you open must be named `<yourPluginId>:<pointId>`. Contributing to a point nobody has opened
 * is not an error and not a no-op forever: entries wait, and the owner sees them the moment it opens
 * the point, because init order is not a dependency contract. */
export type PluginExtensionPointRegistry = {
  declare<T>(point: ExtensionPointId<T>, label: string): void
  handle<T>(point: ExtensionPointId<T>, entry: { id: string; order?: number; value: T }): void
  /** In declared order, ties broken by id. Resolve at call time, never at init. */
  handlers<T>(point: ExtensionPointId<T>): Extension<T>[]
  /** @deprecated Renamed to `declare`. Removed in the next major of the plugin API. */
  open<T>(point: ExtensionPointId<T>, label: string): void
  /** @deprecated Renamed to `handle`. Removed in the next major of the plugin API. */
  contribute<T>(point: ExtensionPointId<T>, entry: { id: string; order?: number; value: T }): void
  /** @deprecated Renamed to `handlers`. Removed in the next major of the plugin API. */
  entries<T>(point: ExtensionPointId<T>): Extension<T>[]
}

