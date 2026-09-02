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
// Five levels and nothing else: screen, column, region, parent stop, stop. A parent stop is a
// renderable that owns panels — a `Sections` strip owns the panel under it — so Down enters and
// Escape climbs. Everything the shell knows and this module must not, arrives through `setTopology`
// and `setPaneCycler`: no chrome id is spelled here.
//
// Every decision that needs a renderable the current render has not produced yet waits in one place,
// `settleFocus`, scheduled by `scheduleSettle`. That is the only `queueMicrotask` in this folder, and
// the reason is that six of them raced each other.
//
// The pane and region chords live on the same layer 5 the desktop uses, so priority decides here too.

import { createSignal, onCleanup } from 'solid-js'
import { ScrollBoxRenderable, type Renderable } from '@opentui/core'

export type RegionRef = { paneId: string; regionId: string }
export type RegionColumn = 'rail' | 'main'

/** What the shell knows about its own arrangement and this module deliberately does not. Installed
 *  once from ../chrome/Shell.tsx, the same way the pane cycler is. */
export type Topology = {
  /** Where Escape goes from the top of a region. Null means the column edge. */
  home: (region: RegionRef) => RegionRef | null
  /** The region that takes the keys when the screen first has regions. */
  opensOn: () => RegionRef | null
  /** Chrome a first crossing into a column passes over. The pane strip sits above the pane. */
  skips: (region: RegionRef) => boolean
}

type RegionOptions = {
  /** The column spatial left/right navigation treats this region as belonging to. */
  column?: RegionColumn
  /** Activating a row in this region also hands the keys to the main column. Rail lists opt in. */
  enterMainOnActivate?: boolean
  /** Landing on one of this region's rows also selects it. Browse is the sole caller. */
  pickOnEnter?: boolean
}

type Group = RegionRef & {
  box: Renderable
  column: RegionColumn
  enterMainOnActivate: boolean
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
// one, and the wrong one the moment a list arrives — so it is remembered rather than settled, and the
// settle pass takes the keys off it once the region has an entry stop.
let provisional = false
// What has the keys, as a signal, because it is what a row draws its caret from: in a terminal the
// caret is not decoration, it is where focus is. The renderer owns focus and has no signal for it, so
// this is written here, at the one place that moves it.
const [focusedNode, setFocusedNode] = createSignal<Renderable | null>(null)

/** The renderable that has the keys. */
export const focusedRenderable = focusedNode

/**
 * Whether the keys are inside this box.
 *
 * The question a frame asks to draw itself as the active one. OpenTUI answers a version of it for
 * free — `focusedBorderColor` fires when a box is focused or holds the focus — but only for a box
 * that is itself `focusable`, and marking every frame focusable would put a stop in the cycle for
 * every frame: entry walks children for anything focusable, so a region containing another frame
 * would open on the frame instead of on the list inside it. Reading the signal and walking up
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

const groupAt = (ref: RegionRef | null | undefined): Group | undefined =>
  ref ? groups.find((group) => group.paneId === ref.paneId && group.regionId === ref.regionId) : undefined

// ── The topology and the pane cycler ──────────────────────────────────────────────────────────

let topology: Topology | null = null
export const setTopology = (next: Topology | null): void => { topology = next }

// What the shell does when there is no second pane mounted to move to. A terminal shows one pane at
// a time, so "the next pane" is a switch rather than a walk, and the switch belongs to the chrome
// (../chrome/panes.ts).
let cycler: ((delta: 1 | -1) => boolean) | null = null
export const setPaneCycler = (next: ((delta: 1 | -1) => boolean) | null): void => { cycler = next }

// ── Parent stops ──────────────────────────────────────────────────────────────────────────────

// A parent stop is one stop from outside that owns panels: Down enters the panel it is showing and
// Escape from anything in that panel returns to it. Kept as renderable identity rather than a kit
// node name, so remote and compiled trees use the same host bookkeeping.
//
// The panels are a getter rather than a list, because a strip's panels mount after its own ref runs
// and change with its tabs. A strip with none — a list's Open/Closed filter — is an ordinary stop.
let parents: { node: Renderable; panels: () => Renderable[] }[] = []

const parentEntry = (node: Renderable) => parents.find((parent) => parent.node === node)

/** Mark a renderable as one stop that owns the panels `panels()` returns. */
export function markParent(node: Renderable, panels: () => Renderable[]): void {
  node.focusable = true
  const entry = { node, panels }
  parents.push(entry)
  onCleanup(() => {
    const at = parents.indexOf(entry)
    if (at >= 0) parents.splice(at, 1)
  })
}

/**
 * The nearest parent stop above a node.
 *
 * Walk up and, at each ancestor, ask whether some parent owns that ancestor as a panel. A strip is a
 * sibling of its panels rather than an ancestor, so walking up alone never reaches it; the panel box
 * is what the walk reaches and the panels list is the missing edge.
 */
export function parentOf(node: Renderable): Renderable | undefined {
  for (let at: Renderable | null = node; at; at = at.parent) {
    const owner = parents.find((parent) => parent.node !== at && parent.panels().includes(at as Renderable))
    if (owner) return owner.node
  }
  return undefined
}

/** Down from a parent stop: into the first stop of the panel it is showing. */
export function enterParent(parent: Renderable): boolean {
  const panel = parentEntry(parent)?.panels().find((box) => box.visible && !box.isDestroyed)
  if (!panel) return false
  return focusRenderable(entryStop(panel) ?? panel)
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
 *  calls it from the region box's `ref`. Who opens the screen is the settle pass's answer, not this
 *  one's: every region of a boot registers before the first settle runs. */
export const regionFocus = (ref: RegionRef, order: number, options: RegionOptions = {}) => (box: Renderable) => {
  onCleanup(registerRegion(box, ref, order, options))
  scheduleSettle()
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

// ── Collections ───────────────────────────────────────────────────────────────────────────────

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

/** Called by a collection for each row it draws (./collection.ts).
 *
 *  Collections identify rows by key, while Solid's `<For>` identifies their data objects by
 *  reference, so a query refresh can replace the renderable for the same key. The identity registry
 *  is what makes the region's memory survive that: re-entry resolves the key, not the box. */
export const markItem = (box: Renderable, pick?: () => void, identity?: string): void => {
  items.add(box)
  if (pick) itemPicks.set(box, pick)
  if (!identity) return
  itemIdentities.set(box, identity)
  itemsByIdentity.set(identity, box)
  onCleanup(() => {
    if (itemsByIdentity.get(identity) === box) itemsByIdentity.delete(identity)
    // The row that had the keys is going. Mark the region as holding them for want of anything
    // better and let the settle pass re-enter it once reconciliation has produced the replacement:
    // at cleanup time the old row still reports itself live even though its disposal has begun.
    if (focusedNode() !== box) return
    // Only a region can hold the keys for want of anything better; a row inside an overlay has no
    // region behind it, and the settle still has to run so the overlay lands on a live stop.
    const group = groups.find((candidate) => candidate.last === box) ?? regionOf(box)
    if (group) provisional = true
    scheduleSettle()
  })
}

// Which renderable is a collection's container, and which of its rows is the roving one. A list is
// one stop from outside — a reader walking a panel passes it once, and its own layer 40 takes the
// arrows from there — so the reading-order walk has to be able to say "this box is a list" without
// asking the kit what node drew it, the same way `items` says "this box is a row".
let containers: { box: Renderable; active: () => Renderable | undefined }[] = []

/** Called by a collection for its container (./collection.ts). `active` is the row the caret is on. */
export function markCollection(box: Renderable, active: () => Renderable | undefined): void {
  const entry = { box, active }
  containers.push(entry)
  onCleanup(() => {
    const at = containers.indexOf(entry)
    if (at >= 0) containers.splice(at, 1)
  })
}

// ── Reading the tree ──────────────────────────────────────────────────────────────────────────

const walk = (box: Renderable, take: (child: Renderable) => boolean): Renderable | undefined => {
  for (const child of box.getChildren()) {
    if (child.visible && take(child)) return child
    const nested = child.visible ? walk(child, take) : undefined
    if (nested) return nested
  }
  return undefined
}

/**
 * Where entering a box lands: its first parent stop, else its first collection row, else its first
 * stop. The caller falls back to the box itself.
 *
 * The middle step is a terminal's own departure. The DOM does not need it, because a reader arrives
 * at a pane with a pointer and clicks what they meant; here the first thing focused is the thing the
 * bare keys drive, and landing in a filter box means `j` types a `j`. A filter strip owns no panels,
 * so it is not a parent and the rows below it still win.
 */
const entryStop = (box: Renderable): Renderable | undefined =>
  walk(box, (child) => !!parentEntry(child)?.panels().length)
    ?? walk(box, (child) => items.has(child))
    // A native scrollbox is focusable so a control-free document can own the arrow keys. It is a
    // transparent viewport when it contains a real stop, though: descending through it here keeps a
    // terminal rectangle, composer or field reachable instead of landing on the scrollbar around
    // it. `stopsIn` owns that exact fallback rule for Down/Escape as well.
    ?? stopsIn(box)[0]

/** Reveal a newly focused stop in every native document viewport that contains it. */
const revealInViewports = (node: Renderable): void => {
  for (let at: Renderable | null = node.parent; at; at = at.parent) {
    if (at instanceof ScrollBoxRenderable) at.scrollChildIntoView(node.id)
  }
}

/** Whether a box is some parent stop's panel, and so belongs to the level below this walk. */
const isPanel = (node: Renderable): boolean =>
  parents.some((parent) => parent.node !== node && parent.panels().includes(node))

/**
 * Reading-order stops inside a box, in reading order.
 *
 * Exported for two callers outside this module: a `Menu`'s open list moves between its own stops
 * while the trap holds the keys, and the stops behind the overlay are not its to walk (./stops.ts).
 *
 * Five rules, and each one is a level of the model showing through:
 *
 *   a parent stop      one stop, and its panels are not walked. A panel is the level below this one,
 *                      reached with Down and left with Escape, so a strip and the controls inside the
 *                      panel it happens to be showing are never neighbours in one list.
 *   a collection       one stop, drawn as its roving row. A list is one place a reader passes
 *                      through; the arrows inside it are the collection's own layer.
 *   a scroll viewport  transparent while it holds a stop, and the stop itself otherwise. That is how
 *                      a document with no controls keeps the arrows for scrolling.
 *   a focusable node   one stop, not walked into.
 *   anything else      walked through.
 */
export const stopsIn = (box: Renderable): Renderable[] => {
  const found: Renderable[] = []
  const visit = (parent: Renderable): void => {
    for (const child of parent.getChildren()) {
      if (!child.visible || child.isDestroyed || isPanel(child)) continue
      if (parentEntry(child)) {
        found.push(child)
        continue
      }
      const container = containers.find((entry) => entry.box === child)
      if (container) {
        // A virtual list whose active row is off its drawn window has no renderable for it, and the
        // container itself holds the keys until one arrives (../kit/showing.tsx § Rows).
        const row = container.active()
        if (row && !row.isDestroyed && row.visible) found.push(row)
        else if (child.focusable) found.push(child)
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
  }
  visit(box)
  return found
}

/**
 * The box a stop's neighbours live in: the panel it is inside, else its region's own box.
 *
 * The same walk `parentOf` makes, keeping the ancestor rather than the strip that owns it. A stop
 * that is not in a panel has the whole region for neighbours, which is what a filter strip above a
 * list wants.
 */
const boxAround = (node: Renderable): Renderable | undefined => {
  for (let at: Renderable | null = node; at; at = at.parent) if (isPanel(at)) return at
  return regionOf(node)?.box
}

/**
 * Move to the next or previous stop beside the focused one, and reveal it.
 *
 * An edge is a wall: `true` and nothing moves, the same answer a tab strip gives at its last tab.
 * Letting a failed Down bubble to the region tier would make an arrow cross regions, which is Tab's
 * job and which surprised readers the one time a strip did it.
 *
 * `false` means "not mine": the focused thing is not in the walk at all, which is a row of a
 * collection or a viewport with nothing in it. Both have their own answer to the arrows and both sit
 * on a lower layer, so returning false is what lets them have it.
 */
export function moveStop(delta: 1 | -1): boolean {
  const node = focusedNode()
  // A row of a collection is in the walk — a list is drawn there as the row its caret is on — and it
  // is still not this function's to move. The list owns its own arrows and wraps by its own rules.
  if (!node || items.has(node)) return false
  const box = boxAround(node)
  if (!box) return false
  const stops = stopsIn(box)
  const at = stops.indexOf(node)
  if (at < 0) return false
  return focusRenderable(stops[at + delta]) || true
}

/**
 * Move from one stop to the adjacent stop in its current region, without wrapping.
 *
 * `moveStop` is the reader-facing version of this and walls at an edge. This one does not, and that
 * is the whole difference and the reason both exist: its caller is a tab strip that owns no panels —
 * GitHub's Open/Closed filter, the task-pane strip — where Down means "into the panel, else the next
 * stop beside me, else the next region", and a wall would make the last term dead.
 */
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
  // A remembered target, unless what was remembered is the region's own box: that is the last resort
  // below, taken when the region had nothing in it yet, and remembering it pins the keys to the frame
  // for the rest of the run. A reader who looked into Browse before choosing a source came back to a
  // lit border, no caret and dead arrows, because the list that arrived in between was never asked
  // for.
  //
  // The region's own box is the last resort, as it is on the DOM: a region with nothing focusable in
  // it still has to be reachable, or the cycle has a hole and the layout's own chords — the group
  // switch, the split — have nothing to be focus-within of.
  const keyed = group.lastIdentity ? itemsByIdentity.get(group.lastIdentity) : undefined
  const remembered = group.lastIdentity
    ? keyed && !keyed.isDestroyed ? keyed : undefined
    : group.last && !group.last.isDestroyed && group.last !== group.box ? group.last : undefined
  const target = remembered ?? entryStop(group.box) ?? group.box
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

// ── The settle pass ───────────────────────────────────────────────────────────────────────────

let settleQueued = false
// The overlays holding the keys, innermost last. A stack rather than one box, because a `Menu` inside
// a `Modal` is a second overlay over the first and closing it must leave the modal still holding them.
const overlays: Renderable[] = []
let overlayClosing: { node: Renderable | null; region: RegionRef | null } | null = null

/** The overlay that owns the keys, if one does. */
const openOverlay = (): Renderable | null => {
  while (overlays.length && overlays[overlays.length - 1]!.isDestroyed) overlays.pop()
  return overlays[overlays.length - 1] ?? null
}

/** Whether a renderable is inside a box, by walking the retained tree up. */
const within = (box: Renderable, node: Renderable): boolean => {
  for (let at: Renderable | null = node; at; at = at.parent) if (at === box) return true
  return false
}

/**
 * Queue the one deferred focus decision.
 *
 * A microtask rather than a frame event: OpenTUI emits per frame, but a test renderer under `flush()`
 * may render several times before one, and a settle that waits for a frame waits for the wrong thing.
 * Solid commits synchronously, so the renderables of the current render all exist at the end of the
 * current task — which is exactly when a microtask runs. Guarded, so six callers in one turn settle
 * once.
 */
export function scheduleSettle(): void {
  if (settleQueued) return
  settleQueued = true
  queueMicrotask(() => {
    settleQueued = false
    settleFocus()
  })
}

/** 1. Focus never sits on a corpse: re-enter the region by its remembered identity. */
const reviveFocus = (): void => {
  const node = focusedNode()
  if (!node || (!node.isDestroyed && node.visible)) return
  const group = groups.find((candidate) => candidate.last === node) ?? regionOf(node)
  if (group) enter(group)
  // A corpse in no region — the last stop inside an overlay that has closed. Holding it would leave
  // the screen with the keys on a dead node and stop `openScreen` below from opening it at all.
  else setFocusedNode(null)
}

/** 2. Something has to have the keys when the screen first has regions, and on this host nothing
 *  else will decide: the desktop lands focus with a click or a Tab and there is neither here. The
 *  shell names the region; with no answer, the first one drawn takes them. */
const openScreen = (): void => {
  if (focusedNode()) return
  const wanted = topology?.opensOn() ?? null
  enter(groupAt(wanted) ?? ordered()[0])
}

/** 3. A region holding the keys for want of anything better gives them up as soon as it has
 *  somewhere to put them, which is when its list arrives. */
const claimProvisional = (): void => {
  if (!provisional) return
  const group = groupAt(focused)
  if (!group) return
  const target = entryStop(group.box)
  if (!target || target === group.box) return
  enter(group)
}

/** 0. An open overlay holds the keys, and holds them for as long as it is open.
 *
 *  It cannot land on anything before this: its children are mounted by the render that produced its
 *  box, so the settle after it opens is the first moment there is a stop inside it. Its region claim
 *  is untouched, which is what makes giving the keys back a matter of remembering one renderable.
 *
 *  Every settle after that one is the same question again, because everything else the settle pass
 *  does is a region decision and the region tier is exactly what a trap is holding the keys away
 *  from. A list arriving behind an open modal used to take them (`claimProvisional`), and a row
 *  destroyed inside one used to leave them on a corpse (`markItem`) — in both cases the trap then
 *  swallowed every key the reader pressed, so the modal was on screen and could not be answered. */
const holdInOverlay = (box: Renderable): void => {
  // The keys never went back to the region behind: an overlay that closed into another one is a
  // handover rather than a restore.
  overlayClosing = null
  const node = focusedNode()
  if (node && !node.isDestroyed && node.visible && within(box, node)) return
  const target = entryStop(box) ?? box
  if (target === box) box.focusable = true
  target.focus()
  setFocusedNode(target)
}

/** 4. And gives them back on the settle after it closes, which is after the reconciliation that
 *  closing caused: the action that dismisses an overlay can replace the surface behind it in the
 *  same update, and at cleanup time the old row still reports itself live. */
const restoreFromOverlay = (): void => {
  const closing = overlayClosing
  if (!closing) return
  overlayClosing = null
  // An overlay that was open before anything had the keys — a `Modal` drawn by the first render — has
  // nothing to give back, and what it leaves behind is a detached box that still reports itself live.
  // Drop it and open the screen the way boot does, rather than claiming a null region.
  if (!closing.node && !closing.region) {
    setFocusedNode(null)
    openScreen()
    return
  }
  focused = closing.region
  const identity = closing.node ? itemIdentities.get(closing.node) : undefined
  const replaced = !!identity && itemsByIdentity.get(identity) !== closing.node
  if (closing.node && !closing.node.isDestroyed && !replaced) {
    // A region holding the keys on its own frame for want of anything better may have grown a list
    // while the overlay was up, and the settle that would have noticed ran with the overlay in front
    // of it. Re-enter rather than restore, so the keys come back to the list and not to the border.
    const home = groupAt(closing.region)
    if (home && home.box === closing.node) enter(home)
    else focusRenderable(closing.node)
    return
  }
  // A workspace or source switch can replace the row that was focused behind the overlay. Restoring
  // the dead renderable is impossible, but restoring its region is not: walk the live tree again so
  // the replacement row receives focus and the region's pick-on-enter rule runs.
  const group = groupAt(closing.region)
  if (group) enter(group)
}

/** 5. Reveal wherever the four steps above left the keys. */
const revealFocus = (): void => {
  const node = focusedNode()
  if (node && !node.isDestroyed) revealInViewports(node)
}

function settleFocus(): void {
  const overlay = openOverlay()
  if (overlay) {
    holdInOverlay(overlay)
    revealFocus()
    return
  }
  reviveFocus()
  openScreen()
  claimProvisional()
  restoreFromOverlay()
  revealFocus()
}

/**
 * Hand the keys to an overlay that has just opened, keep them there while it is open, and give
 * them back when it closes.
 *
 * The DOM palette keeps a `prevFocus` element for exactly this and restores it on dismissal
 * (client-core/host/palette/overlay.ts). Same rule, no element: what had the keys is remembered and
 * put back, unless it went away while the overlay was open, in which case the region that owned it
 * keeps the claim and its own memory decides.
 */
export function takeFocus(box: Renderable): void {
  const previous = focusedNode()
  const previousRegion = focused
  overlays.push(box)
  scheduleSettle()
  onCleanup(() => {
    const at = overlays.lastIndexOf(box)
    if (at >= 0) overlays.splice(at, 1)
    overlayClosing = { node: previous, region: previousRegion }
    scheduleSettle()
  })
}

// ── Moving ────────────────────────────────────────────────────────────────────────────────────

/**
 * Move to the next or previous region on screen. Wraps.
 *
 * Every region, not the focused pane's alone, and that is this host's own answer: a terminal draws
 * one pane, so the rail, the pane strip, the pane's own regions and the footer are one screen and one
 * cycle (docs/tui.md § Navigation). The desktop scopes the cycle to a pane
 * because it draws several side by side and Tab into the next one would be a surprise; here there is
 * no next one to be surprised by, and the chord that switches which pane is drawn is `nextPane`.
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
 * The destination remembers the group last used in that column. On a first visit it enters the first
 * region the shell does not call chrome, which is how main skips the pane strip. */
export function moveColumn(delta: 1 | -1): boolean {
  const current = groupAt(focused)
  if (!current) return false
  if ((current.column === 'rail' && delta < 0) || (current.column === 'main' && delta > 0)) return false

  const destination: RegionColumn = current.column === 'rail' ? 'main' : 'rail'
  const remembered = lastByColumn[destination]
  if (remembered && groups.includes(remembered)) return enter(remembered)

  return enter(ordered().find((group) =>
    group.column === destination && !(topology?.skips(group) ?? false)))
}

/**
 * Climb one level.
 *
 * A stop inside a panel returns to the parent stop that owns the panel; a stop with no parent above
 * it returns to the region the shell calls this one's home. With no home named — a rail region, or a
 * main region the shell has nothing above — the next edge is the column, which from the rail is
 * `false` so the shell's own Escape layer can clear a notification.
 */
export function moveBack(): boolean {
  const node = focusedNode()
  const current = groupAt(focused)
  if (!current || !node) return false
  const parent = parentOf(node)
  if (parent) return focusRenderable(parent)
  const home = topology?.home(current) ?? null
  const group = home ? groupAt(home) : undefined
  return group ? enter(group) : moveColumn(-1)
}

/**
 * Whether the collection that currently owns the keys should enter main after activation.
 *
 * Read before the row runs: activation can replace the source or task pane and therefore rebuild
 * the destination regions. The collection performs the ordinary select/press first, then uses the
 * captured answer with `moveColumn(1)`, so Enter never substitutes for the row's own action.
 */
export function activationEntersMain(): boolean {
  return groupAt(focused)?.enterMainOnActivate ?? false
}

/** Move to the next or previous pane, landing on whatever it last had focused, or — where only one
 *  pane is mounted, which is this host's usual state — switch which pane that is. */
export function movePane(delta: 1 | -1): boolean {
  const current = groupAt(focused)

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

/** Whether this renderable is itself a parent stop showing at least one panel.
 *
 *  `parentOf` answers the other direction — the parent above a stop — and the footer needs this one:
 *  on a strip, `j` enters rather than moves and `h/l` change the tab (../chrome/bindings.ts). */
export const isParentStop = (node: Renderable | null | undefined): boolean =>
  !!node && !!parentEntry(node)?.panels().length

/**
 * Every stop on screen, region by region, in the order the regions draw.
 *
 * Test-only, and the walk is `stopsIn` applied to each region's box rather than a second one — so a
 * panel's contents are not here, because a panel is the level below a region's own list and is
 * reached by entering the parent stop that owns it. The reachability property reads this
 * (../reachability.test.tsx).
 */
export function _allStops(): Renderable[] {
  return ordered().flatMap((group) => stopsIn(group.box))
}

/** Test seam. The list is module-level, so a suite must not inherit the previous one's regions. */
export function _resetRegions(): void {
  groups.length = 0
  delete lastByColumn.rail
  delete lastByColumn.main
  focused = null
  provisional = false
  cycler = null
  topology = null
  parents = []
  overlays.length = 0
  overlayClosing = null
  containers = []
  items = new WeakSet<Renderable>()
  itemIdentities = new WeakMap<Renderable, string>()
  itemsByIdentity.clear()
  setFocusedNode(null)
}
