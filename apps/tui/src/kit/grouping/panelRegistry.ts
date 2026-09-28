import { onCleanup } from 'solid-js'
import type { Renderable } from '../../tree/compat'
import { panelsChanged } from '../../keys/regions'

// Tabs and panels can mount as siblings, so idPrefix identifies their relationship across components.
// The map keeps stable arrays for region walks and rebuilds a list only when a panel mounts or leaves.
const panelsByPrefix = new Map<string, Renderable[]>()

const NO_PANELS: readonly Renderable[] = []

/** The panels a strip owns, as the stored list. Never mutated by a caller. */
export const panelsFor = (idPrefix: string): readonly Renderable[] => panelsByPrefix.get(idPrefix) ?? NO_PANELS

/** Register a panel until its Solid owner disposes. */
export function registerPanel(idPrefix: string, box: Renderable): void {
  panelsByPrefix.set(idPrefix, [...panelsFor(idPrefix), box])
  // Refresh the region store's derived set of panel boxes.
  panelsChanged()
  onCleanup(() => {
    const rest = panelsFor(idPrefix).filter((panel) => panel !== box)
    if (rest.length) panelsByPrefix.set(idPrefix, rest)
    else panelsByPrefix.delete(idPrefix)
    panelsChanged()
  })
}
