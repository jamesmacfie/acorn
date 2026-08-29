import type { PluginFrameSurface, PluginPaneRegion } from '@acorn/protocol/api.ts'
import { hasFrameRegion, hasRemoteRegion } from '@acorn/protocol/pluginContract.ts'
import { isPaneLayout, regionProblem, type PaneLayoutName } from '@acorn/protocol/paneLayouts.ts'
import { ownsRoute } from '../chrome/data'

// Which declared layouts the host draws, and whether the routes inside them are ones this device will
// fetch (docs/panes.md § Layout model, docs/future/layout/05-layouts.md).
//
// A plain module rather than lines inside register.ts, because the decision below is the trust gate for
// a whole class of surface and deserves to be named and tested as one. It was extracted when
// register.tsx could not be imported by a test at all; that file is now `.ts` and has its own suite,
// which makes this a choice about naming rather than a workaround, and the choice still holds.

/** The regions of one pane, after the client has re-checked every name and every route. */
export type ResolvedPaneLayout = {
  layout: PaneLayoutName
  regions: Record<string, PluginPaneRegion>
}

/** The bundle entry a region names, or `null` when it names none. One place to ask, because the union
 *  is three-shaped and every caller wants the same one thing out of it. */
export const remoteRegionEntry = (region: PluginPaneRegion): string | null =>
  region !== 'frame' && region.kind === 'remote' ? region.entry : null

/**
 * Does this surface draw without running any of the plugin's code?
 *
 * A layout whose regions are all documents means the host draws every one of them, so nothing is left
 * over for a bundle, none is mounted, and the surface is gated like a descriptor rather than like a
 * frame.
 *
 * `document-over-frame` is where that difference shows up, and it falls on the other side: half the
 * pane is the plugin's own bundle, so it needs an accepted bytes hash exactly like any other frame. A
 * composed pane is not a cheaper way to run untrusted code, and that is as true of a `remote` region
 * as of a `frame` one — the tree path changes where the bytes run, not whether they are the plugin's.
 */
export const isHostOwnedSurface = (surface: PluginFrameSurface): boolean =>
  surface.target === 'pane' && surface.layout !== undefined && !hasFrameRegion(surface) && !hasRemoteRegion(surface)

/**
 * The layout and regions this surface declares, or `null` when it declares none.
 *
 * Throws when it declares one the host may not serve. The node checked all of this when it parsed the
 * manifest, but the manifest reached this device as a roster row, which is bytes a node sent, so the
 * checks are repeated here for the reason chrome/data.ts states at length. Throwing rather than
 * returning null is what puts the surface through register.ts's per-surface catch: one bad surface is
 * skipped and logged, and the rest of the plugin still works.
 */
export function paneLayoutFor(pluginId: string, surface: PluginFrameSurface): ResolvedPaneLayout | null {
  if (surface.layout === undefined) return null
  if (!isPaneLayout(surface.layout)) throw new Error(`'${surface.layout}' is not a layout this build draws`)
  const regions = surface.regions ?? {}
  const problem = regionProblem(surface.layout, Object.keys(regions))
  if (problem) throw new Error(problem)
  for (const region of Object.values(regions)) {
    if (region === 'frame') continue
    // A remote region names an entry in the bundle, not a route. Nothing to confine: the name is a key
    // of the object the plugin passed to `mountTree`, and a key with no renderer behind it draws the
    // labelled placeholder rather than reaching anything (plugins/tree/TreeHost.tsx).
    if (region.kind === 'remote') continue
    if (!ownsRoute(pluginId, region.read)) throw new Error(`document read route '${region.read}' is outside ${pluginId}'s namespace`)
    if (region.write && !ownsRoute(pluginId, region.write)) {
      throw new Error(`document write route '${region.write}' is outside ${pluginId}'s namespace`)
    }
    // A capability route is a route like any other. The host calls it on the plugin's behalf on every
    // completion trigger, so it is confined here on the same terms as the two above.
    if (region.completions && !ownsRoute(pluginId, region.completions.route)) {
      throw new Error(`completions route '${region.completions.route}' is outside ${pluginId}'s namespace`)
    }
  }
  return { layout: surface.layout, regions }
}
