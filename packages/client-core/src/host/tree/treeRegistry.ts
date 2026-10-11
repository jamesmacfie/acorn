// What one remote contribution is, once the chrome pass has bound it.
//
// A remote contribution is an ordinary entry in `extensionRegistry` beside every other kind, and
// `resolveSlot` decides which of them fills a `Slot`. This is the shape `RemoteTree` mounts: the four
// things the worker needs and nothing else.
export type RemoteContribution = {
  /** The namespaced contribution id (`pluginExtensionId`). */
  id: string
  pluginId: string
  /** The bundle this device accepted. The worker runs these bytes and no others. */
  hash: string
  /** Which key of the object the bundle passed to `mountTree`. */
  entry: string
  /** The one overlay of this plugin's own that this tree may ask the host to present, when its
   *  descriptor associated one (docs/plugins/remote-points.md § Companion overlays). */
  overlay?: string
}
