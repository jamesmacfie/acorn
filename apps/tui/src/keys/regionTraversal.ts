import type { Renderable } from '../tree/compat'

/** Walk visible descendants in reading order. The caller supplies the visit counter. */
export const firstInTree = (
  box: Renderable,
  take: (node: Renderable) => boolean,
  step: () => void,
): Renderable | undefined => {
  for (const child of box.getChildren()) {
    step()
    if (child.visible && take(child)) return child
    const nested = child.visible ? firstInTree(child, take, step) : undefined
    if (nested) return nested
  }
  return undefined
}

export type StopTree = {
  /** Panels belong to their parent stop, so this walk skips them. */
  panels: ReadonlySet<Renderable>
  regions: ReadonlyMap<Renderable, unknown>
  parents: ReadonlyMap<Renderable, unknown>
  collections: ReadonlyMap<Renderable, { active: () => Renderable | undefined }>
  step: () => void
}

/** The stops inside a box, with nested regions and viewports handled at their own level. */
export const stopsInTree = (box: Renderable, tree: StopTree): Renderable[] => {
  const found: Renderable[] = []
  const visit = (parent: Renderable): void => {
    for (const child of parent.getChildren()) {
      tree.step()
      if (!child.visible || child.isDestroyed || tree.panels.has(child)) continue
      if (tree.regions.has(child)) {
        visit(child)
        continue
      }
      if (tree.parents.has(child)) {
        found.push(child)
        continue
      }
      const collection = tree.collections.get(child)
      if (collection) {
        const row = collection.active()
        if (row && !row.isDestroyed && row.visible) found.push(row)
        else if (child.focusable) found.push(child)
        continue
      }
      if (child.kind === 'scrollbox') {
        const before = found.length
        visit(child)
        if (found.length === before) found.push(child)
        continue
      }
      if (child.focusable) {
        found.push(child)
        continue
      }
      visit(child)
    }
  }
  visit(box)
  return found
}

/** Pick the adjacent stop without moving focus or deciding what an edge means. */
export const adjacentStop = (
  stops: readonly Renderable[],
  from: Renderable,
  delta: 1 | -1,
  wrap = false,
): Renderable | undefined => {
  const at = stops.indexOf(from)
  if (at < 0) return undefined
  return wrap ? stops[(at + delta + stops.length) % stops.length] : stops[at + delta]
}
