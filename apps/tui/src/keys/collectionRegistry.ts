import { onCleanup } from 'solid-js'
import type { Renderable } from '../tree/compat'

type Collection = {
  box: Renderable
  active: () => Renderable | undefined
  expands: () => boolean
}

let items = new WeakSet<Renderable>()
let itemPicks = new WeakMap<Renderable, () => void>()
let itemIdentities = new WeakMap<Renderable, string>()
const itemsByIdentity = new Map<string, Renderable>()
let containerByBox = new Map<Renderable, Collection>()

export const isItem = (node: Renderable): boolean => items.has(node)
export const itemPick = (node: Renderable): (() => void) | undefined => itemPicks.get(node)
export const itemIdentity = (node: Renderable): string | undefined => itemIdentities.get(node)
export const itemByIdentity = (identity: string): Renderable | undefined => itemsByIdentity.get(identity)
export const collectionAt = (box: Renderable): Collection | undefined => containerByBox.get(box)
export const collections = (): ReadonlyMap<Renderable, Collection> => containerByBox

// Keep logical row identity across a query refresh that replaces its renderable.
export function registerItem(
  box: Renderable,
  pick?: () => void,
  identity?: string,
  onDispose?: () => void,
): void {
  items.add(box)
  if (pick) itemPicks.set(box, pick)
  if (!identity) return
  itemIdentities.set(box, identity)
  itemsByIdentity.set(identity, box)
  onCleanup(() => {
    if (itemsByIdentity.get(identity) === box) itemsByIdentity.delete(identity)
    onDispose?.()
  })
}

export function markCollection(
  box: Renderable,
  active: () => Renderable | undefined,
  expands: () => boolean = () => false,
): void {
  const entry: Collection = { box, active, expands }
  containerByBox.set(box, entry)
  onCleanup(() => {
    if (containerByBox.get(box) === entry) containerByBox.delete(box)
  })
}

export function collectionExpands(node: Renderable | null, step: () => void): boolean {
  for (let at = node; at; at = at.parent) {
    step()
    const collection = containerByBox.get(at)
    if (collection) return collection.expands()
  }
  return false
}

export function resetCollections(): void {
  items = new WeakSet<Renderable>()
  itemPicks = new WeakMap<Renderable, () => void>()
  itemIdentities = new WeakMap<Renderable, string>()
  itemsByIdentity.clear()
  containerByBox = new Map<Renderable, Collection>()
}
