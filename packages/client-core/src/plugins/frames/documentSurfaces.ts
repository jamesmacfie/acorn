import type { PluginDocumentRegion, PluginFrameSurface } from '@acorn/protocol/api.ts'
import { ownsRoute } from '../chrome/data'

// Which declared surfaces the HOST draws, and whether their routes are ones this device will fetch
// (docs/third-party/monaco.md).
//
// A plain module rather than lines inside register.tsx, because the decision below is the trust gate
// for a whole class of surface and register.tsx cannot be imported by a test — the suite here is
// node-environment with no JSX transform, deliberately.

/**
 * Does this surface's rectangle contain any plugin code?
 *
 * A `layout` block means the host draws the regions it names, and the degenerate `document` template
 * names all of them — so nothing is left over for a frame, no bundle is mounted, and the surface is
 * gated like a DESCRIPTOR rather than like a frame.
 *
 * `document-over-frame` is where that difference shows up, and it falls on the other side: half the
 * pane IS the plugin's own bundle running in an iframe, so it needs an accepted bytes hash exactly like
 * any other frame. A composed pane is not a cheaper way to run untrusted code.
 */
export const isHostOwnedSurface = (surface: PluginFrameSurface): boolean =>
  surface.target === 'pane' && surface.layout?.template === 'document'

/**
 * The document region this surface declares, or `null` when it declares none.
 *
 * Throws when it declares one the host may not serve. The node confined these routes when it parsed
 * the manifest — but the manifest reached this device as a ROSTER ROW, which is bytes a node sent, so
 * the check is repeated here for the reason chrome/data.ts states at length. Throwing rather than
 * returning null is what puts the surface through register.tsx's per-surface catch: one bad surface is
 * skipped and logged, and the rest of the plugin still works.
 */
export function documentRegionFor(pluginId: string, surface: PluginFrameSurface): PluginDocumentRegion | null {
  const region = surface.layout?.document
  if (!region) return null
  if (!ownsRoute(pluginId, region.read)) throw new Error(`document read route '${region.read}' is outside ${pluginId}'s namespace`)
  if (region.write && !ownsRoute(pluginId, region.write)) {
    throw new Error(`document write route '${region.write}' is outside ${pluginId}'s namespace`)
  }
  // A capability route is a route like any other. The host calls it on the plugin's behalf on every
  // completion trigger, so it is confined here on the same terms as the two above.
  if (region.completions && !ownsRoute(pluginId, region.completions.route)) {
    throw new Error(`completions route '${region.completions.route}' is outside ${pluginId}'s namespace`)
  }
  return region
}
