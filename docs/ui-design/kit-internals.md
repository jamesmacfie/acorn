# How the kit is built

This page covers the kit's CSS layering and adoption rules, the behavior a node takes over from panes,
how `Timeline` keeps your place, and how `Markdown` renders. Read it before you change a kit
component's CSS or the timeline. It's part of [UI design](../ui-design.md).

## How the kit is built

`primitives.css` holds the shared CSS for the components in `kit/components/inputs/`,
`kit/components/content/`, and `kit/components/layout/`. The `kit/components/primitives.tsx` subpath
resolves to `primitives.ts`. Specificity is layered by convention:

- A node's base rule is a bare class, `(0,1,0)`.
- A variant adds an attribute, `(0,2,0)`.
- A style pack's override adds a `:root[data-style="x"]` prefix, `(0,3,0)`.

A pack wins because it's more specific, never because its stylesheet loads last.

No plugin draws a raw `div` or `span` (`tools/arch/primitiveAdoption.test.ts`). A plugin's tree is kit
nodes. A raw element is how a plugin reached a host class, and it can't cross to a worker. The rule
names those two tags only, because `section`, `table`, and `input` carry meaning. Two rules in
`tools/arch/boundaries.test.ts` hold the rest: no plugin ships a stylesheet, and no plugin mounts its
own Solid root, because a root the host doesn't know sits outside every focus group. The CSS clash and
`Checkbox` checks stay for the host's own code.

## Behavior a pane keeps redoing becomes a node's prop

Three props arrived with the agents pane, and each replaced machinery a plugin had copied:

- `Timeline follow` makes the timeline the scroller and keeps it on the newest turn until you scroll
  away. Both hosts put the scroller on the timeline and let the region around it clip, which keeps a
  pane's header and composer pinned ([terminal scrolling](../tui/scrolling.md) § Scrolling viewports).
- `Card focus` puts you on one card. A pane told "show this item" holds a key, and the kit gives it no
  class or ID to select on.
- `Rows` returns the same item object for an unchanged key, so a list rebuilt from a live store
  reconciles instead of remounting.

Both follow one rule: a background change never moves you. For `Card focus`, the reveal is dropped
when the caret is in a text box, because some callers hold `focus` as state, and a refetch would
re-issue a reveal nobody asked for.

### A place is a turn, not a pixel

For `Timeline follow`, your place is the turn the viewport starts in and how far into it, which is
`ReadingPlace` in `kit/lib/timeline/readingPlace.ts`. In a live transcript, everything above you
changes height: a message streams, a code fence grows, an image loads, highlighting lands. So restoring
your place is a correction measured against that turn's current position, not a pixel offset replayed.
Following is the same value's other case, `{ at: 'live' }`, not a separate flag.

The place changes only on your own gesture, and a gesture lasts a second. A list that shrinks makes the
browser clamp the offset and fire a scroll event, so a scroll with no gesture behind it changes nothing,
and the next frame puts you back. Focus counts as a gesture when it lands on a turn in the list.

The timeline's own scroll writes are marked until the next frame
(`kit/lib/timeline/scrollAuthor.ts`), but a marked event only counts as the timeline's while the view
is still where its write left it. Otherwise a scroll you make in the frame after a pin would be
dropped, and the next growth would pin you back to the bottom. A resize checks the same before it
pins, because WebKit can report a resize before the scroll event that caused it.

A list you have no place in opens at the foot, and so does one you were following. The timeline acts
on a place equal to the one it holds, because the caller reads its store again only when the view
changed, so two live places in a row are the feet of two different lists.

A scroller detached from the page and put back comes back at the top, with no scroll or resize event,
so the timeline watches its parent's children and runs the same correction. Solid is patched so a
`Suspense` boundary that has drawn never swaps back to its fallback (`patches/README.md`), which
removed the most common cause.

The timeline doesn't keep places. `place` and `onChange` hand them to the caller, because navigation
disposes a task's panes ([pane models](../panes/models.md)), and a map inside a kit node has no owner
to scope it. The agents plugin keeps them in
`plugins/agents/src/client/sessions/readingPlaceStore.ts`.

## Markdown renders block by block

`kit/lib/rendering/markdown.ts` exposes `renderBlocks(text)`, which returns one `{ key, html }` per
block, keyed by a hash of that block's source. `renderMarkdown` is that list joined. The component
keeps the element it rendered for each key, so an update replaces only blocks whose source changed.
Appending to a message changes one key, the last. Callers depend on this:

- Your text selection survives an update. The agent transcript updates a streaming message about 25
  times a second, and only the growing block's node is replaced.
- A copy button lives on its block, so it mounts once.
- A closed code fence is highlighted once. Behind that, `highlightToHtml` in
  `packages/client-core/src/infra/highlight/shiki.ts` keeps a small cache of fence HTML keyed by text
  and language.

The `images` option decides what an image becomes, and it's part of the block key:

- `inline` renders an `<img>`, for text a person wrote.
- `placeholder` renders the alt text and makes no request, for text a model produced, where a remote
  image could be a tracking pixel.
- `thumb` is `inline` drawn as a short cropped band, for a picture that stands in for a file, such as
  an attachment above its file name.

A fence takes its color from the theme. `highlightToHtml` asks Shiki for dual-theme HTML with
`defaultColor: false`, so each token carries both colors as `--l` and `--r`, and `.ui-markdown .shiki`
picks one with `light-dark()`, as `.diff-code span` does.

A closed ```` ```mermaid ```` fence becomes a diagram. `kit/lib/rendering/mermaid.ts` loads Mermaid
the first time a surface shows one, and draws it in Mermaid's light or dark theme to match the app.
The component redraws its diagrams when the appearance changes, because the colors are baked into
the SVG. A fence with no closing line is marked `data-open` and stays code, so a streaming message
draws its diagram once, when the fence closes. A diagram that doesn't parse also stays code, and the
copy button copies the source either way.

A diagram follows the same rule as a `placeholder` image. Mermaid's `strict` mode removes scripts, and
`scrubDiagram` then removes everything that could make a request or navigate: images, links, and CSS
that points outside the diagram. Plugin frames and the terminal client render fences as code.

A caller has to keep one rule: `text` is read in an effect, and a prop is a getter, not a memo, so the
effect runs whenever anything upstream changes. The guard on the last rendered string stops an
identical value from touching the DOM.
