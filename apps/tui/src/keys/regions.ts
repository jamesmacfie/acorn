// Focus regions without a DOM.
//
// `client-core/host/keys/focusRegions.ts` keeps the same contract and is DOM all the way down: it
// orders regions by `compareDocumentPosition`, finds a region's first stop with `querySelector`,
// focuses with `element.focus()`, and listens for `focusin` and `pointerdown`. None of that exists
// here (docs/tui.md § Focus regions).
//
// What replaces each:
//
//   order       the layout registers its regions in the order it draws them, from its own knowledge
//               (LAYOUT_REGIONS in @acorn/protocol/paneLayouts.ts). Nothing is derived from position.
//   first stop  the first renderable in the region's subtree that OpenTUI will focus. The kit marks
//               those as it draws them — `focusRoles.ts` says which nodes are a stop, an item, a
//               collection or a trap — and the renderer's own `focusable` flag is what that becomes.
//   focus       the renderer's. There is one focused renderable at a time and it owns which.
//   pointer     absent. Mouse in a terminal, if it ever comes, clicks to focus and does nothing else.
//
// The pane and region chords live on the same layer 5 the desktop uses, so priority decides here too.

import { createSignal, onCleanup } from 'solid-js'
import { ScrollBoxRenderable, type Renderable } from '@opentui/core'

export type RegionRef = { paneId: string; regionId: string }
export type RegionColumn = 'rail' | 'main'

type RegionOptions = {
  /** The column spatial left/right navigation treats this region as belonging to. */
  column?: RegionColumn
  /** Activating a row in this region also hands the keys to the main column. Rail lists opt in. */
  enterMainOnActivate?: boolean
  /** This region takes the initial focus after every region has mounted. */
  opensHere?: boolean
  /** Landing on one of this region's rows also selects it. Browse is the sole caller. */
  pickOnEnter?: boolean
}

type Group = RegionRef & {
  box: Renderable
  column: RegionColumn
  enterMainOnActivate: boolean
  opensHere: boolean
  pickOnEnter: boolean
  /** Where this region drew in its layout, so the cycle walks the screen rather than mount order. */
  order: number
  /** What focus was last on inside this group, so re-entering restores rather than resets. */
  last?: Renderable
  /** Stable collection identity for `last`, because queries may replace its renderable. */
  lastIdentity?: string
}

const groups: Group[] = []
const lastByColumn: Partial<Record<RegionColumn, Group>> = {}
let focused: RegionRef | null = null
// Whether the focused region is only holding the keys because it had nothing better when it opened.
//
// A region's contents are `lazy`, so when a pane opens there is often nothing in it yet and the
// region's own box is the only stop there is. That is the right answer for a region that never grows
// one, and the wrong one the moment a list arrives — so it is remembered rather than settled, and a
// collection mounting into that region takes the keys off it (`claimIfProvisional`).
let provisional = false
// Whether the region that asked to be opened on has had its turn. A screen opens on the first region
// to register, which is the first one drawn, and that is the right default everywhere except the
// shell: the left column draws Menu, Browse and Tasks in that order, and a reader arriving on Menu
// would find `j` swapping the whole screen before they had chosen anything. One region per screen
// says `opensHere` and takes the keys off whichever got them first (../chrome/Rail.tsx).
let opened = false
// What has the keys, as a signal, because it is what a row draws its caret from: in a terminal the
// caret is not decoration, it is where focus is. The renderer owns focus and has no signal for it, so
// this is written here, at the one place that moves it.
const [focusedNode, setFocusedNode] = createSignal<Renderable | null>(null)

// Tabs are not a region of their own. They are the entry stop inside a detail region: Down moves
// into the selected panel, Escape from that panel comes back here, and a second Escape crosses the
// region/column edge. Kept as renderable identity rather than a kit-node name so remote and compiled
// trees use the same host bookkeeping.
let tabStops = new WeakSet<Renderable>()
// Only structural tabs are the parent of a region's content. A list may contain its own filter tabs
// (GitHub's Open/Closed pull filter); those remain focusable controls, but entering the Browse region
// must still land on its row collection so Up/Down owns the list.
let entryTabStops = new WeakSet<Renderable>()

/** The renderable that has the keys. */
export const focusedRenderable = focusedNode

/**
 * Whether the keys are inside this box.
 *
 * The question a frame asks to draw itself as the active one. OpenTUI answers a version of it for
 * free — `focusedBorderColor` fires when a box is focused or holds the focus — but only for a box
 * that is itself `focusable`, and marking every frame focusable would put a stop in the cycle for
 * every frame: `firstStop` walks children for anything focusable, so a region containing another
 * frame would open on the frame instead of on the list inside it. Reading the signal and walking up
 * costs a few parent hops and adds nothing to the cycle.
 */
export const focusWithin = (box: Renderable | undefined): boolean => {
  const node = focusedNode()
  if (!box || !node) return false
  for (let at: Renderable | null = node; at; at = at.parent) if (at === box) return true
  return false
}

/** Which region has focus, or null before anything in a layout has been focused. */
export const focusedRegion = (): RegionRef | null => focused

/** Mark the host renderable that represents one `Tabs` collection. */
export function markTabStop(node: Renderable, entry = false): void {
  node.focusable = true
  tabStops.add(node)
  if (entry) entryTabStops.add(node)
}

/** Every region on screen, in the order it draws. A layout hands its own order in and the chrome
 *  takes numbers outside the range a layout uses, so the sort reads down the screen: rail, pane
 *  strip, the pane's own regions (../chrome/Shell.tsx). */
const ordered = (): Group[] => [...groups].sort((a, b) => a.order - b.order)

export function registerRegion(box: Renderable, ref: RegionRef, order: number, options: RegionOptions = {}): () => void {
  const group: Group = {
    ...ref,
    box,
    order,
    column: options.column ?? 'main',
    enterMainOnActivate: options.enterMainOnActivate ?? false,
    opensHere: options.opensHere ?? false,
    pickOnEnter: options.pickOnEnter ?? false,
  }
  groups.push(group)
  return () => {
    const at = groups.indexOf(group)
    if (at >= 0) groups.splice(at, 1)
    if (lastByColumn[group.column] === group) delete lastByColumn[group.column]
  }
}

/** The helper a layout calls in setup, where the DOM layout uses the `use:regionFocus` directive.
 *  There is no directive mechanism outside the DOM renderer, so this is a function and the layout
 *  calls it from the region box's `ref`. */
export const regionFocus = (ref: RegionRef, order: number, options: RegionOptions = {}) => (box: Renderable) => {
  onCleanup(registerRegion(box, ref, order, options))
  // Something has to have the keys when a pane opens, and on this host nothing else will decide: the
  // desktop lands focus with a click or a Tab and there is neither here. The first region to register
  // takes it, once its own children exist, which is a microtask later — unless a region has said the
  // screen opens on it, in which case it takes them back. Both happen in the same microtask batch at
  // boot, so there is no window where a reader could be typing into the one that loses.
  queueMicrotask(() => {
    const group = groups.find((candidate) => candidate.box === box)
    if (!group) return
    // Every region is registered before this microtask batch runs. If one later in reading order is
    // the declared opening region, an earlier region must not briefly enter and run `pickOnEnter`:
    // Menu doing that switched an explicitly opened task back to GitHub before Tasks took focus.
    if (!group.opensHere && !opened && groups.some((candidate) => candidate.opensHere)) return
    if (focused && !(options.opensHere && !opened)) return
    if (options.opensHere) opened = true
    enter(group)
  })
}

/** Which region a renderable is inside, by walking up the retained tree. The DOM half asks the same
 *  question with `focusin` bubbling; here the tree is the bubble. */
const regionOf = (node: Renderable): Group | undefined => {
  for (let at: Renderable | null = node; at; at = at.parent) {
    const group = groups.find((candidate) => candidate.box === at)
    if (group) return group
  }
  return undefined
}

/** Called when focus lands on something. Idempotent, and a no-op for a node in no region, which is
 *  a run of text or a strip nothing focuses. The chrome registers its own (../chrome/Shell.tsx). */
export function noteFocus(node: Renderable): void {
  setFocusedNode(node)
  provisional = false
  const group = regionOf(node)
  if (!group) return
  group.last = node
  group.lastIdentity = itemIdentities.get(node)
  lastByColumn[group.column] = group
  focused = { paneId: group.paneId, regionId: group.regionId }
  revealInViewports(node)
}

/** Put focus on a known renderable through the region store, including scroll reveal. */
export function focusRenderable(node: Renderable | undefined): boolean {
  if (!node || node.isDestroyed || !node.visible) return false
  node.focus()
  noteFocus(node)
  return true
}

/** Replace a remounted stop without losing the region's remembered logical item.
 *
 * Collections identify rows by key, while Solid's `<For>` identifies their data objects by
 * reference. A query refresh can therefore replace the renderable for the same key. Any region that
 * remembers the old box must advance with the collection map; if it currently owns focus, focus
 * advances too. Otherwise the next region entry lands on a detached row whose key layer is gone. */
export function replaceFocusable(previous: Renderable | undefined, next: Renderable): void {
  if (!previous || previous === next) return
  for (const group of groups) if (group.last === previous) group.last = next
  if (focusedNode() === previous) focusRenderable(next)
}

// Which renderables are a collection's rows. A region opens on its list where it has one, and this is
// how a region tells a row from a field without asking the kit what node drew it.
let items = new WeakSet<Renderable>()
const itemPicks = new WeakMap<Renderable, () => void>()
let itemIdentities = new WeakMap<Renderable, string>()
const itemsByIdentity = new Map<string, Renderable>()

/** Whether the keys are on a row of a collection rather than on a control. The footer asks, because
 *  `activate` opens a row and presses a control (../chrome/bindings.ts). */
export const focusedItem = (): boolean => {
  const node = focusedNode()
  return !!node && items.has(node)
}

/** Called by a collection for each row it draws (./collection.ts). */
export const markItem = (box: Renderable, pick?: () => void, identity?: string): void => {
  items.add(box)
  if (pick) itemPicks.set(box, pick)
  if (!identity) return
  itemIdentities.set(box, identity)
  itemsByIdentity.set(identity, box)
  onCleanup(() => {
    if (itemsByIdentity.get(identity) === box) itemsByIdentity.delete(identity)
    // An overlay may restore a row in the same update that replaces its whole collection. At that
    // instant the old row can still be live, then be destroyed after the overlay cleanup has run.
    // Re-enter after reconciliation so the region resolves its new logical row (or its new first
    // row) instead of retaining a focused, detached renderable with no key layer or visible caret.
    const group = groups.find((candidate) => candidate.last === box) ?? regionOf(box)
    if (focusedNode() !== box || !group) return
    provisional = true
    queueMicrotask(() => {
      if (focusedNode() === box && box.isDestroyed && groups.includes(group)) enter(group)
    })
  })
}

const walk = (box: Renderable, take: (child: Renderable) => boolean): Renderable | undefined => {
  for (const child of box.getChildren()) {
    if (child.visible && take(child)) return child
    const nested = child.visible ? walk(child, take) : undefined
    if (nested) return nested
  }
  return undefined
}

/**
 * The first thing inside a region a keyboard can reach. Depth-first over the renderable tree, which
 * is retained and ordered, so this is the same reading `querySelector` gives on the DOM.
 *
 * With one departure, and it is a terminal's: a region opens on its list rather than on the first
 * field above it. The DOM does not need the rule, because a reader arrives at a pane with a pointer
 * and clicks what they meant; here the first thing focused is the thing the bare keys drive, and
 * landing in a filter box means `j` types a `j`. A region with no rows falls back to the first stop,
 * which is the DOM's answer unchanged.
 */
export function firstStop(box: Renderable): Renderable | undefined {
  return walk(box, (child) => entryTabStops.has(child))
    ?? walk(box, (child) => items.has(child))
    ?? walk(box, (child) => tabStops.has(child))
    // A native scrollbox is focusable so a control-free document can own the arrow keys. It is a
    // transparent viewport when it contains a real stop, though: descending through it here keeps a
    // terminal rectangle, composer or field reachable instead of landing on the scrollbar around
    // it. `stopsIn` owns that exact fallback rule for Down/Escape as well.
    ?? stopsIn(box)[0]
}

/** Reveal a newly focused stop in every native document viewport that contains it. */
const revealInViewports = (node: Renderable): void => {
  for (let at: Renderable | null = node.parent; at; at = at.parent) {
    if (at instanceof ScrollBoxRenderable) at.scrollChildIntoView(node.id)
  }
}

/**
 * Reading-order stops inside a box, in reading order.
 *
 * Exported for one caller outside this module: a `Menu`'s open list moves between its own stops while
 * the trap holds the keys, and the stops behind the overlay are not its to walk (./stops.ts).
 *
 * A scroll viewport is the fallback stop for a document with no controls. Where it does contain a
 * control or collection row, the child is the stop and the viewport stays transparent to Down.
 * Likewise a tab collection is one stop; controls drawn in its trailing slot do not sit between the
 * strip and the selected panel.
 */
export const stopsIn = (box: Renderable): Renderable[] => {
  const found: Renderable[] = []
  const visit = (parent: Renderable): number => {
    const before = found.length
    for (const child of parent.getChildren()) {
      if (!child.visible || child.isDestroyed) continue
      if (tabStops.has(child)) {
        found.push(child)
        continue
      }
      if (child instanceof ScrollBoxRenderable) {
        const nestedBefore = found.length
        visit(child)
        if (found.length === nestedBefore) found.push(child)
        continue
      }
      if (child.focusable) {
        found.push(child)
        continue
      }
      visit(child)
    }
    return found.length - before
  }
  visit(box)
  return found
}

/** Move from one stop to the adjacent stop in its current region, without wrapping. */
export function moveFocusFrom(node: Renderable, delta: 1 | -1): boolean {
  const group = regionOf(node)
  if (!group) return false
  const stops = stopsIn(group.box)
  const at = stops.indexOf(node)
  if (at < 0) return false
  return focusRenderable(stops[at + delta])
}

const enter = (group: Group | undefined): boolean => {
  if (!group) return false
  // The region's own box is the last resort, as it is on the DOM: a region with nothing focusable in
  // it still has to be reachable, or the cycle has a hole and the layout's own chords — the group
  // switch, the split — have nothing to be focus-within of.
  // A remembered target, unless what was remembered is the region's own box: that is the last resort
  // below, taken when the region had nothing in it yet, and remembering it pins the keys to the frame
  // for the rest of the run. A reader who looked into Browse before choosing a source came back to a
  // lit border, no caret and dead arrows, because the list that arrived in between was never asked
  // for (`claimIfProvisional` only fires while the region still holds the keys).
  const keyed = group.lastIdentity ? itemsByIdentity.get(group.lastIdentity) : undefined
  const remembered = group.lastIdentity
    ? keyed && !keyed.isDestroyed ? keyed : undefined
    : group.last && !group.last.isDestroyed && group.last !== group.box ? group.last : undefined
  const target = remembered ?? firstStop(group.box) ?? group.box
  if (target === group.box) group.box.focusable = true
  target.focus()
  setFocusedNode(target)
  provisional = target === group.box
  group.last = target
  group.lastIdentity = itemIdentities.get(target)
  lastByColumn[group.column] = group
  focused = { paneId: group.paneId, regionId: group.regionId }
  revealInViewports(target)
  if (group.pickOnEnter) itemPicks.get(target)?.()
  return true
}

/**
 * Hand the keys to an overlay that has just opened, and give them back when it closes.
 *
 * The DOM palette keeps a `prevFocus` element for exactly this and restores it on dismissal
 * (client-core/host/palette/overlay.ts). Same rule, no element: what had the keys is remembered and
 * put back, unless it went away while the overlay was open, in which case the region that owned it
 * keeps the claim and its own `last` decides.
 *
 * A microtask, because the overlay's children are mounted by the render that produced its box.
 */
export function takeFocus(box: Renderable): void {
  const previous = focusedNode()
  const previousRegion = focused
  queueMicrotask(() => {
    const target = firstStop(box) ?? box
    if (target === box) box.focusable = true
    target.focus()
    setFocusedNode(target)
    revealInViewports(target)
  })
  onCleanup(() => {
    // The action that closes an overlay can replace the surface behind it in the same Solid update.
    // Restore after that reconciliation, not during the overlay's cleanup: at cleanup time the old
    // row still reports itself live even though its disposal has already begun.
    queueMicrotask(() => {
      focused = previousRegion
      const previousIdentity = previous ? itemIdentities.get(previous) : undefined
      const itemWasReplaced = !!previousIdentity && itemsByIdentity.get(previousIdentity) !== previous
      if (!previous || previous.isDestroyed || itemWasReplaced) {
        // A workspace/source switch can replace the row that was focused behind an overlay. Restoring
        // the dead renderable is impossible, but restoring its region is not: walk the live tree again
        // so the replacement row receives focus and the region's pick-on-enter rule runs. Without this
        // the Menu frame stayed lit with no caret and its Up/Down layer had no live target.
        const group = groups.find((candidate) =>
          candidate.paneId === previousRegion?.paneId && candidate.regionId === previousRegion.regionId)
        if (group) enter(group)
        return
      }
      focusRenderable(previous)
    })
  })
}

/** Offer the keys to something that has just mounted. Taken when nobody has them, or when the region
 *  that has them is only holding them for want of anything better. */
export function claimIfProvisional(node: Renderable | undefined): boolean {
  if (!node) return false
  const group = regionOf(node)
  if (focused) {
    if (!provisional) return false
    if (!group || group.paneId !== focused.paneId || group.regionId !== focused.regionId) return false
  }
  node.focus()
  noteFocus(node)
  if (group?.pickOnEnter) itemPicks.get(node)?.()
  return true
}

/**
 * Move to the next or previous region on screen. Wraps.
 *
 * Every region, not the focused pane's alone, and that is this host's own answer: a terminal draws
 * one pane, so the rail, the pane strip, the pane's own regions and the footer are one screen and one
 * cycle (docs/tui.md § Navigation). The desktop scopes the cycle to a pane
 * because it draws several side by side and Tab into the next one would be a surprise; here there is
 * no next one to be surprised by, and the chord that switches which pane is drawn is `nextPane`.
 *
 * The chrome orders itself around the pane by declaring orders outside the range a layout uses
 * (../chrome/Shell.tsx), which is the same "the layout knows its own order" rule regions already
 * keep — one screen wide instead of one pane wide.
 */
export function moveRegion(delta: 1 | -1): boolean {
  const all = ordered()
  if (all.length < 2) return false
  const at = all.findIndex((group) => group.paneId === focused?.paneId && group.regionId === focused?.regionId)
  // A conditional region can disappear while it holds focus (the task strip when a source opens,
  // or Browse when a component-only source replaces a split source). Recover at the start of the
  // cycle instead of treating the missing group as an imaginary item before it.
  if (at < 0 && focused) return enter(all[0])
  return enter(all[(((at < 0 ? 0 : at) + delta) + all.length) % all.length])
}

/** Move between the rail and main columns without wrapping.
 *
 * The destination remembers the group last used in that column. On a first visit, main skips the
 * pane strip and enters the first real content region; rail enters its first panel. */
export function moveColumn(delta: 1 | -1): boolean {
  const current = groups.find((group) =>
    group.paneId === focused?.paneId && group.regionId === focused?.regionId)
  if (!current) return false
  if ((current.column === 'rail' && delta < 0) || (current.column === 'main' && delta > 0)) return false

  const destination: RegionColumn = current.column === 'rail' ? 'main' : 'rail'
  const remembered = lastByColumn[destination]
  if (remembered && groups.includes(remembered)) return enter(remembered)

  const all = ordered()
  return enter(destination === 'main'
    ? all.find((group) => group.column === 'main' && group.order >= 0)
    : all.find((group) => group.column === 'rail'))
}

/**
 * Climb one level out of main content.
 *
 * The nearest preceding tab collection is the parent of a focused tab panel. A source detail climbs
 * explicitly to Browse rather than whichever rail panel happened to be visited last; a task pane
 * with no Browse region climbs to the shell's pane strip. Calling this while already on the parent
 * takes the next edge, so Escape reads content -> tabs -> Browse rather than teleporting out.
 */
export function moveBack(): boolean {
  const current = groups.find((group) =>
    group.paneId === focused?.paneId && group.regionId === focused?.regionId)
  const node = focusedNode()
  if (!current || !node) return false

  const stops = stopsIn(current.box)
  const at = stops.indexOf(node)
  for (let index = at - 1; index >= 0; index -= 1) {
    if (entryTabStops.has(stops[index])) return focusRenderable(stops[index])
  }

  if (current.column === 'main') {
    const browse = groups.find((group) => group.paneId === 'chrome' && group.regionId === 'browse')
    if (browse) return enter(browse)
  }
  if (current.column === 'main' && current.paneId !== 'chrome') {
    const strip = groups.find((group) => group.paneId === 'chrome' && group.regionId === 'panes')
    if (strip) return enter(strip)
  }
  return moveColumn(-1)
}

/**
 * Whether the collection that currently owns the keys should enter main after activation.
 *
 * Read before the row runs: activation can replace the source or task pane and therefore rebuild
 * the destination regions. The collection performs the ordinary select/press first, then uses the
 * captured answer with `moveColumn(1)`, so Enter never substitutes for the row's own action.
 */
export function activationEntersMain(): boolean {
  const current = groups.find((group) =>
    group.paneId === focused?.paneId && group.regionId === focused?.regionId)
  return current?.enterMainOnActivate ?? false
}

// What the shell does when there is no second pane mounted to move to. A terminal shows one pane at
// a time, so "the next pane" is a switch rather than a walk, and the switch belongs to the chrome
// (../chrome/panes.ts). Installed rather than imported, because this module is the keys' and must not
// reach into the shell.
let cycler: ((delta: 1 | -1) => boolean) | null = null
export const setPaneCycler = (next: ((delta: 1 | -1) => boolean) | null): void => { cycler = next }

/** Move to the next or previous pane, landing on whatever it last had focused, or — where only one
 *  pane is mounted, which is this host's usual state — switch which pane that is. */
export function movePane(delta: 1 | -1): boolean {
  const current = groups.find((group) =>
    group.paneId === focused?.paneId && group.regionId === focused?.regionId)

  // The rail is spatially before the one pane this host draws. Honour that edge before asking the
  // shell to replace the pane on screen: Ctrl+Option+Right advertised "the pane to the right", but
  // from Menu/Browse/Tasks it used to call the task-pane cycler instead. A browse source has no
  // active task, so the chord did nothing at all. The reverse edge restores the rail group the
  // reader last used; once there is no column in the requested direction, the task-pane switcher
  // remains the next/previous-pane answer.
  if (current && moveColumn(delta)) return true
  if (current?.column === 'rail') return false

  const panes: string[] = []
  for (const group of ordered()) if (!panes.includes(group.paneId)) panes.push(group.paneId)
  if (panes.length < 2) return cycler?.(delta) ?? false
  const at = panes.indexOf(focused?.paneId ?? '')
  const paneId = panes[(((at < 0 ? 0 : at) + delta) + panes.length) % panes.length]
  return enter(ordered().find((group) => group.paneId === paneId))
}

/** Test seam. The list is module-level, so a suite must not inherit the previous one's regions. */
export function _resetRegions(): void {
  groups.length = 0
  delete lastByColumn.rail
  delete lastByColumn.main
  focused = null
  provisional = false
  opened = false
  cycler = null
  tabStops = new WeakSet<Renderable>()
  entryTabStops = new WeakSet<Renderable>()
  items = new WeakSet<Renderable>()
  itemIdentities = new WeakMap<Renderable, string>()
  itemsByIdentity.clear()
  setFocusedNode(null)
}
