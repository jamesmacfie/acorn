import { onCleanup } from 'solid-js'
import type { Renderable } from '../tree/compat'

export type ParentStop = {
  node: Renderable
  panels: () => readonly Renderable[]
  cross?: (delta: 1 | -1) => boolean
}

let parents: ParentStop[] = []
let byNode = new Map<Renderable, ParentStop>()
let panelBoxes: Set<Renderable> | null = null

// Panels mount after their strip. Invalidate the derived set whenever that relationship changes.
export const panelsChanged = (): void => { panelBoxes = null }

export const panelSet = (): Set<Renderable> => {
  if (panelBoxes) return panelBoxes
  const found = new Set<Renderable>()
  for (const parent of parents) {
    for (const panel of parent.panels()) if (panel !== parent.node) found.add(panel)
  }
  panelBoxes = found
  return found
}

export const parentEntry = (node: Renderable): ParentStop | undefined => byNode.get(node)
export const parentEntries = (): ReadonlyMap<Renderable, ParentStop> => byNode
export const isPanel = (node: Renderable): boolean => panelSet().has(node)

export const ownerOf = (panel: Renderable): ParentStop | undefined =>
  parents.find((parent) => parent.node !== panel && parent.panels().includes(panel))

export function markParent(
  node: Renderable,
  panels: () => readonly Renderable[],
  cross?: (delta: 1 | -1) => boolean,
): void {
  const entry: ParentStop = cross ? { node, panels, cross } : { node, panels }
  parents.push(entry)
  byNode.set(node, entry)
  panelsChanged()
  onCleanup(() => {
    const at = parents.indexOf(entry)
    if (at >= 0) parents.splice(at, 1)
    if (byNode.get(node) === entry) byNode.delete(node)
    panelsChanged()
  })
}

// A strip is a sibling of its panels, so the panel box supplies the missing tree edge.
export function findParent(node: Renderable, step: () => void): Renderable | undefined {
  for (let at: Renderable | null = node; at; at = at.parent) {
    step()
    if (!isPanel(at)) continue
    const owner = ownerOf(at)
    if (owner) return owner.node
  }
  return undefined
}

export function resetParentStops(): void {
  parents = []
  byNode = new Map<Renderable, ParentStop>()
  panelBoxes = null
}
