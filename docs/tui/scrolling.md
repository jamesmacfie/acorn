# Terminal collections and scrolling

This page covers lists and scrolling in the terminal client: collections, scroll viewports, the agent
transcript, and the diff window. It's part of [the terminal client](../tui.md).

## Collections

The intent half of a collection is shared (`packages/client-core/src/kit/keys/collectionIntents.ts`).
The element half has a DOM file and `apps/tui/src/keys/collection.ts`, where "focus the active item"
calls the store's `focusRenderable`. A virtual `Rows` owns its visible window: keyboard movement
reveals the active key by the smallest step, and the wheel moves the window without changing the key.
`Grid` keeps its exception: a virtualized row has no node, so the arrows move `selected` and the view
follows.

`Timeline` goes the other way. The shared focus-role table calls it a collection, and the desktop roves
over its turns. Here a turn is a `Card`, a stop only where it takes an `onPress`. So the stops in a pull
request conversation are the controls and composers inside the turns, and you read the text between
with the page keys.

Moving the caret selects. Every `Rows` on this host passes `selectOnMove`, because with no pointer the
caret is the selection. Only `onSelect` fires on a move, and `onActivate` waits for Enter, so showing
is immediate and opening is deliberate. A list without `onSelect`, such as the task list, gets nothing
new. Arriving on a row isn't a move, except that Menu and Browse run the collection's `goTo` for the
row they land on, including a row that arrives after a query. Menu waits for its provider and
workspace-link gates, then highlights and shows the first source together. Its place is scoped by
workspace, and a workspace switch clears the old view before publishing the new list.

## Scrolling viewports

Anything that can outgrow its box is a viewport. `overflow="scroll"` isn't one: it's a Yoga clipping
instruction, and it owns no offset, so a caret walking below the fold isn't followed. A region body
that can grow past its frame is a `ScrollViewport` or a `Rows virtual`.
`apps/tui/src/kit/scrolling.tsx` is the one file under `apps/tui/src` allowed to spell the clip, and
`apps/tui/src/invariants.test.ts` checks that.

`apps/tui/src/kit/scrolling.tsx` owns non-virtual scrolling: the vertical offset, the scrollbar, wheel
and trackpad acceleration, and the clamp. The node carries the offset as a prop that paint translates
its children by. Its `Viewport` type is what the key tables, the store's reveal, and `DiffPane` ask of
a viewport. A viewport is the fallback stop for a document with no controls. When it holds a real stop,
it's transparent to focus, and a focused child is revealed through every scroll ancestor with
`scrollChildIntoView`. A viewport that hides asks for a landing pass ([focus](./focus.md)).

A region that clips beats a region that scrolls wherever the pane pins something. The `list-detail`
detail column clips, and what's inside it scrolls, as on the desktop, where `.layout-region-detail` is
`overflow: hidden`. Otherwise the agents composer, the column's last child, would scroll away with the
transcript. The transcript owns its scroll through `Timeline follow`, and the diff through `DiffPane`.
A clipping region puts a line between its children, and a `Textarea` draws a frame that lights in the
accent tone while it has the keys.

`Timeline follow` stays on the last turn while you're at the foot, and lets go when you scroll up.
`place()`, the one way the offset changes, decides that. It reacts to the height of the box sized by
the turns, not the box that fills the region, so opening a menu doesn't drag the view down. Unlike the
desktop, it doesn't restore you to the turn you left. Finding a turn needs per-turn geometry a viewport
doesn't publish, so `NODE_SUPPORT` marks the node `reduced`: a list drawn again opens at the newest
turn. A mounted viewport keeps its offset.

A viewport's height comes from `flexBasis: 0` on a flex line, and the content inside is free-sized, so
a viewport nested in a viewport has nothing to bound it. One scroller per column, and the pane says
which node it is.

A page key clamps instead of wrapping. `pageNext` goes to the last row and `pagePrev` to the first,
and each hands the key back once there, so the viewport below scrolls. This is in the shared
`collectionIntents.ts`, so the desktop does the same. The arrows still wrap.

The reveal runs once per frame, on the renderer's `frame` event, from the one listener
`apps/tui/src/keys/regions.ts` installs. It waits because `scrollChildIntoView` compares laid-out
positions, and a row that didn't exist last frame has stale or zero geometry. That happens on a freshly
mounted list, a refetch replacing a row, and a virtual window shift. A frame is layout then paint in
one function, so the reveal reads the geometry you're about to see.
`apps/tui/src/kit/scrolling.test.tsx § reveals the caret in a list that has only just mounted` pins it.

Arrows move and page keys scroll. Arrow keys and `j`/`k` scroll a viewport only while the viewport has
the keys, which happens only when the document holds no other stop. `pgup`, `pgdn`, Home, and End
scroll it from anywhere inside, so you can read the rest of a long panel without losing your place. A
collection inside answers those four first. A long description with a copy button at the top is read
with the page keys and the wheel.

### The diff window

`DiffPane` in `apps/tui/src/kit/showing/diffPane.tsx` is a viewport with a window inside it. It draws
from the same diff document as the desktop ([the diff document](../diff-rendering/document.md)): a
file header is one line and each segment is as many lines as its descriptor says. So it finds the slice
around the offset without any row existing, and asks only for the segments that slice reaches, once
each. A line whose segment hasn't arrived reads `loading…`, and boxes above and below stand in for the
rest. The scroll box still owns the offset, bar, wheel, and page keys.

The offset reaches the window two ways. The viewport's key handlers call an `onScroll` the pane passes
in. The wheel is caught on a box around the viewport, because a wheel step runs handlers from the
pointer's node upward, so a listener above sees the scroll after the offset moved
(`apps/tui/src/tree/hit.ts`). A spacer is one line per row and an annotated row draws two, so the
content can be taller than the model by the marked rows in the window. Loaded rows are keyed by path
and content key, and leaving the pane aborts segment loads in flight.

Virtual `Rows` sit outside that mechanism. They draw only their visible slice, and their own `top`
offset handles the wheel and draws the scrollbar thumb. The wheel can move the active row off screen
without changing the selection. The collection container keeps the keys, and the next keyboard move
reveals the active row.
