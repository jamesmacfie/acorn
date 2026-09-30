# The closed UI kit

Part of [ui-design.md](../ui-design.md).

## The closed kit

Every component a plugin may draw with is in one list, in `packages/client-core/src/kit/`, reaching
plugins through `@acorn/plugin-api/ui`. The list is closed: a component's props are role tokens,
content, counts, booleans, and handlers, and never `class`, `className`, `style`, or a DOM attribute
passed through. `@acorn/plugin-api/ui/tokens` carries the role enums and the support matrix as data,
with no components on it, so a node-environment test can read them.

**A node earns its place only if all four of these hold.** The list is closed, so the interesting
question is what gets in, and this is the answer that keeps it small:

1. Two or more plugins need it, or one first-party pane cannot be expressed without it.
2. It has a written rendering at 80 columns by 24 rows in monochrome, and a component on the terminal
   host that draws it. If that sentence cannot be written, the thing is a rectangle, not a node.
3. Its props are semantic: tone, emphasis, size in three steps, grouping. Never a pixel, a colour, a
   class, or a style.
4. If it is an extension kind, one host-owned sentence describes it in the trust prompt, and a person
   would knowingly accept that sentence.

The same rule with the same four conditions applies to layouts, in
[docs/panes.md § Layout model](../panes.md#layout-model), where condition 2 is a written narrow and
terminal projection rather than one sentence.

Three things follow from closing it, and each has a test.

**A node takes a meaning, not a value.** `tone="danger"`, `gap="section"`, `size="sm"`. A plugin
never names a pixel, a colour, or a class, so the same tree can be drawn by a host with no pixels.
`kit/tokens/tokens.ts` declares the six enums and `kit/tokens/roles.ts` maps each role to a CSS custom
property and to a terminal value. That mapping is the only place outside a stylesheet that names a
custom property.

**A node says which hosts can draw it.** `kit/tokens/support.ts` holds a row per node with a `dom`
column and a `tui` column, at one of four levels: `full` draws it natively, `reduced` draws it with
named things missing, `fallback` draws a stated substitute, and `absent` draws nothing unless the
node has a `<Fallback>` child. A `reduced` row names what is missing in a `loss` beside its level,
because "named things" is the load-bearing half of that word and an author predicting a host should
not have to open a second file. The 80-column sentence for each one is in
[Every node at 80 by 24](../ui-design.md#every-node-at-80-by-24) in the UI design reference.

Which host a build draws to is `HOST` in the same file, supplied by the host package at build time,
because it is a fact about the bundle rather than about the run: `apps/desktop`'s Vite config defines
it `dom` and `apps/tui`'s defines it `tui`. Where nothing defines it — a test, a plain browser served
by a node — it is `dom`. `Only` and `Fallback` are the only things that read it, and that is the rule:
a node that wants to know which host it is on is a node about to draw something host-specific, and the
answer to that is a `<Fallback>` child, not a branch.

Two hosts exist, and both draw the whole kit. `dom` is the desktop and the browser, from
`client-core/host/tree/components.ts`. `tui` is the terminal, from `apps/tui/src/kit/components.tsx`,
since 2026-08-31 (`docs/tui.md`). The two tables have the same
keys as each other and as this matrix, held by `tools/arch/kitTable.test.ts`, so a node cannot be
added to one host and forgotten on the other, and nobody adds a node at all without deciding what it
does on a host with no pixels.

**The classes moved inward.** A kit component keeps its `ui-*` classes and styles its own children
by position, as in `.ui-code-wrap > .ui-btn`. Nothing exported accepts a class, `cx.ts` is internal,
and a pane that wants a control to look different asks for that in the kit rather than in its own
stylesheet.

**One node is a picture, and it is still a list.** `Graph` draws cards on a grid with the edges as
curves: the workflows editor authors a definition on it and the run pane watches a run on it. It is in
the kit rather than in the plugin because plugin client code may not emit raw DOM or SVG, and a canvas
is the one thing a terminal cannot draw — so admitting it meant writing both projections first. In
cells it is the indented list the editor already drew: the same cards, the same order, the same
selection, indented by rank instead of placed by coordinate. `kit/lib/layout/graphLayout.ts` is the geometry,
shared by both hosts, so the two cannot disagree about which card sits under which. Where a card goes
is a device preference the caller holds, never part of what it is drawing.

**One node is a box, and admits it.** `Rectangle kind="pty" | "webview" | "frame" | "editor"` is what
the kit offers a surface that owns its own pixels: a PTY, a webview, a plugin's iframe, a code editor.
The node owns the box and the keyboard contract, one tab stop from outside, Enter to hand the keys to
whatever is inside and Escape to take them back. What draws inside it is not the kit's business. Four
kinds and no fifth, because the name says what is in there and a kind a host does not know is a
rectangle nobody can project: on a terminal `pty` and `editor` are native and the other two draw their
`<Fallback>` child.

`mount` is how the thing inside gets its element. Everything a rectangle holds wants a DOM node of its
own, and each of the five sites used to write its own `<div ref={host}>` beside a stylesheet giving it
a size. The host draws the element and hands it over, which is why the terminal drawer, Docker's exec
tab, the browser preview, the editor pane and the host's document surface now spell no element and
ship no CSS between them.

`Only` and `Fallback` are the two host wrappers. `Only hosts={['dom']}` draws its children on the
named hosts and nowhere else. `Fallback forNode="Grid"` draws its children where the matrix says
this host cannot draw that node. Both are here before there is a second host, so a plugin can be
written against one before it arrives.

**A node has one name, and a handler has one of twelve.** Both fell out of the remote path, where a
node is a type string on a message port and a prop is JSON. A compound spelling has nowhere to put its
dot, so `Modal.Body`, `Modal.Actions`, `Tabs.Panel` and `Toolbar.Spacer` are also exported as
`ModalBody`, `ModalActions`, `TabPanel` and `ToolbarSpacer`; the dotted names stay as aliases because
they read better beside the node they belong to. And a callback prop is only sendable under one of the
kit's twelve semantic events, which is why `Modal` takes `onDismiss` rather than `onClose`, `Input` and
`Textarea` take `onChange` for the committed value rather than `onCommit`, and `Grid` takes `onSelect`
rather than `onSelectRow`. `ConfirmButton` sends `onConfirm` only after its own confirmation step. A
name outside the twelve — `onInput`, `onKeyDown`, `onPaste` — still works in the shell and is dropped
on the way to a sandbox, which is the honest answer: a terminal host has no paste event to deliver.

**Behaviour a pane keeps redoing becomes a node's prop.** Three arrived with the agents pane, and each
replaced a copy of the same machinery in a plugin. `Timeline follow` makes the timeline the scroller
and keeps it on the newest turn until the reader scrolls away, with the place they left held per
`viewKey`; the transcript had 80 lines of that and github's conversation will want it too. Both hosts
put the scroller on the timeline and let the region around it clip, which is what keeps a pane's
header and composer pinned where the reader can reach them ([tui.md](../tui.md) § Scrolling viewports). `Card focus`
puts the reader on one card, which is the same argument that made collection state the host's: a pane
told "show this item" holds a key and nothing else, and the kit gives it no class and no id to select
on. `Rows` hands back the same item object for an unchanged key, so a list rebuilt from a live store
reconciles instead of remounting, which is what used to replace a row several times a second while an
agent was fanning out.

Both of those props answer to the same rule: **a background change never moves the reader.** For
`Card focus` it means the reveal is dropped outright when the caret is in a text box: some callers hold
`focus` as state rather than issuing it as a command, so a list that refetches rebuilds its rows and
re-issues a reveal nobody gave, and the person who finds out is the one whose sentence lost the caret.

For `Timeline follow` it means **a place is a turn, not a pixel.** "Two thousand pixels down" only
means something while everything above those two thousand pixels keeps its height, and in a live
transcript nothing does: a message keeps streaming, a code fence grows, an image loads, highlighting
lands a frame or two after the paint. So the reader's place is the turn the viewport starts in and how
far into it, which is `ReadingPlace` in `kit/lib/timeline/readingPlace.ts`, and putting them back is a
correction measured against that turn's current position rather than an offset replayed. Following is
the same value's other case, not a flag beside it, because the two used to be kept in agreement by
hand and every defect found in that code was them disagreeing.

The place only changes on the reader's own gesture, and a gesture lasts a second. A list that shrinks
makes the browser clamp the scroll offset and fire a scroll event that by position is
indistinguishable from someone scrolling, so a scroll with no gesture behind it changes nothing and
the next frame puts the reader back: on their turn, or on the foot if they were following. The second
counts for as much as the gesture does. Most input scrolls nothing at all, a click into a card or a
drag across a line, so the gesture it armed used to sit there until something else moved the view, and
that move was then filed as the place the reader chose. Focus counts as a gesture when it lands on a
turn in this list, because revealing a card scrolls it into view and then focuses it.

The timeline's own moves are told apart from the reader's by where they left the view, not only by
when. Each write marks scroll events as the timeline's own until the next frame. But the browser sends
one scroll event per frame, whatever moved the view, so a reader who scrolls in the frame after a pin
shares the pin's event. While a card was streaming, that event was dropped as the timeline's, and the
next growth pinned the reader back to the bottom. So a marked event only counts as the timeline's
while the view is still where its write left it, read back after the write so clamps and rounding are
already in it. A resize checks the same thing before it pins, because WebKit can report a resize
before the scroll event for the move that caused it.

A list that the reader has no place in opens at the foot, and so does a list they were following.
Those two are the same value, `{ at: 'live' }`, which is also why the timeline acts on a place equal
to the one it already holds: the caller only reads its store again when the view has changed, so two
live places in a row are the feet of two different lists. Treating that as nothing to do left a reader
who switched sessions sitting at the old transcript's offset, partway down one they had never seen.

One move has no signal of its own: the page taking the list away and putting it back. A scroller that
was detached comes back at the top, and the browser reports neither a scroll event nor a resize for
it, so the timeline watches its parent's children for that and runs the same correction it runs for
every other move nobody asked for.

What produced it was the `Suspense` around every pane region ([panes.md](../panes.md)). A query in the
region reading an empty cache suspends that boundary *after* it has drawn, so every child left the
document for the length of the fetch, and a reader who created a task from a pull request watched the
diff appear and then go. Solid is patched so a boundary that has drawn never swaps back to its
fallback (`patches/README.md`), which leaves the boundary covering the module it was put there for and
nothing else. The timeline keeps its observer, because re-parenting is not only that boundary's to
do.

The timeline does not keep the places. `place` and `onChange` hand them to the caller, because
navigation disposes a task's panes on purpose ([panes.md](../panes.md)), so a place kept in the
component is a place lost on every workspace switch, and a map hidden inside a kit node has no owner to
scope or clear it. The agents plugin owns them, beside the drafts, in
`plugins/agents/src/client/sessions/readingPlaceStore.ts`.

**A prop that has to hold an element has a data form beside it.** `ListDetail`'s `list` prop cannot
cross, so `ListColumn` and `DetailColumn` are children; `Picker`'s `results(query)` callback cannot, so
`items` is a list it filters itself; `DescriptionList.Item` children cannot, so `Facts` takes
`{ label, value }` pairs. The callback forms stay for shell code, which is where the extra power is
actually used.

### The three kit invariants

Modelled on `styles/tokenAxes.test.ts`, which reads the stylesheets and asserts they agree with the
declared axes:

- `kit/tokens/support.test.ts` reads the `/ui` barrel and asserts that the nodes it exports and the rows
  in `NODE_SUPPORT` are the same list, with a `tui` level on every row.
- `kit/tokens/roles.test.ts` asserts that every role in every enum has a DOM value and a terminal value,
  and that each DOM value names a token `tokenAxes.ts` declares.
- `kit/tokens/props.test-d.ts` is a type-level test: no exported node's props accept `class`,
  `className`, `style`, or `classList`, and no role-typed prop accepts an arbitrary string. It has
  nothing to run. `tsc --noEmit` across every package is the check, which `pnpm lint` already makes.

### How the kit is built

`primitives.css` holds the shared CSS for the components in `kit/components/inputs/`,
`kit/components/content/`, and `kit/components/layout/`. The `kit/components/primitives.tsx` package
subpath resolves to `primitives.ts` and keeps the established import contract.
Specificity is layered by convention: a node's base rule is a bare class, `(0,1,0)`;
a variant selector adds an attribute, `(0,2,0)`; a style pack's override adds a
`:root[data-style="x"]` prefix, `(0,3,0)`. A pack wins because it is more specific, never because its
stylesheet loads last.

`kit/lib/adoption.test.ts` was a migration ledger: a list of files someone had converted, each checked for
raw controls. Phase 9 of the layout programme finished the conversion and inverted it, so what is left
are rules rather than a list. **No plugin draws a raw `div` or `span`.** A plugin's tree is kit nodes,
and a raw element is how a plugin used to reach a class in the host's stylesheet. It is also the one
thing that cannot cross to a worker, so a plugin that emits one has written something a loaded plugin
could not. The rule names those two tags and not `section`, `table` or `input`, which are markup with
meaning rather than markup with a class. Two arch rules in `tools/arch/boundaries.test.ts` hold the
rest: **no plugin ships a stylesheet**, and **no plugin mounts a Solid root of its own**, because a
root the host does not know about sits outside every focus group and no intent reaches it.

The CSS clash and Checkbox checks stay, for the host's own code. Core still writes elements and
stylesheets and can still lose a rule to a primitive's own attribute selector.

**`Markdown` renders block by block, and that is a contract rather than an optimisation.**
`kit/lib/rendering/markdown.ts` exposes `renderBlocks(text)`, which returns one `{ key, html }` per block with
the key hashed over that block's own source, and `renderMarkdown` is now that list joined. The
component keeps the element it rendered for each key, so an update replaces only the blocks whose
source moved: appending to a message changes exactly one key, its last. Three things follow, and every
caller depends on at least one of them.

- **A reader's text selection survives an update.** Rewriting `innerHTML` replaces every text node
  underneath it, and the agent transcript updates a streaming message about 25 times a second. Only
  the growing block's node is now replaced.
- **A copy button lives on its block**, so it is mounted once rather than disposed and re-created on
  every tick.
- **A closed code fence is highlighted once.** Its block keeps its element, so nothing asks the
  highlighter again. Behind that, `infra/highlight/shiki.ts`'s `highlightToHtml` keeps a small
  first-in-first-out cache of fence html keyed by the exact text and language, which catches the same
  fence coming back after a scroll or a remount.

The `images` option decides what an image in the source becomes, and the flavour is part of the block
key, so two surfaces sharing the cache cannot share a block. `inline` renders an `<img>`, for text a person
wrote. `placeholder` renders the alt text and never issues the request, for text a model produced,
where a remote image is a tracking pixel carrying the reader's IP. `thumb` is `inline` drawn as a short
band across whatever holds it and cropped to fill, for a picture that stands in for a file rather than
being the content: an attachment above its filename, where full size would push the rest of the card off
screen.

A fence takes its colour from the theme rather than from Shiki. `highlightToHtml` asks for the
dual-theme html with `defaultColor: false`, so each token leaves carrying both colours as `--l` and
`--r` and none of them leaves carrying a fixed one, and `.ui-markdown .shiki` picks a side with
`light-dark()` the way `.diff-code span` does. Shiki's default writes the light colour into `color`
and hides the dark one in a `--shiki-dark` that no stylesheet here reads, which is how a fence under a
dark theme came to draw github-light on a white background.

The one rule a caller has to keep is the one the component already had: `text` is read in an effect,
and a prop is a getter rather than a memo, so the effect re-runs whenever anything upstream ticks. The
guard on the last rendered string is what stops an identical value from touching the DOM at all.

### What the kit refuses

Each of these will be asked for again and the request will sound reasonable, so the argument is
written down once. The security-shaped refusals — an iframe inside an iframe, free `postMessage`
between plugin origins, nested slots, reopening `frame-src` — are in
[docs/security.md](../security.md), and the plugin-shaped ones in
[docs/plugins.md](../plugins.md).

**Styling props on kit nodes.** No `class`, `className`, or `style`, including "just for desktop" and
"just for first-party". The moment a plugin can name a pixel or a colour, the kit stops being portable
and a terminal host has to guess what was meant. Desktop visual tuning moves into the kit's own CSS,
once per component. A plugin that needs its brand purple has a rectangle, priced honestly as
DOM-only.

**Raw scale values in a plugin-facing enum.** `space.row`, never `space.3` or `gap: 8`. A scale step
is a value; a role is a meaning. Each host maps roles to its own values, and a terminal has no value
for `8`.

**Plugin-positioned layout.** A plugin picks a layout and fills regions. It never says where a region
goes, how wide it is, or which way things flow. `orientation`, `columns` and `width` knobs are
refused; a new named layout is the answer when eight is not enough. Position is in the name, which is
the rule templates set before there were layouts.

**Anything that depends on hover.** Hover exists on a DOM host with a pointer and nowhere else. The
kit uses it for affordance only, and everything reachable on hover is reachable by focus.
`kit/tokens/hover.test.ts` reads the stylesheets and fails if a `:hover` rule reveals something no
`:focus-within` rule reveals. A `RowActions` that appears only on hover is a bug, not a style.

**Controlled and uncontrolled selection mixed on one node.** The host owns `selected` by default; a
node that declares controlled mode is controlled for every operation. Never half. Supporting both on
one node is a steady source of bugs in every library that has tried it.
