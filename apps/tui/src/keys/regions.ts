// Focus regions without a DOM.
//
// `client-core/host/keys/focusRegions.ts` keeps the same contract and is DOM all the way down: it
// orders regions by `compareDocumentPosition`, finds a region's first stop with `querySelector`,
// focuses with `element.focus()`, and listens for `focusin` and `pointerdown`. None of that exists
// here (docs/future/terminal/05-keys-and-focus.md § Focus regions).
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
import type { Renderable } from '@opentui/core'

export type RegionRef = { paneId: string; regionId: string }

type Group = RegionRef & {
  box: Renderable
  /** Where this region drew in its layout, so the cycle walks the screen rather than mount order. */
  order: number
  /** What focus was last on inside this group, so re-entering restores rather than resets. */
  last?: Renderable
}

const groups: Group[] = []
let focused: RegionRef | null = null
// Whether the focused region is only holding the keys because it had nothing better when it opened.
//
// A region's contents are `lazy`, so when a pane opens there is often nothing in it yet and the
// region's own box is the only stop there is. That is the right answer for a region that never grows
// one, and the wrong one the moment a list arrives — so it is remembered rather than settled, and a
// collection mounting into that region takes the keys off it (`claimIfProvisional`).
let provisional = false
// What has the keys, as a signal, because it is what a row draws its caret from: in a terminal the
// caret is not decoration, it is where focus is. The renderer owns focus and has no signal for it, so
// this is written here, at the one place that moves it.
const [focusedNode, setFocusedNode] = createSignal<Renderable | null>(null)

/** The renderable that has the keys. */
export const focusedRenderable = focusedNode

/** Which region has focus, or null before anything in a layout has been focused. */
export const focusedRegion = (): RegionRef | null => focused

/** Every region on screen, in the order it draws. A layout hands its own order in and the chrome
 *  takes numbers outside the range a layout uses, so the sort reads down the screen: rail, pane
 *  strip, the pane's own regions (../chrome/Shell.tsx). */
const ordered = (): Group[] => [...groups].sort((a, b) => a.order - b.order)

export function registerRegion(box: Renderable, ref: RegionRef, order: number): () => void {
  const group: Group = { ...ref, box, order }
  groups.push(group)
  return () => {
    const at = groups.indexOf(group)
    if (at >= 0) groups.splice(at, 1)
  }
}

/** The helper a layout calls in setup, where the DOM layout uses the `use:regionFocus` directive.
 *  There is no directive mechanism outside the DOM renderer, so this is a function and the layout
 *  calls it from the region box's `ref`. */
export const regionFocus = (ref: RegionRef, order: number) => (box: Renderable) => {
  onCleanup(registerRegion(box, ref, order))
  // Something has to have the keys when a pane opens, and on this host nothing else will decide: the
  // desktop lands focus with a click or a Tab and there is neither here. The first region to register
  // takes it, once its own children exist, which is a microtask later.
  queueMicrotask(() => {
    if (focused) return
    const group = groups.find((candidate) => candidate.box === box)
    if (group) enter(group)
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
  focused = { paneId: group.paneId, regionId: group.regionId }
}

// Which renderables are a collection's rows. A region opens on its list where it has one, and this is
// how a region tells a row from a field without asking the kit what node drew it.
const items = new WeakSet<Renderable>()

/** Called by a collection for each row it draws (./collection.ts). */
export const markItem = (box: Renderable): void => { items.add(box) }

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
  return walk(box, (child) => items.has(child))
    ?? walk(box, (child) => child.focusable)
}

const enter = (group: Group | undefined): boolean => {
  if (!group) return false
  // The region's own box is the last resort, as it is on the DOM: a region with nothing focusable in
  // it still has to be reachable, or the cycle has a hole and the layout's own chords — the group
  // switch, the split — have nothing to be focus-within of.
  const target = (group.last && !group.last.isDestroyed ? group.last : undefined)
    ?? firstStop(group.box)
    ?? group.box
  if (target === group.box) group.box.focusable = true
  target.focus()
  setFocusedNode(target)
  provisional = target === group.box
  group.last = target
  focused = { paneId: group.paneId, regionId: group.regionId }
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
  })
  onCleanup(() => {
    focused = previousRegion
    if (!previous || previous.isDestroyed) return
    previous.focus()
    setFocusedNode(previous)
  })
}

/** Offer the keys to something that has just mounted. Taken when nobody has them, or when the region
 *  that has them is only holding them for want of anything better. */
export function claimIfProvisional(node: Renderable | undefined): boolean {
  if (!node) return false
  if (focused) {
    if (!provisional) return false
    const group = regionOf(node)
    if (!group || group.paneId !== focused.paneId || group.regionId !== focused.regionId) return false
  }
  node.focus()
  noteFocus(node)
  return true
}

/**
 * Move to the next or previous region on screen. Wraps.
 *
 * Every region, not the focused pane's alone, and that is this host's own answer: a terminal draws
 * one pane, so the rail, the pane strip, the pane's own regions and the footer are one screen and one
 * cycle (docs/future/terminal/07-chrome.md § Navigation). The desktop scopes the cycle to a pane
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
  return enter(all[(((at < 0 ? 0 : at) + delta) + all.length) % all.length])
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
  focused = null
  provisional = false
  cycler = null
  setFocusedNode(null)
}
