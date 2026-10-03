// This store owns the focused renderable, scope stack, region claims, and focus memory.
// The kit marks focusable nodes; regionTraversal.ts walks the retained tree.
// Chrome supplies topology and pane cycling without leaking its IDs into this module.

import { createSignal, onCleanup } from 'solid-js'
import { isRemoved, type Renderable } from '../tree/compat'
import type { Press } from '../tree/hit'
import type { Renderer } from '../renderer'
import {
  collectionAt, collectionExpands, collections, isItem, itemByIdentity, itemIdentity,
  itemPick, registerItem, resetCollections,
} from './collectionRegistry'
import {
  findParent, isPanel, ownerOf, panelSet, parentEntries, parentEntry, resetParentStops,
} from './parentStops'
import type { ParentStop } from './parentStops'
import { adjacentStop, firstInTree, stopsInTree } from './regionTraversal'

export { markCollection } from './collectionRegistry'
export { markParent, panelsChanged } from './parentStops'

export type RegionRef = { paneId: string; regionId: string }

/** A native scrollbox can own arrow keys when it has no control. */
export const isViewport = (node: Renderable): boolean => node.kind === 'scrollbox'

/** Input and textarea nodes receive typed keys through the terminal handoff. */
export const isField = (node: Renderable): boolean => node.kind === 'input' || node.kind === 'textarea'

/** The leftmost column. Two facts about the screen are two too many for this module to know, so this
 *  is the one: the column at the far left is the chrome's and has no pane behind it, which is what
 *  makes a pane cycle from there a cycle of a pane the reader is not in (§ movePane). Which regions
 *  are there is still the shell's to declare, and it declares it by passing this (../chrome/Rail.tsx). */
const RAIL_COLUMN = 0

/** Where a region that says nothing sits: one column right of the rail. Every region a layout
 *  registers is here unless the layout draws it beside another one (../layouts/ListDetail.tsx). */
const MAIN_COLUMN = 1

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
  /** Which column, left to right, spatial left/right navigation treats this region as belonging to.
   *
   *  An integer rather than the pair `'rail' | 'main'` it replaced, because two frames drawn side by
   *  side inside one pane are two columns and the pair could not say so: every region a layout
   *  registered was `'main'`, so Right in a `list-detail` had nothing to cross to and did nothing at
   *  all (docs/tui/focus.md § Focus regions). The rail's three panels pass 0, a layout's
   *  regions default to 1, and a layout with side-by-side regions declares the second one 2. Nothing
   *  reads the number except `moveColumn`, which walks to the nearest one in the direction asked, so
   *  the values only have to be ordered and not contiguous. */
  x?: number
  /** Activating a row in this region also hands the keys to the main column. Rail lists opt in. */
  enterMainOnActivate?: boolean
  /** Landing on one of this region's rows also selects it. Browse is the sole caller. */
  pickOnEnter?: boolean
}

/** Where something that holds the keys left them, so coming back restores rather than resets. A
 *  region has one and so does a scope, and one focus move writes exactly one of them: whichever of
 *  the two the keys are in (§ The one owner). */
type Memory = {
  last?: Renderable
  /** The collection's own key for `last`, because a query refresh replaces its renderable. */
  lastIdentity?: string
}

type Group = RegionRef & Memory & {
  box: Renderable
  x: number
  enterMainOnActivate: boolean
  pickOnEnter: boolean
  /** Where this region drew in its layout, so the cycle walks the screen rather than mount order. */
  order: number
}

const groups: Group[] = []
// Keep order in the array and use maps for repeated ancestor and reference lookups.
const groupByBox = new Map<Renderable, Group>()
const groupByRef = new Map<string, Group>()

const refKey = (ref: RegionRef): string => `${ref.paneId}\u0000${ref.regionId}`

// ── The step counter ──
// Count tree visits only while the key trace is enabled.
let counting = !!process.env.ACORN_TUI_KEYS_TRACE
let visited = 0

/** The walk counter. `take()` reads it and resets, which is what "per key press" means when the
 *  reader is a `key:after` intercept; `read()` leaves it alone, which is what a test wants.
 *
 *  `count` is the test seam. The flag is read at import and a suite cannot set an environment
 *  variable before its own imports run, so a case that is about the number turns it on for itself
 *  (../keys/regions.test.ts). */
export const walkSteps = {
  take: (): number => { const at = visited; visited = 0; return at },
  read: (): number => visited,
  reset: (): void => { visited = 0 },
  counting: (): boolean => counting,
  count: (on: boolean): void => { counting = on; visited = 0 },
}

/** One node visited. Inlined by shape rather than by a helper at every call site: the walks below
 *  call this once per node and nothing else does. */
const step = (): void => { if (counting) visited += 1 }
// How many times a region has come or gone, as a signal, because the footer's answers depend on the
// list and not only on where the keys are: the rail hides on Ctrl+B, the pane strip draws only while
// a task is open, and neither has to move focus to change what Tab can reach. A counter rather than a
// signal holding the list, because nothing reads the list reactively — the questions are "how many"
// and "which columns" — and copying an array on every mount to answer them would be a cost per region
// for no reader (§ regionsInScope, ../chrome/bindings.ts § activeHints).
const [mounted, setMounted] = createSignal(0)
const lastByColumn = new Map<number, Group>()
let focused: RegionRef | null = null
// What has the keys, as a signal, because it is what a row draws its caret from: in a terminal the
// caret is not decoration, it is where focus is. This signal is the answer rather than a view of one:
// nothing else holds an opinion about where the keys are (§ The one owner).
const [focusedNode, setFocusedNode] = createSignal<Renderable | null>(null)

/** The renderable that has the keys. */
export const focusedRenderable = focusedNode

/** Check the node, every visible ancestor, and the retained tree root. Hidden panels and unlinked subtrees cannot hold focus. */
export const onScreen = (node: Renderable | null | undefined): boolean => {
  if (!node || node.isDestroyed) return false
  // The walk starts at the node rather than at its parent, because a node's own `visible` is not a
  // special case worth a line of its own: the two boxes that hide a subtree can each be the node that
  // has the keys, which a `pty` rectangle on a switched-away tab is (../kit/rectangle.tsx).
  let top: Renderable = node
  for (let at: Renderable | null = node; at; at = at.parent) { step(); if (!at.visible) return false; top = at }
  return !isRemoved(top)
}

/** A frame draws its active border when it contains the focused node. */
export const focusWithin = (box: Renderable | undefined): boolean => {
  const node = focusedNode()
  return !!box && !!node && within(box, node)
}

/** Which region has focus, or null before anything in a layout has been focused. */
export const focusedRegion = (): RegionRef | null => focused

/** The region a ref names, while the keys can still reach it.
 *
 *  Out of scope is out of the question. With a dialog up the region behind it still holds the
 *  claim, because the claim is how closing the dialog knows where to give the keys back. Every walk
 *  that reads the claim would otherwise move them behind the dialog (§ Scopes). */
const groupAt = (ref: RegionRef | null | undefined): Group | undefined => {
  const group = ref ? groupByRef.get(refKey(ref)) : undefined
  return group && inScope(group.box) ? group : undefined
}

// ── Scopes ──
// The top scope limits every focus query. A nested menu can sit above a modal.
type Scope = Memory & {
  /** The box that contains the keys. Null for the screen, which contains everything. */
  box: Renderable | null
}

const screenScope = (): Scope => ({ box: null })

// A signal rather than a plain array, because the depth is a question the footer asks: the hints
// re-read the store's signals to know when to re-draw, and "how many regions are in scope" has to be
// one of them. A pane's own `Modal` never touches ../chrome/state.ts, so the shell's overlay stack
// cannot answer this one (../chrome/bindings.ts).
const [scopes, setScopes] = createSignal<readonly Scope[]>([screenScope()])

// What `ordered()` last answered, and what it answered it for. Two things move the answer and both
// are writes rather than reads: a region registering or unregistering, and a scope being pushed or
// popped, since a scope is the filter (§ ordered, § Scopes).
let registryVersion = 0
let orderedCache: { at: number; scopes: readonly Scope[]; groups: Group[] } | null = null
const registryChanged = (): void => { registryVersion += 1; orderedCache = null }

const top = (): Scope => scopes()[scopes().length - 1] ?? screenScope()

/** Whether a renderable is inside a box, by walking the retained tree up. */
const within = (box: Renderable, node: Renderable): boolean => {
  for (let at: Renderable | null = node; at; at = at.parent) { step(); if (at === box) return true }
  return false
}

/** Whether the keys can reach this node at all: the screen reaches everything, and a scope reaches
 *  its own subtree and nothing else. */
const inScope = (node: Renderable): boolean => {
  const box = top().box
  return !box || within(box, node)
}

/** How many scopes deep the keys are: 1 is the screen, 2 is one dialog over it, and so on.
 *
 *  Read by the trace flag, which reports it per key so that "the dialog is up and nothing answers"
 *  is a line in a log rather than a guess, and by the command layer, whose bare keys belong to the
 *  screen (./install.ts, ./commandLayer.ts, docs/tui/keys.md § Keys and focus). */
export const scopeDepth = (): number => scopes().length

/** Read the mount signal so footer hints update when regions appear or disappear without a focus move. */
export const regionsInScope = (): number => {
  mounted()
  return ordered().length
}

/** Whether the keys are inside the top scope, which is invariant 10. The reachability property asks
 *  it after every press on a surface with a dialog up (../reachability.test.tsx). */
export const focusedInScope = (): boolean => {
  const node = focusedNode()
  return !node || inScope(node)
}

/** Contain focus in a box until cleanup. Remove by identity because nested scopes can dispose out of order. */
export function pushScope(box: Renderable): () => void {
  // Focusable from the push, for the reason a region's frame is: a scope with nothing focusable in
  // it, such as the cheat sheet, which is lines of text, still has to hold the keys, or the dialog is
  // on screen with the keys behind it (§ registerRegion).
  box.focusable = true
  const scope: Scope = { box }
  setScopes((all) => [...all, scope])
  orderedCache = null
  scheduleSettle()
  return () => {
    // By identity rather than by position: a `Menu` inside a `Modal` can be disposed after the modal
    // that drew it, and popping the top of the stack would then pop the wrong scope.
    setScopes((all) => all.filter((entry) => entry !== scope))
    orderedCache = null
    // The keys leave the box that is going, said here rather than read off the tree. The tree is
    // still telling the truth of the last render: nothing is destroyed, so the pass below would find
    // the closing dialog attached, visible, and — its own scope gone — inside the screen's, and would
    // leave the keys on it (docs/tui/traps.md § Traps).
    const at = focusedNode()
    if (at && within(box, at)) setFocus(null)
    scheduleSettle()
  }
}

// ── The topology and the pane cycler ──────────────────────────────────────────────────────────

let topology: Topology | null = null
export const setTopology = (next: Topology | null): void => { topology = next }

// What the shell does when there is no second pane mounted to move to. A terminal shows one pane at
// a time, so "the next pane" is a switch rather than a walk, and the switch belongs to the chrome
// (../chrome/panes.ts).
let cycler: ((delta: 1 | -1) => boolean) | null = null
export const setPaneCycler = (next: ((delta: 1 | -1) => boolean) | null): void => { cycler = next }

// Parent stop bookkeeping lives in parentStops.ts. Focus decisions stay here.
export const parentOf = (node: Renderable): Renderable | undefined => findParent(node, step)

/** Only a panel inside the top scope can hand horizontal keys to its strip. */
const parentInScope = (node: Renderable | null): ParentStop | undefined => {
  const box = node && boxAround(node)
  return box && isPanel(box) ? ownerOf(box) : undefined
}

/** The footer says column when another pane column is reachable, or tab when the owning strip answers. */
export const bubbledCrossWord = (): 'tab' | 'column' => {
  if (!parentInScope(focusedNode())) return 'column'
  const current = groupAt(focused)
  const beyond = ordered().some((group) => group.x !== current?.x && group.x !== RAIL_COLUMN)
  return beyond ? 'column' : 'tab'
}

/** A horizontal key leaving a panel enters another pane column or returns to its strip. It cannot enter the rail. */
export function crossParent(delta: 1 | -1): boolean {
  const entry = parentInScope(focusedNode())
  if (!entry) return false
  if (moveColumn(delta, { rail: false })) return true
  entry.cross?.(delta)
  return focusRenderable(entry.node)
}

/** Down from a parent stop: into the first stop of the panel it is showing. */
export function enterParent(parent: Renderable): boolean {
  const panel = parentEntry(parent)?.panels().find((box) => onScreen(box))
  if (!panel) return false
  return focusRenderable(entryStop(panel) ?? panel)
}

/** Cache visible regions by registry version and scope identity; key handling reads this order repeatedly. */
const ordered = (): Group[] => {
  // Cached until the registry or the scope stack moves, which is what makes it safe to ask this on
  // every key: `moveColumn` asks twice, `movePane` twice more, the landing rule once and the footer
  // once per render, and each ask used to copy and sort the whole list (§ registryChanged).
  const at = scopes()
  if (orderedCache && orderedCache.at === registryVersion && orderedCache.scopes === at) return orderedCache.groups
  const found = groups.filter((group) => inScope(group.box)).sort((a, b) => a.order - b.order)
  orderedCache = { at: registryVersion, scopes: at, groups: found }
  return found
}

export function registerRegion(box: Renderable, ref: RegionRef, order: number, options: RegionOptions = {}): () => void {
  // Focusable from here, and never flipped again. A region with nothing focusable in it still has to
  // be reachable or the Tab cycle has a hole, and a pane's regions are `lazy()`, so most start that
  // way. The flag is this store's own declaration of what can hold the keys (§ reachable).
  box.focusable = true
  const group: Group = {
    ...ref,
    box,
    order,
    x: options.x ?? MAIN_COLUMN,
    enterMainOnActivate: options.enterMainOnActivate ?? false,
    pickOnEnter: options.pickOnEnter ?? false,
  }
  groups.push(group)
  groupByBox.set(box, group)
  groupByRef.set(refKey(ref), group)
  registryChanged()
  setMounted((count) => count + 1)
  return () => {
    const at = groups.indexOf(group)
    if (at >= 0) groups.splice(at, 1)
    if (groupByBox.get(box) === group) groupByBox.delete(box)
    if (groupByRef.get(refKey(ref)) === group) groupByRef.delete(refKey(ref))
    registryChanged()
    if (lastByColumn.get(group.x) === group) lastByColumn.delete(group.x)
    setMounted((count) => count + 1)
    // A conditional region can go while it holds the keys: the rail hides on Ctrl+B, the pane strip
    // draws only while a task is open, and Browse registers nothing without a list. Look again, or
    // the keys sit inside a subtree the reader can no longer see.
    scheduleSettle()
  }
}

/** The helper a layout calls in setup, where the DOM layout uses the `use:regionFocus` directive.
 *  There is no directive mechanism outside the DOM renderer, so this is a function and the layout
 *  calls it from the region box's `ref`. Who opens the screen is the landing rule's answer, not this
 *  one's: every region of a boot registers before the first pass runs. */
export const regionFocus = (ref: RegionRef, order: number, options: RegionOptions = {}) => (box: Renderable) => {
  onCleanup(registerRegion(box, ref, order, options))
  scheduleSettle()
}

/** Which region a renderable is inside, by walking up the retained tree. The DOM half asks the same
 *  question with `focusin` bubbling; here the tree is the bubble. */
const regionOf = (node: Renderable): Group | undefined => {
  for (let at: Renderable | null = node; at; at = at.parent) {
    step()
    const group = groupByBox.get(at)
    if (group) return group
  }
  return undefined
}

// ── The one owner ──
// Focus moves through setFocus; the renderer receives a caret update and never decides focus.
/** Remember a stop, unless it is the frame that was holding the keys for want of anything better.
 *
 *  A landing on a frame is never remembered. The frame is the last resort, taken when the thing had
 *  nothing in it yet, and remembering it pins the keys to a border for the rest of the run: a reader
 *  who looked into Browse before choosing a source came back to a lit border with dead arrows
 *  (§ enter, docs/tui/focus.md § Focus regions). */
const remember = (of: Memory, node: Renderable, frame: Renderable | null): void => {
  if (node === frame) return
  of.last = node
  of.lastIdentity = itemIdentity(node)
}

// Who to tell when the keys move, for a reader that is not a component. The keymap engine asks its
// host where they are once per key and wants telling when they move — that is what clears a
// half-pressed sequence and re-draws the footer — so this is the subscription its host adapter is
// built from, and the typing shadow follows the same one (./keymapHost.ts, ./install.ts).
const watchers = new Set<(node: Renderable | null) => void>()

/** Hear about every focus move, until the returned function is called. */
export const onFocusMove = (listener: (node: Renderable | null) => void): (() => void) => {
  watchers.add(listener)
  return () => { watchers.delete(listener) }
}

/** Mirror focus to the renderer for caret paint. This store never reads renderer focus back. */
const paintCaret = (previous: Renderable | null, node: Renderable | null): void => {
  if (node) node.focus()
  else previous?.blur()
}

/** The only writer of focusedNode. It updates caret paint, listeners, focus memory, and the pending reveal. */
const setFocus = (node: Renderable | null): void => {
  const previous = focusedNode()
  if (node === previous) return
  setFocusedNode(node)
  paintCaret(previous, node)
  for (const watcher of watchers) watcher(node)
  if (!node) {
    // The keys are nowhere, which is the pass's own invitation. Two places say it and neither is the
    // reader choosing to leave — a scope popping, and the pass letting go of a corpse in no region —
    // so the region claim stays: it is how the landing knows which region to re-enter.
    scheduleSettle()
    return
  }
  // One reveal, after the next layout rather than now, because the node may have moved since
  // (§ The reveal).
  pendingReveal = node
  // One memory per move, and it belongs to whichever of the two levels holds the keys. A `Modal` or
  // an open `Menu` is drawn inside whatever region had them, so a region that also remembered a
  // dialog's rows would give the keys back to a destroyed row when the dialog closed rather than to
  // the trigger that opened it, and its claim would say the reader had changed region while they were
  // answering a dialog (docs/tui/focus.md § Focus regions).
  const scope = top()
  if (scope.box) {
    remember(scope, node, scope.box)
    return
  }
  const group = regionOf(node)
  if (!group) return
  remember(group, node, group.box)
  lastByColumn.set(group.x, group)
  focused = { paneId: group.paneId, regionId: group.regionId }
}

// ── The reveal ──
// Scroll after layout so newly mounted rows have valid geometry.
/** The node the post-layout reveal still owes a scroll to. One slot and not a queue: the reveal is
 *  about where the keys are now, and where they were two frames ago is nobody's question. */
let pendingReveal: Renderable | null = null

// ── Clicks are hit tests ──
// The renderer reports the hit node; this store decides which ancestor receives focus.
/** Focus the nearest thing above a left click that could hold the keys, or nothing at all.
 *
 *  `reachable` is the whole of "is this a stop": a stop, a collection row, a region's frame and a
 *  scope's box are the focusable things in the tree and nothing else is. It answers for the top scope
 *  too, so a click behind an open dialog reaches nothing rather than past it (§ Scopes). */
/** The left button, as `../tree/hit.ts` numbers one. */
const LEFT_BUTTON = 0

const focusClicked = (event: Press): void => {
  if (event.button !== LEFT_BUTTON) return
  for (let at: Renderable | null = event.target; at; at = at.parent) {
    step()
    // Through a name of its own, because `reachable` is a type guard and narrowing the cursor of the
    // walk with it leaves the walk with nothing to read `parent` off.
    const hit: Renderable = at
    if (reachable(hit)) { focusRenderable(hit); return }
  }
}

// The live handler, so installing twice in one process does not leave the first one running: a suite
// is one worker with a renderer per test (../harness.tsx).
let detach = (): void => {}

/** Point the store at a renderer: where a click landed, and the frame the reveal waits for.
 *  Called by `installKeymap`, because "install the keyboard on this renderer" is one thing and where
 *  the keys are is half of it (./install.ts). */
export function installRegions(renderer: Renderer): void {
  detach()
  // And whatever the last renderer's keymap and typing shadow left listening here: an engine is
  // built per renderer and tears nothing down itself (§ onFocusMove).
  watchers.clear()
  // On the root, because a mouse event bubbles up to it carrying the renderable it hit — and because
  // `onMouseDown` is one slot per renderable rather than a listener list, so one handler for the
  // screen is also all there is room for.
  renderer.root.onMouseDown = focusClicked
  // `frame` fires once per render-loop iteration and after the render, which is the side of layout
  // where a child's geometry is real: `onLifecyclePass` and `setFrameCallback` both run before it and
  // would read the same stale numbers a synchronous reveal reads (§ The reveal).
  const afterFrame = (): void => {
    const node = pendingReveal
    pendingReveal = null
    // Still there and still holding the keys. A frame later either can be false: a landing may have
    // moved on, and a node Solid removed is off the screen whatever it still points at.
    if (!node || node.isDestroyed || focusedNode() !== node) return
    revealInViewports(node)
  }
  renderer.on('frame', afterFrame)
  detach = () => {
    renderer.root.onMouseDown = undefined
    renderer.off('frame', afterFrame)
    pendingReveal = null
    detach = () => {}
  }
}

/** Move focus only to a live, visible, focusable node inside the top scope. */
export function focusRenderable(node: Renderable | undefined): boolean {
  if (!node || !onScreen(node) || !node.focusable) return false
  setFocus(node)
  return true
}

/** Whether a renderable could hold the keys right now: on screen, focusable, and inside the top
 *  scope. What `ensureFocus` asks about the node that has them, and `focusRenderable` about a node
 *  it is asked to move them to. */
const reachable = (node: Renderable | null | undefined): node is Renderable =>
  !!node && onScreen(node) && node.focusable && inScope(node)

/** Where a region or a scope left the keys, while that stop can still take them.
 *
 *  By collection identity first, because a query refresh replaces the renderable for the same logical
 *  row, and never a placeholder, because the stand-in a region settled for is not what a reader
 *  coming back is looking for (§ onPlaceholder). */
const remembered = (of: Memory): Renderable | undefined => {
  const node = of.lastIdentity ? itemByIdentity(of.lastIdentity) : of.last
  return reachable(node) && !onPlaceholder(node) ? node : undefined
}

// Collection bookkeeping lives in collectionRegistry.ts. The focused node stays in this store.
export const focusedItem = (): boolean => {
  const node = focusedNode()
  return !!node && isItem(node)
}

export const markItem = (box: Renderable, pick?: () => void, identity?: string): void => {
  registerItem(box, pick, identity, () => {
    if (focusedNode() === box) scheduleSettle()
  })
}

export const focusedExpands = (): boolean => collectionExpands(focusedNode(), step)

// ── Reading the tree ──────────────────────────────────────────────────────────────────────────

const walk = (box: Renderable, take: (child: Renderable) => boolean): Renderable | undefined =>
  firstInTree(box, take, step)

/**
 * Where entering a box lands: its first parent stop, else its first collection's roving row, else its
 * first stop. The caller falls back to the box itself.
 *
 * The middle step is a terminal's own departure. The DOM does not need it, because a reader arrives
 * at a pane with a pointer and clicks what they meant; here the first thing focused is the thing the
 * bare keys drive, and landing in a filter box means `j` types a `j`. A filter strip owns no panels,
 * so it is not a parent and the rows below it still win.
 */
/** Nodes that have asked to be what entering their region lands on (§ entryStop). */
const entryMarks = new WeakSet<Renderable>()

/** Override the default landing stop for a region, such as the agent composer. */
export const markEntry = (node: Renderable): void => { entryMarks.add(node) }

/** Enter a collection on its active row; use the first drawn row if a virtual list omits it. */
const activeRowIn = (box: Renderable): Renderable | undefined => {
  const container = walk(box, (child) => collections().has(child))
  const row = container ? collectionAt(container)?.active() : undefined
  if (row && !row.isDestroyed && row.visible) return row
  return walk(box, (child) => isItem(child))
}

const entryStop = (box: Renderable): Renderable | undefined =>
  walk(box, (child) => entryMarks.has(child))
  ?? walk(box, (child) => !!parentEntry(child)?.panels().length)
    ?? activeRowIn(box)
    // A native scrollbox is focusable so a control-free document can own the arrow keys. It is a
    // transparent viewport when it contains a real stop, though: descending through it here keeps a
    // terminal rectangle, composer or field reachable instead of landing on the scrollbar around
    // it. `stopsIn` owns that exact fallback rule for Down/Escape as well.
    ?? stopsIn(box)[0]

/** Reveal a newly focused stop in every native document viewport that contains it. */
const revealInViewports = (node: Renderable): void => {
  for (let at: Renderable | null = node.parent; at; at = at.parent) {
    step()
    if (isViewport(at)) at.scrollChildIntoView?.(node.id)
  }
}

/** Walk reading-order stops. Nested regions, parent panels, collections, and scrollboxes each own a separate navigation level. */
export const stopsIn = (box: Renderable): Renderable[] => stopsInTree(box, {
  panels: panelSet(),
  regions: groupByBox,
  parents: parentEntries(),
  collections: collections(),
  step,
})

/** Use the nearest panel or region as a stop's neighbours, provided it remains in scope. */
const boxAround = (node: Renderable): Renderable | undefined => {
  // Either answer only counts while the keys can reach it. A dialog drawn inside a region has that
  // region as an ancestor, and the stops behind the dialog are not its neighbours (§ Scopes).
  for (let at: Renderable | null = node; at; at = at.parent) { step(); if (isPanel(at)) return inScope(at) ? at : undefined }
  const group = regionOf(node)
  return group && inScope(group.box) ? group.box : undefined
}

// ── Moving ────────────────────────────────────────────────────────────────────────────────────

/** Move between stops in one box. Return false at an edge so the caller can decide whether to wall or bubble. */
export function walkStops(
  from: Renderable | null | undefined,
  delta: 1 | -1,
  options: { within?: Renderable; wrap?: boolean; stops?: readonly Renderable[] } = {},
): boolean {
  if (!from) return false
  const box = options.within ?? boxAround(from)
  if (!box) return false
  const stops = options.stops ?? stopsIn(box)
  return focusRenderable(adjacentStop(stops, from, delta, options.wrap))
}

/** Arrows move among neighbouring stops and wall at an edge. Up from a panel's first stop returns to its strip. */
export function moveStop(delta: 1 | -1): boolean {
  const node = focusedNode()
  // A row of a collection is in the walk — a list is drawn there as the row its caret is on — and it
  // is still not this function's to move. The list owns its own arrows and wraps by its own rules.
  if (!node || isItem(node)) return false
  const box = boxAround(node)
  if (!box) return false
  // One walk. The membership question and the move are the same list, and asking twice was a subtree
  // walk per key press for nothing (§ walkStops).
  const stops = stopsIn(box)
  if (!stops.includes(node)) return false
  if (walkStops(node, delta, { within: box, stops })) return true
  // Up from the first stop of a panel is the strip that owns it, because Down from the strip is how
  // the reader got in: the two are one door, and a wall at the top of a panel left Escape as the only
  // way back to the tabs. The bottom edge stays a wall (docs/tui/keys.md § The five key groups).
  if (delta < 0 && isPanel(box)) focusRenderable(ownerOf(box)?.node)
  return true
}

/** Enter a region on its remembered stop, entry stop, or focusable frame. Schedule a second look after a changed landing. */
const enter = (group: Group | undefined): boolean => {
  if (!group) return false
  const target = remembered(group) ?? entryStop(group.box) ?? group.box
  const before = focusedNode()
  focusRenderable(target)
  if (group.pickOnEnter && focusedNode() === target) itemPick(target)?.()
  // Look again where the keys went somewhere new: a walk into a region whose list has not arrived
  // lands on its frame, and the pass is what takes them off it once the list does. A move that
  // changed nothing is not worth a second look, and scheduling one would be a loop.
  if (focusedNode() !== before) scheduleSettle()
  return true
}

/** Enter a named host region after an overlay closes. The host uses this when an action inside the
 * overlay created a task: restoring the old Menu stop would immediately select its browse source. */
export function focusRegion(ref: RegionRef): boolean {
  const group = groupByRef.get(refKey(ref))
  return !!group && inScope(group.box) && onScreen(group.box) && enter(group)
}

/** Cycle visible regions. Inside a scope with no region, cycle only that scope's stops. */
export function moveRegion(delta: 1 | -1): boolean {
  const all = ordered()
  if (all.length < 2) {
    // A modal owns a scope, not a region. Tab must still walk its controls, and the scope already
    // gives us the exact subtree that can receive focus. This also keeps the wrap inside the modal
    // rather than passing a last-field Tab through to the rail hidden behind it.
    const box = top().box
    if (!box) return false
    const stops = stopsIn(box)
    if (!stops.length) return false
    const at = stops.indexOf(focusedNode() as Renderable)
    return focusRenderable(stops[(((at < 0 ? (delta > 0 ? -1 : 0) : at) + delta) + stops.length) % stops.length])
  }
  const at = all.findIndex((group) => group.paneId === focused?.paneId && group.regionId === focused?.regionId)
  // A conditional region can disappear while it holds focus (the task strip when a source opens,
  // or Browse when a component-only source replaces a split source). Recover at the start of the
  // cycle instead of treating the missing group as an imaginary item before it.
  if (at < 0 && focused) return enter(all[0])
  return enter(all[(((at < 0 ? 0 : at) + delta) + all.length) % all.length])
}

/** Move to the nearest column in the requested direction. Reuse its last region when reachable. */
export function moveColumn(delta: 1 | -1, options: { rail?: boolean } = {}): boolean {
  const current = groupAt(focused)
  if (!current) return false
  // `ordered()` rather than `groups`, so both the columns and the memory answer for a region that is
  // still registered *and* still in scope. Out of scope it is the region behind a dialog (§ Scopes).
  // `rail: false` keeps the move inside the pane, which is what a key bubbling out of a panel asks
  // for (§ crossParent).
  const reachable = ordered().filter((group) => options.rail !== false || group.x !== RAIL_COLUMN)
  const beyond = reachable
    .map((group) => group.x)
    .filter((x) => (delta > 0 ? x > current.x : x < current.x))
  if (!beyond.length) return false
  const destination = delta > 0 ? Math.min(...beyond) : Math.max(...beyond)

  const remembered = lastByColumn.get(destination)
  if (remembered && reachable.includes(remembered)) return enter(remembered)

  return enter(reachable.find((group) =>
    group.x === destination && !(topology?.skips(group) ?? false)))
}

/** Escape climbs from a panel to its strip, then through the shell topology toward the rail. */
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

/** Capture the region's Enter behavior before activation can replace its destination. */
export function activationEntersMain(): boolean {
  return groupAt(focused)?.enterMainOnActivate ?? false
}

/** Move to the next or previous pane, landing on whatever it last had focused, or — where only one
 *  pane is mounted, which is this host's usual state — switch which pane that is. */
export function movePane(delta: 1 | -1): boolean {
  const current = groupAt(focused)

  // Every column on screen is spatially before the pane the chord would replace, so a column move
  // answers first: Ctrl+Option+Right advertised "the pane to the right", but from Menu/Browse/Tasks
  // it used to call the task-pane cycler instead. A browse source has no active task, so the chord
  // did nothing at all. The reverse edge restores the column group the reader last used.
  if (current && moveColumn(delta)) return true
  // And the left edge is the rail, where there is nothing further left to reach and no pane to the
  // left of the one on screen either: a pane cycle from here would replace the pane a reader is not
  // in. Past the last column in the direction asked, the task-pane switcher is the answer.
  if (current?.x === RAIL_COLUMN) return false

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

// ── The landing rule ──────────────────────────────────────────────────────────────────────────

let settleQueued = false

/** Queue one focus decision after Solid has committed the renderable tree for this turn. */
export function scheduleSettle(): void {
  if (settleQueued) return
  settleQueued = true
  queueMicrotask(() => {
    settleQueued = false
    ensureFocus()
  })
}

/** A region frame or collection container yields focus once a real stop appears. */
const onPlaceholder = (node: Renderable): boolean => {
  const group = groupByBox.get(node)
  if (group) return !!entryStop(group.box)
  const container = collectionAt(node)
  return !!container && reachable(container.active())
}

/** Keep valid focus. Otherwise restore the top scope or enter the claimed, opening, or first region. */
function ensureFocus(): void {
  const node = focusedNode()
  if (reachable(node) && !onPlaceholder(node)) {
    revealInViewports(node)
    return
  }
  const scope = top()
  if (scope.box) {
    focusRenderable(remembered(scope) ?? entryStop(scope.box) ?? scope.box)
    return
  }
  // Something has to have the keys once the screen has regions, and on this host nothing else will
  // decide: the desktop lands them with a click or a Tab and there is neither here. The claim first,
  // because it is the region a destroyed row was in; then the region the shell names; then whatever
  // drew first.
  const home = groupAt(focused) ?? groupAt(topology?.opensOn() ?? null) ?? ordered()[0]
  if (home) {
    enter(home)
    return
  }
  // A corpse in no region at all, and nowhere better to put the keys: no region is registered, so
  // there is nothing to enter. Holding it would leave the screen with the keys on a dead node.
  setFocus(null)
}

/** Expose reachable stops to the keyboard reachability property, including an empty scope box. */
export function _allStops(): Renderable[] {
  const scope = top().box
  if (!scope) return ordered().flatMap((group) => stopsIn(group.box))
  // Inside a scope the only stops that exist are the scope's own, which is the same filter every
  // other question in this module takes (§ Scopes). A scope with none of its own, such as the cheat
  // sheet, which is lines of text, is itself the last-resort stop the landing rule put the keys on,
  // so the property has something to be about rather than being vacuously true.
  const stops = stopsIn(scope)
  return stops.length ? stops : [scope]
}

/** Expose reachable columns to the horizontal-key property. A panel excludes the rail. */
export function _columns(): { at: number | null; all: readonly number[] } {
  // The rail is not a column a key bubbling out of a panel can reach (§ crossParent).
  const inPanel = !!parentInScope(focusedNode())
  return {
    at: groupAt(focused)?.x ?? null,
    all: [...new Set(ordered().map((group) => group.x))].filter((x) => !inPanel || x !== RAIL_COLUMN).sort((a, b) => a - b),
  }
}

/** Test seam. The list is module-level, so a suite must not inherit the previous one's regions. */
export function _resetRegions(): void {
  // The previous render's renderer among them: a suite builds one per test, and its click handler and
  // everything its keymap left subscribed go with it (§ installRegions).
  detach()
  watchers.clear()
  // And the guard that says a pass is already queued. The reset is synchronous and a microtask is
  // not, so the previous test can leave this set with its pass still pending: the pass then runs
  // against an empty store, which is harmless, but the next render's first `scheduleSettle` is
  // swallowed as a duplicate and the screen opens with the keys nowhere.
  settleQueued = false
  groups.length = 0
  groupByBox.clear()
  groupByRef.clear()
  registryChanged()
  setMounted((count) => count + 1)
  lastByColumn.clear()
  focused = null
  cycler = null
  topology = null
  resetParentStops()
  setScopes([screenScope()])
  orderedCache = null
  visited = 0
  resetCollections()
  setFocus(null)
}
