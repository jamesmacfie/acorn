/** @jsxImportSource @acorn/tui/jsx */
import type { Renderable } from './tree/compat'
import { createSignal, ErrorBoundary, Suspense, type JSX } from 'solid-js'
import { Line } from './kit/cells'
import { boxBorder, spaceLines } from './kit/roles'
import { ScrollViewport } from './kit/scrolling'
import { focusWithin } from './keys/regions'

// A frame with its name in the top border, lit while the keys are inside it.
//
// The one drawing primitive this host has that is neither kit nor layout. The chrome puts three of
// them down the left and each layout puts one round every region it draws, so it cannot live in
// either folder; it is not a kit node either, because no pane asks for it and the DOM has no answer
// for it — a desktop region is a landmark with a heading, and a landmark is exactly what a terminal
// has no way to announce except by drawing it.
//
// That correspondence is the whole design. The name in the border is the string the DOM host puts in
// `aria-label` (client-core/host/layouts/ListDetail.tsx), and the lit border is what `:focus-within`
// does to a region's edge on the desktop. Same two facts, one rendering each.
//
// **One level of frame, never two.** A frame costs two rows and two columns, and at 24 rows the body
// has 22 to spend. The chrome's three panels are leaves and a layout's regions are leaves; nothing
// wraps a frame round something that already has one. lazygit, which is where the shape comes from,
// draws no outer frame either.

/** A frame round a region. `title` is what the region is called; the border does the rest. */
export function Panel(props: {
  title?: string
  /** Runs with the frame's box, after this component has taken it. Where a caller registers its focus
   *  region, which is why it is a callback rather than `ref`: both want the same element. */
  onBox?: (box: Renderable) => void
  /** Fixed height in rows, borders included. Left unset the frame takes what its contents need; the
   *  panel that should get the slack passes `grow` instead. */
  rows?: number
  grow?: boolean
  /** The contents scroll as one region rather than clipping. The caller's own answer, kept because a
   *  region that scrolled before it was framed has to go on scrolling after. */
  scroll?: boolean
  children: JSX.Element
}) {
  const [box, setBox] = createSignal<Renderable | undefined>()
  const lit = () => focusWithin(box())
  return (
    <box
      flexDirection="column"
      // `flexShrink={0}` for the reason every block node in the kit has it: a terminal clips rather
      // than squeezing, and a frame given less than its border walks its own edge onto the row above
      // (kit/grouping.tsx).
      flexShrink={0}
      flexGrow={props.grow ? 1 : 0}
      // `flexBasis` 0 with the growth, so the panel's height is the room left over rather than the
      // room its contents want. Left at `auto` a growing panel is at least as tall as everything in
      // it, and `flexShrink={0}` above means nothing can take that back — so one long list pushed the
      // Tasks panel off the bottom of the screen and drew over the footer. A panel is a place on the
      // screen; what is in it clips or scrolls (docs/tui.md § The screen).
      {...(props.grow ? { flexBasis: 0 } : {})}
      {...(props.rows === undefined ? {} : { height: props.rows })}
      {...boxBorder('surface', { tone: lit() ? 'accent' : 'neutral' })}
      title={props.title}
      titleAlignment="left"
      ref={(element: Renderable) => { setBox(element); props.onBox?.(element) }}
    >
      {/* The contents clip inside the border rather than pushing it out: paint clips a child to its
          parent's content box, which a border is outside of, so this is the frame's own promise and
          not something each caller has to remember (`./paint/paint.ts`). */}
      {props.scroll
        ? <ScrollViewport>{props.children}</ScrollViewport>
        : (
          // A line between the region's children, which is `row-gap: var(--gap-stack)` on the
          // desktop's own detail region (client-core/infra/styles/shell.css § .layout-region-detail).
          // A clipping region stacks a pane's parts straight onto each other, and on the agents pane
          // that put a transcript, a row of provider pickers, an expand toggle and a message box in
          // one undivided pile. `rowGap`, not `gap`: Yoga's `gap` sets both axes and there is nothing
          // here to space sideways.
          <box flexDirection="column" flexGrow={1} rowGap={spaceLines('stack')} overflow="hidden">
            {props.children}
          </box>
        )}
    </box>
  )
}

/** A region's contents, with an answer for the two ways they can fail to arrive.
 *
 *  Both used to draw nothing at all, and a panel with nothing in it is the one failure a reader
 *  cannot tell from an empty list. A region's component is a `lazy()`, so the boundary round it
 *  decides what the panel shows while its chunk compiles; and a throw anywhere under it takes the
 *  whole subtree down, header and all, with the message going to a console this host has turned off.
 *  So each is a line, and the line says which one happened.
 *
 *  The message is drawn rather than logged on purpose. This host has one screen and no devtools; a
 *  reader who can read "Cannot read properties of undefined" off the panel can say so, and a reader
 *  looking at a blank frame can only say it is blank.
 *
 *  The stack goes to the console as well, which on this host is held until the screen is handed back
 *  and printed after it (`./main.tsx`). One line on a panel names the failure and cannot place it:
 *  `Stale read from <Show>.` is a real message from Solid that says nothing at all about which of the
 *  four hundred `<Show>` elements in the graph raised it, and without a frame to read there is
 *  nowhere else for a reader to look. Printing after the screen closes is what makes this safe; a
 *  write while the renderer owns the terminal is what garbles it. */
export function PanelBody(props: { name: string; children: JSX.Element }) {
  return (
    <ErrorBoundary fallback={(error: unknown) => {
      console.error(`[pane ${props.name}]`, error)
      return <Line role="muted" wrap>{error instanceof Error ? error.message : String(error)}</Line>
    }}>
      <Suspense fallback={<Line role="muted">Loading…</Line>}>{props.children}</Suspense>
    </ErrorBoundary>
  )
}
