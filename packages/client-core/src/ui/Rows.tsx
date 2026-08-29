import { For, type JSX } from 'solid-js'
import { createCollection, type CollectionItem, type ItemProps } from '../keys/collection'

// Rows: the run of `Row`s or `TreeRow`s, as a node.
//
// `Row` has always been "an item in a collection" (docs/future/layout/04-kit.md), and until now the
// collection was whatever `<div>` the pane happened to wrap it in — which is why arrow keys worked in
// three lists and nowhere else. This is that container, and it is the only thing a pane has to write
// to get arrows, Home, End, the page keys, type-ahead, `aria-activedescendant` and a selection that
// survives a refetch. The pane writes no key handling at all.
//
// Items are data rather than children, because the collection needs the keys before the rows are
// drawn: roving focus, type-ahead and the stored place are all keyed by the item's own key, not by
// its position. See ../keys/collection.ts.
//
// At 80×24: the rows on successive lines, the active one marked.
export function Rows<T extends CollectionItem>(props: {
  /** Keys the host's stored `active` and `selected`. Stable across a rebuild of `items`. */
  id: string
  ariaLabel?: string
  items: readonly T[]
  /** Draws as a tree rather than a list, for a run of `TreeRow`s. */
  tree?: boolean
  /** Controlled selection, and all of it: supplying this hands `selected` to the caller. */
  selected?: string | null
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  onExpand?: (key: string, expand: boolean) => void
  onMenu?: (key: string) => void
  /** `selected` is an accessor, not a boolean: a `<For>` body runs once per row, so a value read
   *  there would never change again. Read it inside the JSX prop. */
  children: (item: T, itemProps: ItemProps, selected: () => boolean) => JSX.Element
}) {
  const collection = createCollection({
    id: () => props.id,
    items: () => props.items,
    role: props.tree ? 'tree' : 'listbox',
    ...(props.selected !== undefined ? { selected: () => props.selected } : {}),
    ...(props.onSelect ? { onSelect: props.onSelect } : {}),
    ...(props.onActivate ? { onActivate: props.onActivate } : {}),
    ...(props.onExpand ? { onExpand: props.onExpand } : {}),
    ...(props.onMenu ? { onMenu: props.onMenu } : {}),
  })

  return (
    <div class="ui-rows" aria-label={props.ariaLabel} {...collection.containerProps}>
      {/* `<For>`, and safely: the rows are keyed by object here, but nothing focus-related lives in
          them. `active` and `selected` are in the host's store keyed by `item.key`, which is the whole
          point of holding them outside the rows. */}
      <For each={props.items}>
        {(item) => props.children(item, collection.itemProps(item.key), () => collection.selected() === item.key)}
      </For>
    </div>
  )
}
