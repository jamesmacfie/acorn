// What one remote contribution is, once the chrome pass has bound it.
//
// Phase 3 had a registry here, keyed by a hard-coded target, because there was one place a tree could
// be drawn. There is no separate registry any more: a remote contribution is an ordinary entry in
// `registries/extensionPoints.ts` beside every other kind, and `./arbitration.ts` decides which of
// them fills a `Slot`. What is left is the shape `RemoteTree` mounts, which is the four things the
// worker needs and nothing else.
export type RemoteContribution = {
  /** The namespaced contribution id (../contributionIds.ts). */
  id: string
  pluginId: string
  /** The bundle this device accepted. The worker runs these bytes and no others. */
  hash: string
  /** Which key of the object the bundle passed to `mountTree`. */
  entry: string
  /** The one overlay of this plugin's own that this tree may ask the host to present, when its
   *  descriptor associated one (docs/plugins.md § Companion overlays). */
  overlay?: string
}
