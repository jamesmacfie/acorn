/** @jsxImportSource @opentui/solid */
import type { Renderable, ScrollBoxRenderable } from '@opentui/core'
import { createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { bindKeys } from '../keys/install'
import { scheduleSettle } from '../keys/regions'
import { PANE } from '../keys/tiers'
import { drawsOwn } from '../painter'
import { requestFrame } from '../tree/frames'
import type { Node } from '../tree/node'

// A constrained document viewport, under both painters.
//
// `overflow="scroll"` is a yoga clipping instruction and nothing more: it hides what will not fit and
// owns no offset for anything to move, which is why this file is the only one under `apps/tui/src`
// allowed to spell it and why `../invariants.test.ts` greps for that. A viewport belongs here, at the
// content body, rather than around a whole pane: a pane contains width-sensitive layouts and a
// free-sized pane wrapper makes those layouts measure a width that is not on screen
// (../chrome/PaneRow.tsx).
//
// **Two implementations, one contract.** OpenTUI's `ScrollBoxRenderable` owns an offset, a bar, wheel
// acceleration and clamping; under our painter the *component* owns all four and the node carries the
// offset as a prop paint translates by. The members the rest of this app reaches a viewport through
// are the same either way, which is what keeps the keys, the reveal and `DiffPane` one piece of code
// rather than two (§ Viewport). Phase 4 deletes the OpenTUI half
// (docs/future/terminal-rewrite/phase-3-widgets-and-the-pty.md).

/**
 * What this app asks of a viewport.
 *
 * OpenTUI's renderable answers all four already; ours are installed on the node by `ownViewport`
 * below, so the key tables and `./showing.tsx` never learn which painter drew them. `scrollTop` and
 * `scrollChildIntoView` go on the node beside these for the two callers that reach a viewport through
 * the tree rather than through this component: the store's reveal, and a pane that windows its own
 * content (../keys/regions.ts § revealInViewports, ./showing.tsx § DiffPane).
 */
type Viewport = {
  scrollBy: (delta: number, unit?: 'viewport') => void
  scrollTo: (to: number) => void
  scrollHeight: number
  viewport: { height: number }
}

// The arrows, while the viewport itself is the stop. It only is one where it holds no other stop
// (../keys/regions.ts § stopsIn), so these fire exactly where nothing better could have: a document of
// text with no controls in it.
const KEY_SCROLLS: readonly { key: string; move: (box: Viewport) => void }[] = [
  { key: 'up', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'k', move: (box) => box.scrollBy(-1 / 5, 'viewport') },
  { key: 'down', move: (box) => box.scrollBy(1 / 5, 'viewport') },
  { key: 'j', move: (box) => box.scrollBy(1 / 5, 'viewport') },
]

// The page group, wherever the keys are inside the viewport. Focus-within rather than focus, because
// the reader who most needs it is standing on a control halfway down a long panel and wants to see
// the rest of the panel without giving up their place: arrows move between stops, page keys scroll
// (docs/tui.md § Scrolling viewports).
const PAGE_KEYS: Partial<Record<Intent, (box: Viewport) => void>> = {
  pagePrev: (box) => box.scrollBy(-1 / 2, 'viewport'),
  pageNext: (box) => box.scrollBy(1 / 2, 'viewport'),
  first: (box) => box.scrollTo(0),
  last: (box) => box.scrollTo(Math.max(0, box.scrollHeight - box.viewport.height)),
}

/** Both key layers on the viewport, which is the half of this component that is the same under either
 *  painter. The keymap is acorn's, so the keyboard goes through the shared dispatcher rather than
 *  round it with an `onKeyDown`. */
function bindViewportKeys(box: Renderable, view: Viewport, scrolled: () => void): void {
  bindKeys(box, KEY_SCROLLS.map(({ key, move }) => ({
    key,
    cmd: () => { move(view); scrolled(); return true },
  // Both layers on the pane's own tier, below the collection: a list inside a viewport answers Home
  // and the arrows first, which is what a reader in a list means by them (../keys/tiers.ts).
  })), PANE, { mode: 'focus' })
  onCleanup(registerIntentLayer(box, Object.keys(PAGE_KEYS) as Intent[], (intent) => {
    const move = PAGE_KEYS[intent]
    if (!move) return false
    move(view)
    scrolled()
    return true
  }, { priority: PANE, mode: 'focus-within' }))
}

type ViewportProps = {
  children: JSX.Element
  visible?: boolean
  onBox?: (box: ScrollBoxRenderable) => void
  /** Called after this viewport moves its own offset, for a caller that windows its content and so
   *  has to know where the offset now is. The wheel does not come through here: it is caught on a box
   *  *around* this one, where it arrives after the offset has moved rather than before
   *  (./showing.tsx § DiffPane, ../tree/hit.ts § wheelAt). */
  onScroll?: () => void
}

/** The node under this one carrying that id, or nothing.
 *
 *  The store's reveal names the child by id, because OpenTUI's `scrollChildIntoView` took one and an
 *  id is minted per node per render (../tree/compat.ts). */
const descendant = (at: Node, id: unknown): Node | null => {
  if ((at as { id?: unknown }).id === id) return at
  for (const child of at.children) {
    const found = descendant(child, id)
    if (found) return found
  }
  return null
}

/**
 * Our painter's viewport: two nodes, and the offset lives in the component.
 *
 * The content is a node of its own because the two have to measure differently — the viewport takes
 * the height its flex parent gives it, and the content takes the height its own children need.
 * `flexShrink={0}` is the whole of that: with it Yoga reports the content's natural height and lets it
 * overflow, which is what there is to scroll. Without it the content is squeezed to the viewport and
 * there is nothing below the fold, which is exactly the `overflow="scroll"` failure this seam exists
 * to avoid.
 *
 * `flexGrow={1}` beside it is the other half and it is not decoration either: a virtual `Rows` asks
 * its parent for a height and windows to it, and inside a box only as tall as its children a
 * `flexGrow` child gets nothing, so the list drew no rows at all. Grown, the content is exactly the
 * viewport's height while it fits and its own height once it does not, which is the pair of answers
 * this needs.
 *
 * OpenTUI said that second half as `minHeight: '100%'`, and a percentage cannot say it here: the
 * viewport's own height comes from `flexGrow` inside its column, and Yoga resolves a percentage
 * against the height its *grandparent* offered rather than the height the viewport ended up with. So
 * the content came out one row taller than the viewport everywhere, which is a bar on every panel
 * that fits and a row of scroll in every document that does not — the `editor` golden caught it.
 *
 * Nothing on the node knows how to scroll. The offset is a signal here and a prop there, so a node
 * cannot be in a scroll state the component disagrees with, and paint reads one number
 * (docs/future/terminal-rewrite/phase-3-widgets-and-the-pty.md § Design).
 */
function ownViewport(props: ViewportProps): JSX.Element {
  const [offset, setOffset] = createSignal(0)
  let box: Node | undefined
  let content: Node | undefined

  /** The rows the viewport shows and the rows the content has, from the layout that ran this frame. */
  const fits = (): number => box?.rect.h ?? 0
  const total = (): number => content?.rect.h ?? 0

  /** Nought to the last screenful, and nothing outside it. Clamped on the way in rather than on the
   *  way out, so `scrollTop` is a number a caller can window its own content against
   *  (./showing.tsx § DiffPane). */
  const clamp = (to: number): number => {
    const most = Math.max(0, total() - fits())
    return Math.max(0, Math.min(Math.round(to), most))
  }
  const move = (rows: number): void => { setOffset((at) => clamp(at + rows)) }

  const scrollBy = (delta: number, unit?: 'viewport'): void => {
    if (unit !== 'viewport') { move(Math.round(delta)); return }
    // A fraction of the viewport, and never nought: a three-row panel would otherwise refuse a fifth
    // of itself and read as a dead key.
    const step = delta * fits()
    move(step < 0 ? Math.min(-1, Math.round(step)) : Math.max(1, Math.round(step)))
  }

  /** Show a child that is above or below the fold, from this frame's rectangles.
   *
   *  Which is the whole reason there is one reveal under this painter and two under the old one. The
   *  child's `y` already carries this viewport's offset, because the read-back is where the
   *  translation happens, and the read-back ran in the frame that is about to paint — so the
   *  comparison is against geometry that exists (../layout/pass.ts § A viewport moves its children,
   *  ../keys/regions.ts § The reveal). */
  const scrollChildIntoView = (childId: unknown): void => {
    const view = box
    const child = view ? descendant(view, childId) : null
    if (!view || !child) return
    const above = child.rect.y - view.rect.y
    const below = above + Math.max(1, child.rect.h) - view.rect.h
    if (above < 0) move(above)
    else if (below > 0) move(below)
  }

  const api = {
    scrollBy,
    scrollTo: (to: number) => { setOffset(clamp(to)) },
    scrollChildIntoView,
    get scrollTop() { return offset() },
    get scrollHeight() { return total() },
    get viewport() { return { height: fits() } },
  }

  // The offset into the node's props, where paint reads it, and a frame to draw the move.
  //
  // Written from an effect rather than spelled as a JSX attribute for one reason: while the switch
  // exists, tsc types every intrinsic in this package against OpenTUI's closed prop shapes whichever
  // painter the build picked, and `offset` is not one of them
  // (docs/future/terminal-rewrite/phase-2-the-painter.md § The ten-line colour adapter). It lands
  // where a JSX attribute would land and asks for the frame `setProperty` would have asked for.
  createEffect(() => {
    const node = box
    if (!node) return
    node.props.offset = offset()
    requestFrame()
  })

  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      width="100%"
      minWidth={0}
      minHeight={0}
      visible={props.visible ?? true}
      ref={(element: ScrollBoxRenderable) => {
        box = element as unknown as Node
        // Descriptors rather than a spread, or the three getters above would be copied as whatever
        // numbers they answered at mount, which before the first layout is nought.
        Object.defineProperties(box, Object.getOwnPropertyDescriptors(api))
        // A thunk rather than the handler itself, because `props.onScroll` is read every time the
        // keys move it rather than once at mount, and a caller is free to hand a different one.
        bindViewportKeys(element, api, () => props.onScroll?.())
        props.onBox?.(element)
      }}
    >
      <box
        flexDirection="column"
        alignSelf="flex-start"
        flexGrow={1}
        flexShrink={0}
        minWidth="100%"
        maxWidth="100%"
        ref={(element: Renderable) => { content = element as unknown as Node }}
      >
        {props.children}
      </box>
    </scrollbox>
  )
}

/** OpenTUI's viewport: the renderable owns the offset, the bar and the wheel, and this hands it the
 *  content box's props rather than drawing one. */
function nativeViewport(props: ViewportProps): JSX.Element {
  return (
    <scrollbox
      flexGrow={1}
      flexShrink={1}
      flexBasis={0}
      width="100%"
      minWidth={0}
      minHeight={0}
      scrollX={false}
      scrollY
      visible={props.visible ?? true}
      contentOptions={{ flexDirection: 'column', minWidth: '100%', maxWidth: '100%' }}
      ref={(element: ScrollBoxRenderable) => {
        bindViewportKeys(element, element, () => props.onScroll?.())
        props.onBox?.(element)
      }}
    >
      {props.children}
    </scrollbox>
  )
}

/** A vertically scrolling document/detail region with a bar and wheel/trackpad handling. */
export function ScrollViewport(props: ViewportProps) {
  // A hidden viewport is one of the two ways the keys can go off screen without anybody being told,
  // and it is the one a reader meets every day: `TabPanel` is this node, and switching a tab hides the
  // panel rather than unmounting it so the panel keeps its state. `visible` is per node, so setting it
  // false here leaves a focused descendant reporting itself focused and visible. Asking for a landing
  // pass is the whole fix, because the pass already walks the parents before it decides who can still
  // hold the keys. No microtask of its own: `scheduleSettle` owns the one there is, and the kit is
  // held to none (../keys/regions.ts § The landing rule, ../invariants.test.ts).
  createEffect(() => {
    if (props.visible === false) scheduleSettle()
  })
  return drawsOwn() ? ownViewport(props) : nativeViewport(props)
}
