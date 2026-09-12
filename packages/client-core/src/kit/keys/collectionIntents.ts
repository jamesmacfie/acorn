// What every collection does with an intent, with nothing about how it draws.
//
// Split out of `collection.ts` in terminal phase 2. The arrows, Home, End, the page keys, wrapping,
// where the first press lands, and which of `select` and `activate` picks are all rules about a list
// rather than about a document, and a second host had to keep them exactly
// (docs/tui.md § Collections). What stayed behind in `collection.ts`
// is the DOM half: `focus()`, `scrollIntoView`, the `aria-*` and `tabindex` getters.
//
// The host supplies two things and nothing else: `land`, which puts focus on an item, and `onItem`,
// which says whether the item itself holds focus rather than a control inside it. Everything else —
// where the place is kept, what wraps, what an empty list answers — is here and is the same on both.

import { collectionState, setActiveItem, setSelectedItem } from './collectionState'
import type { Intent } from './intents'

export type CollectionItem = {
  key: string
  disabled?: boolean
  /** What type-ahead matches on. Omit it and the collection has no type-ahead. */
  label?: string
}

/** How far a page key moves. Rows, not pixels, so it means the same thing on both hosts. */
export const PAGE = 10

/** The intents a collection answers. Anything else it returns false for and lets bubble. */
export const COLLECTION_INTENTS: readonly Intent[] = [
  'next', 'prev', 'first', 'last', 'pageNext', 'pagePrev', 'expand', 'collapse', 'activate', 'menu',
]

export type CollectionIntentOptions = {
  /** Stable across a rebuild of the data, because it keys the stored state. */
  id: () => string
  items: () => readonly CollectionItem[]
  /** Horizontal collections read the left and right arrows as previous and next. */
  orientation?: 'vertical' | 'horizontal'
  /** Moving picks, the way a tab strip does. Otherwise `activate` picks. */
  selectOnMove?: boolean
  /** Supplying `selected` hands the host's copy back to the caller. */
  selected?: () => string | null | undefined
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  /** Left and right on a row of this collection. Returning `false` says the row did not fold — a
   *  leaf, or a directory that was already in the state asked for — and lets the key bubble to the
   *  tier below, which on the terminal moves one column. Returning nothing keeps the old behaviour,
   *  where the collection claimed the key either way, so no caller changes until it opts in
   *  (docs/command-palette-and-shortcuts.md § Focus and typing). */
  onExpand?: (key: string, expand: boolean) => boolean | void
  onMenu?: (key: string) => void
  /** Put the host's focus on this item. The host's whole share of a move. */
  land: (key: string) => void
  /** Whether the item itself holds focus. `activate` and `menu` only fire when it does, because a
   *  button inside a row is inside the collection too and Enter there belongs to the button. */
  onItem: (key: string) => boolean
}

export type CollectionIntents = {
  active: () => string | null
  selected: () => string | null
  /** Every item that is not disabled, in order. */
  enabled: () => readonly CollectionItem[]
  /** Make an item the roving stop and land focus on it. The one move both hosts share. */
  goTo: (key: string) => boolean
  move: (delta: number, absolute?: 'first' | 'last') => boolean
  handle: (intent: Intent) => boolean
}

export function createCollectionIntents(options: CollectionIntentOptions): CollectionIntents {
  const horizontal = () => options.orientation === 'horizontal'
  const enabled = () => options.items().filter((item) => !item.disabled)
  const has = (key: string | null | undefined) => !!key && enabled().some((item) => item.key === key)

  const selected = (): string | null =>
    options.selected ? options.selected() ?? null : collectionState(options.id()).selected

  // The stored place, then whatever is picked, then the top. Falling back to the selection is what
  // makes the first arrow press mean "the next one" rather than "the second one", which is what a
  // native select does and what a tab strip has to do to keep its one tab stop on the open tab.
  const active = (): string | null => {
    const stored = collectionState(options.id()).active
    if (has(stored)) return stored
    const picked = selected()
    return has(picked) ? picked : enabled()[0]?.key ?? null
  }

  const pick = (key: string) => {
    if (!options.selected) setSelectedItem(options.id(), key)
    options.onSelect?.(key)
  }

  const goTo = (key: string): boolean => {
    setActiveItem(options.id(), key)
    options.land(key)
    if (options.selectOnMove) pick(key)
    return true
  }

  const move = (delta: number, absolute?: 'first' | 'last'): boolean => {
    const list = enabled()
    if (!list.length) return false
    if (absolute) return goTo(absolute === 'first' ? list[0].key : list[list.length - 1].key)
    const at = list.findIndex((item) => item.key === active())
    // Wraps, because a list you cannot fall off the end of is a list you never have to look at.
    return goTo(list[(((at < 0 ? 0 : at) + delta) + list.length) % list.length].key)
  }

  /** A page key: as far as `PAGE` allows without leaving the list, and `false` once it is there.
   *
   *  Clamped rather than wrapped, unlike the arrows above. Modulo a list shorter than a page is a
   *  key that lies: PageDown in a three-row list moved one row, and in a ten-row list it moved
   *  nowhere at all, which a reader cannot tell from a dead key. Returning `false` at the edge is
   *  the other half of it. The key then carries on to the tier below, where a scrolling viewport
   *  moves the page the reader asked for, which is the sentence the footer promises: arrows move,
   *  page keys scroll (docs/tui.md § Scrolling viewports).
   *
   *  This is shared, so the desktop gets it too. PageDown on the last row of a desktop list now
   *  stops instead of wrapping round to the first, and that is intended: a page key is how a reader
   *  travels, and travelling past the end back to the start is how a reader loses their place. */
  const page = (delta: number): boolean => {
    const list = enabled()
    if (!list.length) return false
    const at = list.findIndex((item) => item.key === active())
    const to = Math.min(Math.max((at < 0 ? 0 : at) + delta, 0), list.length - 1)
    if (to === at) return false
    return goTo(list[to].key)
  }

  const handle = (intent: Intent): boolean => {
    const current = active()
    switch (intent) {
      case 'next': return move(1)
      case 'prev': return move(-1)
      case 'first': return move(0, 'first')
      case 'last': return move(0, 'last')
      case 'pageNext': return page(PAGE)
      case 'pagePrev': return page(-PAGE)
      // `?? true` and not a bare `return true`: a handler that says nothing is a handler that has not
      // been asked this question yet, and every DOM tree in the app is one of those. A handler that
      // says `false` gets its key back, which is how Right on a leaf reaches the tier that crosses a
      // column instead of being swallowed by a fold that did not happen
      // (docs/tui.md § The five key groups).
      case 'expand':
        if (horizontal()) return move(1)
        if (!current || !options.onExpand) return false
        return options.onExpand(current, true) ?? true
      case 'collapse':
        if (horizontal()) return move(-1)
        if (!current || !options.onExpand) return false
        return options.onExpand(current, false) ?? true
      case 'activate':
        if (!current || !options.onItem(current)) return false
        pick(current)
        options.onActivate?.(current)
        return true
      case 'menu':
        if (!current || !options.onItem(current) || !options.onMenu) return false
        options.onMenu(current)
        return true
      default: return false
    }
  }

  return { active, selected, enabled, goTo, move, handle }
}

/**
 * Type-ahead over a collection's labels: the next item after the current one whose label starts with
 * what has been typed, wrapping.
 *
 * Not an intent and never will be — every printable character is a candidate and no keymap can
 * enumerate that — so it is a function each host calls from its own raw key path.
 */
export function createTypeAhead(
  collection: Pick<CollectionIntents, 'active' | 'enabled' | 'goTo'>,
  resetMs = 700,
): (character: string) => boolean {
  let typed = ''
  let typedAt = 0
  return (character: string): boolean => {
    const now = Date.now()
    typed = now - typedAt > resetMs ? character : typed + character
    typedAt = now
    const list = collection.enabled().filter((item) => item.label)
    if (!list.length) return false
    const at = list.findIndex((item) => item.key === collection.active())
    const rotated = [...list.slice(at + 1), ...list.slice(0, at + 1)]
    const match = rotated.find((item) => item.label!.toLowerCase().startsWith(typed.toLowerCase()))
    return match ? collection.goTo(match.key) : false
  }
}
