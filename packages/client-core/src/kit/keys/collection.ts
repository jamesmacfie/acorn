// One collection on the DOM: keyboard-operable, ARIA-correct, with its place held outside its rows.
//
// Every roving-focus list in the kit is this: `Rows`, `TreeRow` runs, `Tabs`, `Menu`, `ChipRow`,
// `SegmentedControl`, `Timeline`, `Grid`. They differ in what they draw and in nothing else, which is
// why the arrows, Home, End, page keys, type-ahead and `aria-activedescendant` are written once
// rather than eight times (docs/command-palette-and-shortcuts.md § Focus and typing).
//
// The rules about the *list* — what wraps, where the first press lands, which of select and activate
// picks — moved to `collectionIntents.ts` in terminal phase 2, so the terminal host keeps them
// exactly rather than nearly. What is left here is the DOM's share: `focus()`, `scrollIntoView`, the
// `aria-*` attributes and the roving `tabindex`.
//
// A collection is one tab stop with roving focus inside, the React Aria and Kobalte shape. `active`
// and `selected` live in `collectionState.ts` keyed by the item's own key, so a list rebuilt from a
// fresh response keeps its place and its selection.
//
// The node handles intents and never reads a key. Anything it does not handle returns false and
// bubbles to its ancestors and then to the region.

import { onCleanup, type JSX } from 'solid-js'
import { setActiveItem } from './collectionState'
import {
  COLLECTION_INTENTS, createCollectionIntents, createTypeAhead, PAGE, type CollectionItem,
} from './collectionIntents'
import type { Intent } from './intents'
import { bindIntents } from './keymapHost'

export type { CollectionItem }

export type CollectionOptions = {
  /** Stable across a rebuild of the data, because it keys the stored state. */
  id: () => string
  items: () => readonly CollectionItem[]
  /** The DOM id of one item, where a node already publishes ids of its own that other attributes
   *  point at. `Tabs` panels are named after their tab, so the tab keeps its name. */
  itemId?: (key: string) => string
  /** The container's ARIA role, and the item role that follows from it. */
  role?: 'listbox' | 'tree' | 'menu' | 'tablist' | 'radiogroup' | 'group'
  itemRole?: AriaRole
  /** Horizontal collections read the left and right arrows as previous and next. */
  orientation?: 'vertical' | 'horizontal'
  /** Moving picks, the way a tab strip does. Otherwise `activate` picks. */
  selectOnMove?: boolean
  /** All of it, per node: supplying `selected` hands the host's copy back to the caller. */
  selected?: () => string | null | undefined
  onSelect?: (key: string) => void
  onActivate?: (key: string) => void
  onExpand?: (key: string, expand: boolean) => void
  onMenu?: (key: string) => void
  /** Put an off-screen item on screen. A virtualised collection draws only the rows in view, so most
   *  of its items have no element to focus until the scroller has been asked to reach them. */
  scrollToKey?: (key: string) => void
}

// Every collection on screen, by its stable id, so something outside one can put an item in view.
//
// A pane that is told "show this item" — context, from notes' "show in context" — has a key and a
// collection id and nothing else. It cannot reach the row: the kit gives it no class and no id to
// select on, which is the point. So the collection publishes the one operation, and scroll stays the
// host's, as `collectionState` already made selection the host's.
const live = new Map<string, (key: string) => void>()

/** Put an item of a named collection in view and make it the roving stop. A no-op for a collection
 *  that is not mounted, or a key it does not hold: both are the ordinary answer when a person asks
 *  for something that has since gone. */
export function revealCollectionItem(id: string, key: string): void {
  live.get(id)?.(key)
}

/** The DOM's own role vocabulary, so a node cannot invent one. */
type AriaRole = NonNullable<JSX.HTMLAttributes<HTMLElement>['role']>

const ITEM_ROLES: Record<string, AriaRole> = {
  listbox: 'option',
  tree: 'treeitem',
  menu: 'menuitem',
  tablist: 'tab',
  radiogroup: 'radio',
}

/** What one item of a collection is handed. Opaque to the caller: it is spread onto the item's own
 *  element and never inspected, which is how a node stays free of `class` and DOM attributes. */
export type ItemProps = {
  readonly id: string
  readonly role?: AriaRole
  readonly tabindex: number
  readonly ref: (element: HTMLElement) => void
  readonly onFocus: () => void
}

export type Collection = {
  active: () => string | null
  selected: () => string | null
  containerProps: Record<string, unknown>
  itemProps: (key: string) => ItemProps
  /** Move roving focus onto an item, for a pointer landing on one. */
  focus: (key: string) => void
  /** Move roving focus onto an item and put it in view. See `revealCollectionItem`. */
  reveal: (key: string) => void
}

export function createCollection(options: CollectionOptions): Collection {
  const elements = new Map<string, HTMLElement>()

  const keys = createCollectionIntents({
    ...options,
    // The DOM's whole share of a move: focus the row, or scroll a virtualised one into existence and
    // focus it on the next frame, by which time it exists.
    land: (key) => {
      const element = elements.get(key)
      if (element) element.focus()
      else if (options.scrollToKey) {
        options.scrollToKey(key)
        requestAnimationFrame(() => elements.get(key)?.focus())
      }
    },
    onItem: (key) => elements.get(key) === document.activeElement,
  })
  const active = keys.active

  // By position, not by the key itself: a key is a branch name or a file path, and a DOM id may not
  // hold half of what those contain.
  const index = (key: string) => options.items().findIndex((item) => item.key === key)
  const itemId = (key: string) => options.itemId?.(key) ?? `${options.id()}-item-${index(key)}`

  // Type-ahead is typing, not a chord, so it stays a keydown on the container rather than a binding:
  // every printable character is a candidate and no keymap can enumerate that.
  const typeAhead = createTypeAhead(keys)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return
    if (typeAhead(event.key)) event.preventDefault()
  }

  const reveal = (key: string) => {
    if (!keys.enabled().some((item) => item.key === key)) return
    setActiveItem(options.id(), key)
    const element = elements.get(key)
    if (element) element.scrollIntoView({ block: 'nearest' })
    else options.scrollToKey?.(key)
  }
  // Registered for the life of the node, and taken back out with it: a stale entry would scroll a
  // collection that is no longer on screen.
  live.set(options.id(), reveal)
  onCleanup(() => { if (live.get(options.id()) === reveal) live.delete(options.id()) })

  return {
    active,
    selected: keys.selected,
    focus: (key) => { setActiveItem(options.id(), key) },
    reveal,
    containerProps: {
      ref: (element: HTMLElement) => bindIntents(element, COLLECTION_INTENTS, keys.handle),
      role: options.role,
      'aria-orientation': options.role === 'tablist' && options.orientation !== 'horizontal' ? 'vertical' : undefined,
      get 'aria-activedescendant'() { return active() ? itemId(active()!) : undefined },
      onKeyDown,
    },
    itemProps: (key: string) => ({
      get id() { return itemId(key) },
      role: options.itemRole ?? (options.role ? ITEM_ROLES[options.role] : undefined),
      // Roving: one item in the collection is tab-reachable and the arrows move within it. A getter,
      // because a spread object is read once and this changes on every move.
      get tabindex() { return active() === key ? 0 : -1 },
      ref: (element: HTMLElement) => {
        elements.set(key, element)
        onCleanup(() => { if (elements.get(key) === element) elements.delete(key) })
      },
      onFocus: () => setActiveItem(options.id(), key),
    }),
  }
}

/**
 * The same behaviour for a container whose items are children rather than data.
 *
 * `Menu`, `Select`'s list, `ChipRow` and `Timeline` take opaque JSX from the caller, so the host
 * cannot key their items; what it can do is read the focusable elements out of the DOM at the moment
 * a key arrives, which is also the only reading that is correct while items are still arriving. There
 * is no stored place, and there should not be: all four are transient or unselected.
 *
 * The keys are the same intents. That is the part that matters, and it is why this is here rather
 * than four private key handlers.
 */
export function createDomCollection(options: {
  /** Which descendants are the items. Disabled ones are filtered out. */
  selector: string
  orientation?: 'vertical' | 'horizontal'
  /** Focus the first item once, the way an opened menu does. */
  focusOnMount?: boolean
}): { containerProps: Record<string, unknown>; attach: (element: HTMLElement) => void } {
  let container: HTMLElement | undefined
  const items = (): HTMLElement[] =>
    [...container?.querySelectorAll<HTMLElement>(options.selector) ?? []].filter((item) => !item.hasAttribute('disabled'))

  const move = (delta: number, absolute?: 'first' | 'last'): boolean => {
    const list = items()
    if (!list.length) return false
    if (absolute) {
      ;(absolute === 'first' ? list[0] : list[list.length - 1]).focus()
      return true
    }
    const at = list.indexOf(container?.ownerDocument.activeElement as HTMLElement)
    list[(((at < 0 ? 0 : at) + delta) + list.length) % list.length].focus()
    return true
  }

  const horizontal = options.orientation === 'horizontal'
  const handle = (intent: Intent): boolean => {
    switch (intent) {
      case 'next': return move(1)
      case 'prev': return move(-1)
      case 'first': return move(0, 'first')
      case 'last': return move(0, 'last')
      case 'pageNext': return move(PAGE)
      case 'pagePrev': return move(-PAGE)
      case 'expand': return horizontal ? move(1) : false
      case 'collapse': return horizontal ? move(-1) : false
      default: return false
    }
  }

  const DOM_INTENTS: readonly Intent[] = ['next', 'prev', 'first', 'last', 'pageNext', 'pagePrev', 'expand', 'collapse']

  // `attach` as well as `containerProps`, because two call sites already own their container's `ref`
  // for a popover measurement and cannot give it up.
  const attach = (element: HTMLElement) => {
    container = element
    bindIntents(element, DOM_INTENTS, handle)
    // A microtask, because the items are mounted by the same render that gave us the container.
    if (options.focusOnMount) queueMicrotask(() => move(0, 'first'))
  }

  return { attach, containerProps: { ref: attach } }
}
