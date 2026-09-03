// Focus regions without a DOM.
//
// `client-core/host/keys/focusRegions.ts` keeps the same contract and is DOM all the way down: it
// orders regions by `compareDocumentPosition`, finds a region's first stop with `querySelector`,
// focuses the element itself, and listens for `focusin` and `pointerdown`. None of that exists here
// (docs/tui.md § Focus regions).
//
// What replaces each:
//
//   order       the layout registers its regions in the order it draws them, from its own knowledge
//               (LAYOUT_REGIONS in @acorn/protocol/paneLayouts.ts). Nothing is derived from position.
//   first stop  the first renderable in the region's subtree this store will focus. The kit marks
//               those as it draws them — `focusRoles.ts` says which nodes are a stop, an item, a
//               collection or a trap — and the `focusable` flag is what that mark becomes.
//   focus       this module's. One signal holds the renderable that has the keys, this file is the
//               only thing that writes it, and the renderer is told rather than asked
//               (§ The one owner).
//   pointer     a hit test rather than a focus event. The renderer resolves what a click landed on
//               and the store decides what that means, which is why the renderer's own `autoFocus`
//               is off (§ Clicks are hit tests, ../main.tsx).
//
// Five levels and nothing else: screen, column, region, parent stop, stop. A parent stop is a
// renderable that owns panels — a `Sections` strip owns the panel under it — so Down enters and
// Escape climbs. Everything the shell knows and this module must not, arrives through `setTopology`
// and `setPaneCycler`: no chrome id is spelled here.
//
// There is one question about where the keys are and one rule for putting them somewhere better,
// `ensureFocus`, scheduled by `scheduleSettle`. That is the only `queueMicrotask` in this folder, and
// the reason is that six of them raced each other (§ The landing rule).
//
// The pane and region chords live on the same layer 5 the desktop uses, so priority decides here too.

import { createSignal, onCleanup } from 'solid-js'
import { MouseButton, ScrollBoxRenderable, type CliRenderer, type MouseEvent, type Renderable } from '@opentui/core'

export type RegionRef = { paneId: string; regionId: string }

/** Is this a scroll viewport?
 *
 *  `instanceof` answers under the painter we are leaving. Under ours a node is a plain object with a
 *  `kind`, and no shim can be an instance of somebody else's class, so the question is asked by name
 *  as well (../tree/compat.ts). Phase 4 leaves the second half. */
const isViewport = (node: Renderable): node is ScrollBoxRenderable =>
  node instanceof ScrollBoxRenderable || (node as unknown as { kind?: string }).kind === 'scrollbox'

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
   *  all (docs/tui.md § Focus regions). The rail's three panels pass 0, a layout's
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
// And the same regions by their box and by their ref, because every question this module asks about a
// region is one of those two lookups inside a walk of the retained tree: `stopsIn` asks "is this child
// a region" of every node it visits, `regionOf` asks it of every ancestor, and `groupAt` resolves the
// claim on every move. A linear scan inside a walk is O(nodes × regions) where O(depth) would do,
// which is what phase 9 of the performance programme is about
// (docs/performance.md § 2026-09-03 — phase 9).
//
// The array stays, because ordering is the one thing it is good at and `ordered()` is the only reader
// that needs it (§ ordered). The maps are written where a region registers and deleted where it goes,
// so there is one place either can drift and it is the same place.
const groupByBox = new Map<Renderable, Group>()
const groupByRef = new Map<string, Group>()

const refKey = (ref: RegionRef): string => `${ref.paneId}\u0000${ref.regionId}`

// ── The step counter ──────────────────────────────────────────────────────────────────────────
//
// How many renderables the walks in this module visited, so "a key press costs the depth of the focus
// tree and not the size of the region" is a number rather than a claim. Behind the same flag the key
// trace is, because a counter nobody reads is a branch on every node of every walk
// (./install.ts § The trace, docs/tui.md § Seeing what the keys did).

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

/**
 * Whether a renderable is still on screen: alive, visible, and visible all the way up.
 *
 * The parent walk is the whole point. OpenTUI's `visible` is per node, so a focused descendant of a
 * hidden box goes on reporting `visible: true` about itself, and two things here hide a whole subtree
 * rather than unmounting it: the shell's main row behind an overlay, and the `TabPanel` that is not
 * showing. Asking the node alone said the keys were fine while they sat behind a dialog
 * (../chrome/Shell.tsx, ../kit/grouping.tsx, @opentui/core § Renderable.visible).
 *
 * Exported because the reachability property asks it after every press, and two answers to one
 * question is the drift this module exists to remove (../reachability.test.tsx).
 */
export const onScreen = (node: Renderable | null | undefined): boolean => {
  if (!node || node.isDestroyed) return false
  // The walk starts at the node rather than at its parent, because a node's own `visible` is not a
  // special case worth a line of its own: the two boxes that hide a subtree can each be the node that
  // has the keys, which a `pty` rectangle on a switched-away tab is (../kit/rectangle.tsx).
  for (let at: Renderable | null = node; at; at = at.parent) { step(); if (!at.visible) return false }
  return true
}

/**
 * Whether the keys are inside this box.
 *
 * The question a frame asks to draw itself as the active one. OpenTUI answers a version of it for
 * free, since `focusedBorderColor` fires when a box is focused or holds the focus, but only for a box
 * that is itself `focusable`, and it answers about the box alone: a `Panel` that is not a region has
 * no flag of its own and never lights. Reading the signal and walking up costs a few parent hops and
 * answers for every frame the same way.
 */
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

// ── Scopes ────────────────────────────────────────────────────────────────────────────────────
//
// A trap is a scope, not a swallow. The bottom of the stack is the screen, which contains
// everything; a `Modal` or an open `MenuList` pushes its own box while it is drawn. Every question
// this module answers is answered inside the top scope and nowhere else: which regions are on
// screen, which stops a walk can see, where Tab goes, where Left goes. Nothing behind the top scope
// exists as far as the keys are concerned (docs/tui.md § Traps).
//
// That is what makes a dialog a dialog on a host with no scrim, and it names no keys. What it
// replaced was a layer that named them all and leaked the one it got wrong; ./trap.ts holds that
// history, because that is the file the swallow was in.
//
// A stack rather than one box, because a `Menu` inside a `Modal` is a second scope over the first
// and closing it must leave the modal still holding the keys.

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
 *  screen (./install.ts, ./commandLayer.ts, docs/tui.md § Keys and focus). */
export const scopeDepth = (): number => scopes().length

/** How many regions the keys can reach.
 *
 *  The footer asks. Inside a dialog the region layer's Tab is still registered and the engine still
 *  reports it live, because a layer knows nothing about scopes, so only the store can say that Tab
 *  has nowhere to go (../chrome/bindings.ts).
 *
 *  Reads `mounted()` so the answer is reactive. `groups` is a plain array, so a region registering or
 *  unregistering without moving focus left the footer offering `tab region` on a screen with one
 *  region, or hiding it on a screen with three. Hiding the rail happens to move focus as well, which
 *  is why nobody saw it; that was luck rather than a rule. */
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

/**
 * Contain the keys in this box until it is gone, and hand them back where they came from.
 *
 * A `Modal` pushes a scope by being drawn and pops it by being disposed, so a dialog contains the
 * keys and lands them without its caller reaching for anything: that used to be two jobs and every
 * modal a plugin drew did only the first, leaving a reader a dialog they could not answer.
 *
 * Handing them back needs nothing recorded here. The scope holds the keys and so holds the memory of
 * where they were inside it, and the region behind it still claims them and still remembers its own
 * last stop, so closing a `Menu` is the region re-entered on the trigger that opened it and closing
 * one drawn inside a `Modal` is the modal re-entered on its own last stop (§ The one owner). The DOM
 * palette keeps a `prevFocus` element instead (client-core/host/palette/overlay.ts).
 *
 * The caller owns the pop, which is `onCleanup(pushScope(box))` in the box's own `ref`
 * (../kit/grouping.tsx).
 */
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
    // still telling the truth of the last render: the reconciler defers destruction to
    // `process.nextTick` for Suspense's sake, so the pass below would find a dying dialog attached,
    // visible, and, its own scope gone, inside the screen's, and would leave the keys on it
    // (../kit/reconciler.ts, docs/tui.md § Destroy on disposal).
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

// ── Parent stops ──────────────────────────────────────────────────────────────────────────────

// A parent stop is one stop from outside that owns panels: Down enters the panel it is showing and
// Escape from anything in that panel returns to it. Kept as renderable identity rather than a kit
// node name, so remote and compiled trees use the same host bookkeeping.
//
// The panels are a getter rather than a list, because a strip's panels mount after its own ref runs
// and change with its tabs. A strip with none — a list's Open/Closed filter — is an ordinary stop.
type ParentEntry = { node: Renderable; panels: () => readonly Renderable[] }

let parents: ParentEntry[] = []
// The same entries by their node, because `stopsIn` asks "is this child a parent stop" of every node
// it visits and `entryStop` asks it again (§ The step counter).
let parentByNode = new Map<Renderable, ParentEntry>()

// Every box that is somebody's panel, as one set.
//
// `isPanel` is asked of every child of every walk and of every ancestor of a stop, and the honest
// answer was "ask each parent stop whether it owns this one", which walked the parents and allocated
// a fresh panel list per parent per question (../kit/grouping.tsx § panels). The set answers the
// common case — no — in one lookup.
//
// Derived rather than written, so there is still one fact and it is still the strip's: the set is
// built from the same getters `parentOf` reads, and rebuilt when the panels move. A second registry
// beside them would be a second answer to "is this a panel", which is the drift this module exists to
// remove. `panelsChanged` is what says they moved; `markParent` says so for itself.
let panelBoxes: Set<Renderable> | null = null

/** The panels have moved: a `TabPanel` mounted or unmounted under some strip. Called by the kit,
 *  which owns the `idPrefix` relation the strips read (../kit/grouping.tsx § registerPanel). */
export const panelsChanged = (): void => { panelBoxes = null }

const panelSet = (): Set<Renderable> => {
  if (panelBoxes) return panelBoxes
  const found = new Set<Renderable>()
  for (const parent of parents) for (const panel of parent.panels()) if (panel !== parent.node) found.add(panel)
  panelBoxes = found
  return found
}

const parentEntry = (node: Renderable): ParentEntry | undefined => parentByNode.get(node)

/** Mark a renderable as one stop that owns the panels `panels()` returns.
 *
 *  Marking does not make it focusable. Which nodes are reachable is declared where a node is built,
 *  and for a strip that is the `Tabs` ref that calls this (../kit/grouping.tsx,
 *  ../invariants.test.ts § the renderer is the only truth about focus). */
export function markParent(node: Renderable, panels: () => readonly Renderable[]): void {
  const entry: ParentEntry = { node, panels }
  parents.push(entry)
  parentByNode.set(node, entry)
  panelsChanged()
  onCleanup(() => {
    const at = parents.indexOf(entry)
    if (at >= 0) parents.splice(at, 1)
    if (parentByNode.get(node) === entry) parentByNode.delete(node)
    panelsChanged()
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
    step()
    // The set first, so the ancestors that are not panels — which is nearly all of them — cost one
    // lookup rather than one scan of the parent stops (§ panelBoxes).
    if (!panelSet().has(at)) continue
    const owner = parents.find((parent) => parent.node !== at && parent.panels().includes(at as Renderable))
    if (owner) return owner.node
  }
  return undefined
}

/** Down from a parent stop: into the first stop of the panel it is showing. */
export function enterParent(parent: Renderable): boolean {
  const panel = parentEntry(parent)?.panels().find((box) => onScreen(box))
  if (!panel) return false
  return focusRenderable(entryStop(panel) ?? panel)
}

/** Every region the keys can reach, in the order it draws. A layout hands its own order in and the
 *  chrome takes numbers outside the range a layout uses, so the sort reads down the screen: rail,
 *  pane strip, the pane's own regions (../chrome/Shell.tsx).
 *
 *  Scoped, and one filter is the whole of what a trap does to the region tier: with a `Modal` up no
 *  region is in scope, so `moveRegion` has nothing to move to and Tab does nothing rather than
 *  walking the keys onto a rail row behind the dialog. Nothing here names Tab (§ Scopes). */
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

// ── The one owner ─────────────────────────────────────────────────────────────────────────────
//
// The store decides where the keys are and everything else is told. Every arrow used to point the
// other way: focus was the renderer's and this module a view of its `focused_renderable` event, so
// in the gap between the renderer moving focus itself and the view catching up the two disagreed —
// and a lit border with dead arrows was that gap, every time.
//
// There is no focus listener here now, because there is nothing left to hear: the renderer moves
// focus on nothing of its own with `autoFocus` off, and a click arrives as a hit test instead
// (§ Clicks are hit tests, ../main.tsx). One thing still goes out to the renderer and it is paint,
// the caret; nothing reads it back and ../invariants.test.ts counts the calls to keep it that way.

/** Remember a stop, unless it is the frame that was holding the keys for want of anything better.
 *
 *  A landing on a frame is never remembered. The frame is the last resort, taken when the thing had
 *  nothing in it yet, and remembering it pins the keys to a border for the rest of the run: a reader
 *  who looked into Browse before choosing a source came back to a lit border with dead arrows
 *  (§ enter, docs/tui.md § Focus regions). */
const remember = (of: Memory, node: Renderable, frame: Renderable | null): void => {
  if (node === frame) return
  of.last = node
  of.lastIdentity = itemIdentities.get(node)
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

/**
 * Draw the caret, which is the one thing about focus the renderer still owns.
 *
 * `EditBufferRenderable.renderCursor` returns without drawing unless the renderer has focused the
 * node, so an `Input` this store has handed the keys to would draw its text and no caret. This is
 * the one mirror, it is paint state, and nothing reads it back.
 *
 * `CliRenderer.focusRenderable` blurs whatever it displaces, so one caret costs one call; the blur
 * is the other direction, the keys going nowhere. Both refuse a node whose `focusable` flag has
 * gone, which costs nothing, since the landing rule is about to take the keys off it anyway
 * (@opentui/core § Renderable.focus, ./stops.ts § pressable).
 */
const paintCaret = (previous: Renderable | null, node: Renderable | null): void => {
  if (node) node.focus()
  else previous?.blur()
}

/**
 * Move the keys, and tell everything that is drawn from where they are.
 *
 * The one writer. Deduplicated, because a move to where the keys already are is not a move: it
 * would reveal the stop again and rewrite the memory, and `enter` reads whether anything changed to
 * decide whether the landing rule owes the screen another look (§ enter).
 */
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
  revealInViewports(node)
  // And once more after the next layout, because the geometry this one read may not exist yet
  // (§ The second reveal).
  pendingReveal = node
  // One memory per move, and it belongs to whichever of the two levels holds the keys. A `Modal` or
  // an open `Menu` is drawn inside whatever region had them, so a region that also remembered a
  // dialog's rows would give the keys back to a destroyed row when the dialog closed rather than to
  // the trigger that opened it, and its claim would say the reader had changed region while they were
  // answering a dialog (docs/tui.md § Focus regions).
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

// ── The second reveal ─────────────────────────────────────────────────────────────────────────
//
// `scrollChildIntoView` compares a child's laid-out `y` against its viewport's, and `Renderable.y` is
// whatever the last completed layout pass left there — so for a row that did not exist in the
// previous frame the reveal above reads stale or zero geometry, scrolls by the wrong delta, and
// nothing corrects it. Asking again on the renderer's next `frame` is the answer, and it decides
// nothing about where the keys go: it only makes the viewport show where they already are
// (docs/tui.md § Scrolling viewports).
//
// Phase 1 of the terminal rewrite meant to delete this and let the settle pass reveal instead. It
// cannot: the pass is a microtask, so it runs before the next layout and reads the same stale numbers
// this one did. `../kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted`
// is the case, and it fails with this taken out. Phase 2 owns it, where layout and reveal are in one
// frame by construction (docs/future/terminal-rewrite/phase-2-the-painter.md).
//
// One renderer listener for the whole store rather than one per viewport, which is what the design
// first asked for. Every live `scrollbox` already carries a `selection` listener and a pull request
// draws enough of them that `RENDERER_LISTENER_CAP` is 200; one more each would double that count to
// do the same work this does once (../renderGuard.ts).

/** The node the post-layout reveal still owes a scroll to. One slot and not a queue: the reveal is
 *  about where the keys are now, and where they were two frames ago is nobody's question. */
let pendingReveal: Renderable | null = null

// ── Clicks are hit tests ──────────────────────────────────────────────────────────────────────
//
// The renderer resolves which renderable the pointer was over; what that means is the store's. It
// used to be the renderer's too — `dispatchMouseEvent` walks up from the hit renderable and focuses
// the first focusable ancestor, and `autoFocus` defaults to true — which is a second opinion about
// focus for exactly the case this module exists to have one answer to. So the flag is off wherever a
// renderer is built, in ../main.tsx and in both harnesses, and this replaces it.
//
// A click focuses a clicked stop and scrolls, and does nothing else, which is the pointer rule this
// host already states (docs/tui.md § What the TUI never does). Pressing what was clicked stays the
// stop's own, from its `onMouseDown` (./stops.ts § pressable).

/** Focus the nearest thing above a left click that could hold the keys, or nothing at all.
 *
 *  `reachable` is the whole of "is this a stop": a stop, a collection row, a region's frame and a
 *  scope's box are the focusable things in the tree and nothing else is. It answers for the top scope
 *  too, so a click behind an open dialog reaches nothing rather than past it (§ Scopes). */
const focusClicked = (event: MouseEvent): void => {
  if (event.button !== MouseButton.LEFT) return
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

/** Point the store at a renderer: where a click landed, and the frame the second reveal waits for.
 *  Called by `installKeymap`, because "install the keyboard on this renderer" is one thing and where
 *  the keys are is half of it (./install.ts). */
export function installRegions(renderer: CliRenderer): void {
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
  // would read the same stale numbers the synchronous reveal already read (§ The second reveal).
  const afterFrame = (): void => {
    const node = pendingReveal
    pendingReveal = null
    // Still there and still holding the keys. A frame later either can be false: the reconciler
    // destroys a removed renderable on `process.nextTick`, and a landing may have moved on.
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

/**
 * Put the keys on a renderable and say whether they went.
 *
 * The one door. Every move comes through here, so every caller learns whether the keys went rather
 * than assuming: a refused move is a `false` to walk on from instead of a highlight nobody can
 * answer. It is refused for the two reasons the store has, not on screen and not something that can
 * hold the keys, and for nothing else — there is no renderer left to say no.
 */
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
  const node = of.lastIdentity ? itemsByIdentity.get(of.lastIdentity) : of.last
  return reachable(node) && !onPlaceholder(node) ? node : undefined
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
    // The row that had the keys is going. Look again once reconciliation has produced the
    // replacement, because at cleanup time the old row still reports itself live even though its
    // disposal has begun, so nothing else on this turn would notice (§ The landing rule).
    if (focusedNode() === box) scheduleSettle()
  })
}

// Which renderable is a collection's container, and which of its rows is the roving one. A list is
// one stop from outside — a reader walking a panel passes it once, and its own collection layer takes
// the arrows from there — so the reading-order walk has to be able to say "this box is a list"
// without asking the kit what node drew it, the same way `items` says "this box is a row".
type ContainerEntry = {
  box: Renderable
  active: () => Renderable | undefined
  expands: () => boolean
}

let containers: ContainerEntry[] = []
// And by their box, for the same reason the regions are: `stopsIn` asks "is this child a collection"
// of every node it visits (§ The step counter).
let containerByBox = new Map<Renderable, ContainerEntry>()

/** Called by a collection for its container (./collection.ts).
 *
 *  `active` is the row the caret is on. `expands` is whether the collection folds its rows, which is
 *  a question about the horizontal pair rather than about focus: a tree row's Left and Right fold and
 *  a plain list's bubble to the region tier and move a column, and the footer has to say which
 *  (§ focusedExpands, ../chrome/bindings.ts). */
export function markCollection(
  box: Renderable,
  active: () => Renderable | undefined,
  expands: () => boolean = () => false,
): void {
  const entry: ContainerEntry = { box, active, expands }
  containers.push(entry)
  containerByBox.set(box, entry)
  onCleanup(() => {
    const at = containers.indexOf(entry)
    if (at >= 0) containers.splice(at, 1)
    if (containerByBox.get(box) === entry) containerByBox.delete(box)
  })
}

/** Whether the collection the keys are in folds its rows.
 *
 *  Asked by the footer, which says `fold` beside `h/l` where it is true and `column` where it is not.
 *  The answer is the collection's own and not the row's: a tree passes `onExpand` for the whole list
 *  (../chrome/bindings.ts, client-core kit/keys/collectionIntents.ts § expand). */
export const focusedExpands = (): boolean => {
  const node = focusedNode()
  if (!node) return false
  for (let at: Renderable | null = node; at; at = at.parent) {
    step()
    const container = containerByBox.get(at)
    if (container) return container.expands()
  }
  return false
}

// ── Reading the tree ──────────────────────────────────────────────────────────────────────────

const walk = (box: Renderable, take: (child: Renderable) => boolean): Renderable | undefined => {
  for (const child of box.getChildren()) {
    step()
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
    step()
    if (isViewport(at)) at.scrollChildIntoView?.(node.id)
  }
}

/** Whether a box is some parent stop's panel, and so belongs to the level below this walk.
 *
 *  One lookup. It was a scan of every parent stop, each of which allocated its panel list to answer,
 *  and it is asked of every child of every walk (§ panelBoxes). A strip is never its own panel, which
 *  the scan said out loud and the set says by construction: `registerPanel` marks panels and
 *  `markParent` marks strips. */
const isPanel = (node: Renderable): boolean => panelSet().has(node)

/**
 * Reading-order stops inside a box, in reading order.
 *
 * Exported for two callers outside this module: a `Menu`'s open list moves between its own stops
 * while its scope holds the keys, and the stops behind it are not its to walk (./stops.ts).
 *
 * Six rules, and each one is a level of the model showing through:
 *
 *   another region     walked through, as it was before its frame became focusable. A region is a
 *                      level of its own, reached with Tab. The walk starts at a box's children, so a
 *                      region's own frame is never a stop inside itself and this is about nesting.
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
      step()
      if (!child.visible || child.isDestroyed || isPanel(child)) continue
      if (groupByBox.has(child)) {
        visit(child)
        continue
      }
      if (parentByNode.has(child)) {
        found.push(child)
        continue
      }
      const container = containerByBox.get(child)
      if (container) {
        // A virtual list whose active row is off its drawn window has no renderable for it, and the
        // container itself holds the keys until one arrives (../kit/showing.tsx § Rows).
        const row = container.active()
        if (row && !row.isDestroyed && row.visible) found.push(row)
        else if (child.focusable) found.push(child)
        continue
      }
      if (isViewport(child)) {
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
  // Either answer only counts while the keys can reach it. A dialog drawn inside a region has that
  // region as an ancestor, and the stops behind the dialog are not its neighbours (§ Scopes).
  for (let at: Renderable | null = node; at; at = at.parent) { step(); if (isPanel(at)) return inScope(at) ? at : undefined }
  const group = regionOf(node)
  return group && inScope(group.box) ? group.box : undefined
}

// ── Moving ────────────────────────────────────────────────────────────────────────────────────

/**
 * Step from one stop to the next inside a box, and say whether the keys moved.
 *
 * The one walk. Three of them used to index into `stopsIn`: the reader-facing arrows, a tab strip's
 * Down, and a `Menu` list's own arrows. Each had picked up its own answer to what an edge does, which
 * is how one key came to mean three things at three levels of one screen.
 *
 * `within` defaults to the neighbours of `from`: the panel it sits in, else its region's box. A
 * caller passes one only where the walk is not about the tree the node sits in, which is an open list
 * holding a scope of its own.
 *
 * `false` at an edge, and `false` when the walk does not contain `from` at all, which a collection's
 * row and a region's frame do not, so the key carries on to the tier that does own it. Whether a
 * caller turns that into a wall is the caller's.
 *
 * `wrap` has no caller yet: every stop walk on this screen walls or bubbles, and only a collection
 * wraps, by its own rules. It is here because the key contract decides which walks wrap
 * (docs/tui.md § The five key groups).
 *
 * `stops` is the same walk already made. A caller that had to ask `stopsIn` a question before it
 * could decide to move — which is `moveStop`, and it is the reader's arrows — passes the answer in
 * rather than paying for the subtree twice per key press.
 */
export function walkStops(
  from: Renderable | null | undefined,
  delta: 1 | -1,
  options: { within?: Renderable; wrap?: boolean; stops?: readonly Renderable[] } = {},
): boolean {
  if (!from) return false
  const box = options.within ?? boxAround(from)
  if (!box) return false
  const stops = options.stops ?? stopsIn(box)
  const at = stops.indexOf(from)
  if (at < 0) return false
  const next = options.wrap ? stops[(at + delta + stops.length) % stops.length] : stops[at + delta]
  return focusRenderable(next)
}

/**
 * The reader-facing arrows: the next or previous stop beside the focused one, walling at an edge.
 *
 * A wall is `true` and nothing moved, the same answer a tab strip gives at its last tab. Letting a
 * failed Down bubble to the region tier would make an arrow cross regions, which is Tab's job and
 * which surprised readers the one time a strip did it. So the `|| true` below is a claim on a key
 * that moved nothing, and it stays because an arrow edge is a wall on purpose
 * (docs/tui.md § The five key groups).
 *
 * The wall is here rather than in `walkStops` because the walk answers `false` for two things and
 * only one is an edge: a stop the walk does not contain has to bubble to the tier that does own it,
 * so the membership check below is what keeps the wall off that case.
 */
export function moveStop(delta: 1 | -1): boolean {
  const node = focusedNode()
  // A row of a collection is in the walk — a list is drawn there as the row its caret is on — and it
  // is still not this function's to move. The list owns its own arrows and wraps by its own rules.
  if (!node || items.has(node)) return false
  const box = boxAround(node)
  if (!box) return false
  // One walk. The membership question and the move are the same list, and asking twice was a subtree
  // walk per key press for nothing (§ walkStops).
  const stops = stopsIn(box)
  if (!stops.includes(node)) return false
  return walkStops(node, delta, { within: box, stops }) || true
}

/**
 * Put the keys in a region, on the best thing it has: where it left them, else its entry stop, else
 * its own frame. The frame is the last resort as it is on the DOM, so a region with nothing focusable
 * in it is still reachable and the cycle has no hole.
 *
 * Nothing here writes the region's memory or its claim. Both belong to the renderer event listener,
 * so both are written when the move happens rather than when it is asked for: `enter` used to write
 * them from its target, and a target whose `focus()` was refused then left the store pointing at a
 * region the keys were not in, so the first Tab after that looked lost
 * (docs/tui.md § Focus regions).
 */
const enter = (group: Group | undefined): boolean => {
  if (!group) return false
  const target = remembered(group) ?? entryStop(group.box) ?? group.box
  const before = focusedNode()
  focusRenderable(target)
  if (group.pickOnEnter && focusedNode() === target) itemPicks.get(target)?.()
  // Look again where the keys went somewhere new: a walk into a region whose list has not arrived
  // lands on its frame, and the pass is what takes them off it once the list does. A move that
  // changed nothing is not worth a second look, and scheduling one would be a loop.
  if (focusedNode() !== before) scheduleSettle()
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

/**
 * Move one column left or right, without wrapping.
 *
 * The nearest column in the direction asked, which is what makes the number an ordering rather than
 * a name: the rail is 0, a layout's regions are 1, and a layout that draws two frames side by side
 * declares its second one 2, so one rule crosses the rail-to-pane edge and the list-to-detail edge
 * alike. Left in the rail and Right from the rightmost column do nothing, deliberately: a key that
 * jumps across the whole screen from an edge is a surprise, and Tab already cycles
 * (docs/tui.md § Focus regions).
 *
 * The destination remembers the group last used in that column. On a first visit it enters the first
 * region the shell does not call chrome, which is how a first crossing into the pane skips the pane
 * strip above it (../chrome/topology.ts § skips).
 */
export function moveColumn(delta: 1 | -1): boolean {
  const current = groupAt(focused)
  if (!current) return false
  // `ordered()` rather than `groups`, so both the columns and the memory answer for a region that is
  // still registered *and* still in scope. Out of scope it is the region behind a dialog (§ Scopes).
  const reachable = ordered()
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

/**
 * Queue the one deferred focus decision.
 *
 * A microtask rather than a frame event: OpenTUI emits per frame, but a test renderer under `flush()`
 * may render several times before one, and a pass that waits for a frame waits for the wrong thing.
 * Solid commits synchronously, so the renderables of the current render all exist at the end of the
 * current task — which is exactly when a microtask runs. Guarded, so six callers in one turn settle
 * once.
 *
 * A tree to read is the whole of what it buys. It orders nothing against the reconciler's
 * `process.nextTick` destruction, which is Suspense's and stays Suspense's: nothing here depends on a
 * corpse still reporting itself live, `pushScope`'s pop takes the keys out of a box that is going,
 * and the keys going nowhere asks for a pass of its own (§ The one owner, ../kit/reconciler.ts).
 */
export function scheduleSettle(): void {
  if (settleQueued) return
  settleQueued = true
  queueMicrotask(() => {
    settleQueued = false
    ensureFocus()
  })
}

/**
 * Whether the keys are on a stand-in that something better has since replaced.
 *
 * Two things here are focusable so they can hold the keys when nothing else can, and both stop being
 * the right answer the moment their contents arrive: a region's frame, which is `enter`'s last resort
 * while a `lazy()` region or its query is on its way, and a collection's container, which `stopsIn`
 * draws in place of an active row a virtual window has scrolled off. A reader sees the same thing
 * either way: a lit border, no caret, dead arrows.
 *
 * Asked of the tree rather than remembered, which is what the `provisional` boolean did: a fact about
 * the tree kept beside the tree is a fact that can disagree with it.
 */
const onPlaceholder = (node: Renderable): boolean => {
  const group = groupByBox.get(node)
  if (group) return !!entryStop(group.box)
  const container = containerByBox.get(node)
  return !!container && reachable(container.active())
}

/**
 * One question, then one landing.
 *
 * The question is about the renderable that has the keys. Can it still hold them, meaning alive,
 * visible all the way up, focusable and inside the top scope, and is it the real thing rather than a
 * stand-in? If so, reveal it and stop.
 *
 * If not, land. A scope holding the keys takes the stop it last had, then the first stop inside its
 * box, then the box itself. On the screen a region answers first: the region that still claims the
 * keys, else the one the shell opens on, else the first one drawn; and inside whichever answers,
 * `enter` takes the stop it last had, its entry stop, its frame.
 *
 * This replaced a pass of seven ordered steps over four module variables. Each step had been a
 * correct fix for a real bug; together they were a state machine nobody had written down, and the bug
 * they produced was always the same one: two steps ran in an order the author had not pictured, and
 * the reader got a lit frame with no caret or a caret on a destroyed row. Every path lands the same
 * way now, so a bug in landing is one bug (docs/tui.md § Focus regions).
 */
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

/**
 * Every stop on screen, region by region, in the order the regions draw.
 *
 * Test-only, and the walk is `stopsIn` applied to each region's box rather than a second one — so a
 * panel's contents are not here, because a panel is the level below a region's own list and is
 * reached by entering the parent stop that owns it. The reachability property reads this
 * (../reachability.test.tsx).
 */
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

/**
 * Which columns the keys can reach, and which of them they are in.
 *
 * Test-only. The reachability property presses `l` and `h` on every kind of focused thing it met and
 * asks whether the footer's word came true, and for `column` that means the keys are in a different
 * one — with an edge as the only reason they are not, because there is no wrap
 * (../reachability.test.tsx, docs/tui.md § The invariants, invariant 11).
 */
export function _columns(): { at: number | null; all: readonly number[] } {
  return {
    at: groupAt(focused)?.x ?? null,
    all: [...new Set(ordered().map((group) => group.x))].sort((a, b) => a - b),
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
  parents = []
  parentByNode = new Map<Renderable, ParentEntry>()
  panelBoxes = null
  setScopes([screenScope()])
  orderedCache = null
  containers = []
  containerByBox = new Map<Renderable, ContainerEntry>()
  visited = 0
  items = new WeakSet<Renderable>()
  itemIdentities = new WeakMap<Renderable, string>()
  itemsByIdentity.clear()
  setFocus(null)
}
