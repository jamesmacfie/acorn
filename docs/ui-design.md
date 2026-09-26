# UI design

acorn's UI is a dense keyboard-driven workspace. The visual system separates semantic theme tokens
from style-pack geometry so a user can choose color and shape/density independently.

## Shell hierarchy

```text
Topbar: Node/workspace context, repo/PR controls, global actions
TabRail: sources → workspaces → tasks
Main: Home, Fleet overview, source browse, or active task
Task: ordered pane row
Bottom drawer: terminals and raw provider sessions
Overlays: palette, settings, onboarding, notices, confirmations
```

The shell owns navigation chrome and modal prompts. Plugins supply feature content through registries
and slots. A child webview is positioned over a pane host by the shell; page content never
owns the surrounding chrome.

The terminal draws the same hierarchy at a quarter of the size, and where it differs it differs
because there are no pixels to spend (`apps/tui/src/chrome/`):

```text
Topbar:   one line. Workspace, task count, the open branch, the node's state as a dot
Rail:     a column of tasks, browse sources under a rule; two cells of marks below 100 columns
Main:     one pane, with a strip of pane labels above it
Overlays: the palette, the cheat sheet and a quit confirmation, drawn where the pane is
Footer:   one line. What the keyboard will do, and the node's state when it needs a sentence
```

Three differences are worth naming. There is one pane rather than a row of them, because two panes at
80 columns are two 40-column panes and the kit's own floor is 80, so `nextPane` switches which pane is
drawn instead of walking to the next one. The region cycle is the whole screen rather than the focused
pane, for the same reason: rail, pane strip, the pane's own regions, and back. And an overlay hides the
pane rather than replacing it, so opening the palette does not tear down the pane's queries and its
model.

The desktop topbar, left rail, pane switcher, and rail task list each have a core provider in an
exclusive slot. A selected plugin provider can draw one of these surfaces using the host's data and
verbs. The rail provider places the host's task-list slot; the topbar provider places the host's
right-side status slot. Settings warns when a provider declares that it omits either placement.
The terminal currently hosts `rail.taskList`; its own chrome stays native to cells.

The topbar spans the window. The rails and the panes all begin under its bottom border, so that
border is one unbroken line across the app: the left TabRail is the first thing in `.shell-body`, the
right pane switcher is fixed at `top: var(--topbar-h)`, and the two meet the same pixel because the
bar's height is stated rather than left to its content.

Both vertical rails, the TabRail on the left and the task pane switcher on the right, are built from
one component: `tabs/RailTab.tsx`, a square control styled by `.tabrail-tab`. Its side is
`--pane-head-h`, the height of the pane header it runs beside, so a rail button, a pane header and
the top bar read as one row height and a style pack that moves the header moves the rails with it. Every control in
both rails goes through it, including the bottom-pinned "+" on the left and "close task" on the
right, which share the `.tabrail-bottom` modifier and therefore the same box. It is not a Button. A
rail control hovers by changing its icon and background only, and `.ui-btn:hover` also moves
`border-color`, which lit the right rail's own dividers on hover and made the two sides look
unrelated. `.pane-switcher` restates only what genuinely differs on the right: the glyph font and an
active accent on the right edge instead of the left.

That same `--pane-head-h` is the height of every bar that is a pane's chrome, whichever component
draws it: a plain `Toolbar`, a pane-level `SectionHeader`, and the hand-written `.diff-toolbar`.
Chrome means the bar at the top of a pane, the header of a list column, or the header of a detail
column. `Toolbar`'s `size="sm"` is for a strip *inside* the contents — a filter row, a find bar, a
status line under a body — and picking it for chrome is what left the browser preview's address bar
at half the height of the agents header one pane over. Tab strips are the deliberate exception at
`--tab-h`: a strip under a pane header should read as subordinate to it, not as a second header.

### Rail controls and status markers

`RailTab` is presentation only. It takes a `label` (which becomes both the tooltip title and the
accessible name), a `glyph` resolved through `kit/components/content/Icon.tsx`, and explicit `active`, `tone`, `accent`,
`busy`, `sublabel`, and `markers` props. It never reads task state, asks a registry anything, or
knows which rail it is in. `children` stays as an escape hatch for a genuinely compound centre;
prefer `glyph` plus `sublabel`.

Two states are worth spelling out. `active` sets the visual class only — the call site still supplies
`aria-current`, `aria-pressed`, or `aria-expanded`, because source navigation, a multi-open pane, a
running process, and an open drawer are four different things to say. `busy` swaps the glyph for the
shared spinner, sets `aria-busy`, switches the tooltip to `busyLabel`, and refuses activation without
applying native `disabled`, which would swallow the mouseover the tooltip needs.

A **marker** is a small non-interactive status icon around the outside edge of a control: CI checks,
an unread agent, a dirty worktree, a plugin's own state. A marker is data, not markup. It carries an
id, a label in words, exactly one of an icon name or a `StatusDot` tone, an optional semantic tone,
an optional `busy` flag, and an ordered list of the positions it would like. `busy` means "this state
is live": it spins an icon marker and pulses a dot one.

```
top-start   top-end
     bottom-center
bottom-start   bottom-end
```

`tabs/railMarkers.ts` owns the rest, and the host owns it, not the caller and not a plugin
stylesheet. It orders markers by priority (then id, so activation order never shows), gives each one
the first position on its list that is still free, renders at most one marker per position, and keeps
everything that missed out in the tooltip legend and the control's accessible description. Compact
chrome may hide an icon; it must never hide a state. `bottom-center` is reserved for host lifecycle
and activity, because it sits under the main glyph rather than in a corner. Two states use it, at
opposite ends of a task's life: a pulsing dot while its setup script prepares the new worktree, and a
spinner while teardown removes it.

Core's markers come from `tasks/railStatus.ts`. Compiled plugins publish theirs through
`features/tabs/railMarkers.ts` ([plugins.md § Rail markers](./plugins.md)). Loaded plugins publish task
facts through the generic `core:task` annotation point, and the host converts each accepted fact to a
marker. The plugin supplies severity, bounded text, and an optional host-resolved icon; it supplies no
placement, color, geometry, or action. For the batched request and lifecycle contract, see
[Task annotations](./plugins/cooperative-extension-points.md#task-annotations).

Contributed priorities are clamped below core's, so a plugin can order its own markers among
themselves but can never push a core lifecycle state out of its corner. Placement requests are
preferences, never guarantees. The annotation path does not change this desktop allocator: four
corners may carry pixels, and the complete ordered legend carries every accepted state.

A CSS selector in a feature or plugin stylesheet that positions a rail marker is the regression
signal that placement escaped the host.

## Appearance

For the full contract, see [UI appearance](./ui-design/appearance.md#appearance).

## The closed kit

For the full contract, see [The closed UI kit](./ui-design/closed-kit.md#the-closed-kit).

## Icons

`kit/components/content/Icon.tsx` takes a **name string** and resolves it against two families, in this order:

1. A **`brand:`-prefixed name** is a brand mark from `kit/tokens/brandMarks.ts`: one SVG path's `d`
   attribute in a 24 box, drawn as a single `<path fill="currentColor">`.
2. Any **other name** is a Lucide glyph from `lucide-static/icon-nodes.json`, drawn stroked and
   unfilled in the same box, node by node through `<Dynamic>` and never `innerHTML`.
3. An **unmatched name renders as text** in a `span.glyph`. That fallback is load-bearing rather
   than a nicety — the remaining inline literals (◆/◇ pin state, ⊘/◉ hidden) ride it, which is also
   why `--font-glyph` survives the brand marks leaving.

`Icon` takes two more props, and both are things a call site could not say without a class. `tone`
is a role token, so a state mark is coloured the way every other kit node is coloured;
`tone="brand"` asks the registry for the mark's own colour and holds it to the theme's contrast
through `--brand-legible`, which is how a provider's mark is drawn wherever a surface names the
provider. `spin` turns the mark, for a state that is in flight. It carries no reduced-motion guard,
unlike `.spin`: on a state icon the turn is the whole signal that something is running, and a 12px
rotation is not the motion that setting exists to stop.

### A button whose face is a mark

Reach for `IconButton`, not a `Button` with `iconOnly` written out. It takes an `icon` name, a
required `label`, and defaults to `variant="bare"` and `size="sm"` — the small square affordance the
agents pane uses for go-to-top, go-to-bottom and chats-only. A caller that wants a different pair
still says so, which is how the dashboards keep their `ghost`/`xs` buttons.

The three props behind it were written out at sixty call sites before the node existed, and seven of
those had lost the `size` along the way and drew a third larger than the rest. A handful more never
reached `Icon` at all and typed a character in: the browser preview's chrome was `‹ › ↻ ⌂`, which is
four glyphs that no style pack, tone or spin can touch.

`label` is required rather than optional because a mark has no text in it. A button whose only child
is a glyph announced itself to a screen reader as "‹", and on a terminal it is the fallback for a
name that has no glyph yet.

On the terminal the node paints the mark, one cell, which a plain `Button` cannot do: `Button` prints
`label` for any child it cannot read text off, so the four transcript controls came to about fifty
cells of an eighty-cell pane and the GitHub browse header clipped "Reviews" to "Revi".

The `brand:` prefix exists so the two families can never collide (Lucide has grown brand-shaped
names before and will again) and so brand marks stay out of the Lucide name list
`kit/components/inputs/IconPicker.tsx` enumerates for user-chosen task icons. Putting them in that
picker is then a deliberate one-line decision rather than something that happens by accident.

### Which names are drawn without waiting

Lucide ships 1,756 icons and 706 KB of geometry, and step 2 above resolves a name at render time, so a
bundler cannot see which names are reachable and used to put all of it in a chunk the window loads
before it draws. The set is split in `kit/tokens/iconNodes.ts`:

- **The eager half** is every Lucide name spelled as a literal in this repository's product code —
  77 of them, about 14 KB — written to `iconNodes.eager.json` and carried by the chunk that holds
  `Icon`. Those draw on the first pass with nothing awaited.
- **The lazy half** is the rest, behind `() => import('lucide-static/icon-nodes.json')`. A name only
  that half has takes the text fallback for one frame, then becomes an SVG when the map lands.

The eager half is **generated, never hand-kept**. `packages/client-core/scripts/icon-census.mjs`
scans `packages/`, `plugins/` and `apps/` for `name="…"`, `icon: '…'` and `glyph: '…'` literals that
are Lucide names, and client-core's `lint` re-runs it in `--check` mode. Spell a new icon in the tree
without regenerating the file and lint fails, naming the icon, because the alternative is that the
icon ships in the lazy half and flashes as its own text. Run
`pnpm --filter @acorn/client-core icons` and commit the result.

Nothing is dropped. A person can assign any of the 1,756 to a task and a plugin manifest can name any
one, and both choices are persisted, so a build-time census of what is reachable would break stored
data. The split moves the bytes; it does not lose the names.

Two consumers must never show that one frame, so they ask for the full map up front: `IconPicker`,
whose whole purpose is the other 1,679, and `features/tabs/TabRail.tsx`, whose rows draw whatever
icon the owner picked. The rest of the chrome only ever names an eager icon, so it never sees the
miss. A new surface that draws a **stored** icon name should call `loadIconNodes()` when it mounts.

**A mark belongs in core if and only if a core surface renders it.** Otherwise it belongs to the
plugin that draws it. The reason is the text fallback: if core names `brand:x` and no plugin has
registered it — disabled, uninstalled, bundle untrusted — the literal string `brand:x` appears in
the UI. Core's list is currently one entry, GitHub, because `project.github` is a first-class field
on the project row and core draws it. The mark follows the data model, not the plugin boundary.

A plugin supplies its own mark through one of two feeders, and they produce identical results:

- **compiled in** — call `brandMarkRegistry.register()` from the plugin's `init`
  (`@acorn/plugin-api/client`); see `plugins/docker/src/client/index.ts`.
- **loaded** — declare `icon` (or `icons`, for a package hosting several brands) at the top level
  of `acorn-plugin.json`; the host registers it under a name it stamps from the roster row, so a
  package cannot claim another's mark. See `plugins/linear/acorn-plugin.config.mjs`.

Because both feeders end at the same registry, a plugin moving from compiled-in to loaded changes
no glyph string anywhere. Path data rather than a component is what makes that true: a loaded
plugin's client bundle runs in a sandboxed iframe on its own origin, and a function cannot cross a
MessagePort — and a rail source's logo has to draw whether or not that plugin's frame is mounted.
The retired design note (`docs/future/icons.md`, in git history) records the alternatives this
rules out.

### Brand colour

A mark can carry `color`, the brand's own six-digit hex, and that is where a third-party colour lives.
The alternative, a `--brand-<name>` token in `tokens-invariant.css` paired with a
`[data-provider='<name>']` rule in `integrations.css`, is closed to plugins: core has to know the name
to write the rule, so a fourth provider needs a core change, and any surface without a matching rule
falls back to `--accent` whoever the provider is.

`brandStyle(name)` in `kit/tokens/brandMarks.ts` turns an icon name into two custom properties on the element
that renders the mark: `--brand` for the fill, and `--brand-on` for whatever sits on top of it, which
is `--brand-fg`. A surface reads them with a fallback, so a mark with no colour and a plain Lucide name
both keep the surface's own look:

```css
.integration-logo { background: var(--brand, var(--bg-hover)); color: var(--brand-on, var(--text)); }
```

Two rules govern where a brand colour may go.

**It must not be the only thing carrying contrast.** A hex authored by a third party cannot know your
theme, and GitHub's `#24292f` on a dark pane is black on near-black. Fill a shape with it and put
`--brand-fg` on top, the way the integrations logo does, or tint with it, the way Agent Center's
session icon does at 8%. Colouring a bare glyph on the pane background is the one that breaks, and the
fix if a mark ever does disappear is a light and dark pair on the mark, not a rule in core.

**It is validated as a hex, not as a CSS colour.** The string reaches a `style` attribute, and a
colour slot accepts `url()`, so any-CSS-colour would let a manifest make an outbound request.
`plugin/contract.ts` checks `/^#[0-9a-f]{6}$/i`.

A frame is the exception to all of this, because it is a separate origin and a separate JS realm with
no reach into the registry. It draws its own copy of the mark and sets its own `--brand` inline. That
is one of the things the tree path takes back: a plugin that draws a tree names `glyph: 'brand:linear'`
like anyone else, because the component that resolves it is the host's. Linear and Rollbar each deleted
an inlined SVG when they moved (phase 5 of the layout programme).

A mark is one SVG path's `d` attribute in a 24x24 box, not a full SVG document. A document would
allow `<script>`, `<use href>`, `<image href>`, `<foreignObject>`, `on*` handlers, and CSS
`@import`, which would need an allowlist parser and a new trust boundary for what is only a logo.
There is nothing in `d`'s grammar to sanitise, so a manifest-supplied mark needs only a
character-class check (`node-core/server/plugins/manifest.ts`) and renders through the same `<path>`
machinery `Icon.tsx` already had. `Icon` fills it with `currentColor`, so a plugin's mark themes
across every theme exactly as a first-party one does, which a data-URI `<img>` could not, since CSS
does not cross into its document.

## Two-column panes

`ListDetail` is a kit node, and it is not the same object as the `list-detail` *layout*. A pane's
regions are its outer arrangement and the host draws them
([docs/panes.md § Layout model](./panes.md#layout-model)); a split drawn *inside* one region is the
pane's own, and this node is how it draws it. The PR pane is both at once: a `single` layout whose one
region holds a `ListDetail`, because its two columns are one surface over one model rather than two
regions the host mounts apart.

A pane or a region that puts a list beside a detail uses that node, not a hand-rolled grid. It
owns the split, the drag handle, the three column widths (`narrow` for an identifier switcher, the
default for a browse list, `wide` for a column that holds a document rather than a picker), the
`--chrome-divider` between them, and each column's flex/overflow behaviour. GitHub and Workflows
reach it through `SourceSurface`; Linear, Database, Rollbar, Docker, Editor and the workflow editor
use it directly, including the nested splits in GitHub and Rollbar. HTTP and the compiled task panes
whose list and detail are separate host regions use the `list-detail` layout instead. Both paths own
the same resize behaviour, so a plugin never supplies its own grid or pointer handlers.

A list column is flush and scrolls its own rows. A column holding a document instead says so with
`scroll`, and then it scrolls as one region and takes the pane's inline padding, the same rule
`single` and `header-body-footer` apply to their bodies. GitHub's browse is the case: its middle
column is a pull request, not a picker.

**The list column is flat — no tint.** The four task panes each gave it `--bg-subtle` and the four
rail/frame panes did not, so the split read differently depending on which rail you reached it from.
One surface divided by a rule, not two shaded regions. There is no opt-out prop, because a per-pane
choice is the thing this replaced.

A list column that can be collapsed passes `list={undefined}` rather than hiding a column that is
still in the grid — `ListDetail` then has one track instead of a zero-width first one. Notes' library
toggle works this way.

**A sidebar that narrows to a rail says so with `collapseKey`.** The column goes to `--tabrail-w`,
the width the two icon rails already read, and the drag handle goes with the width nobody can drag
to. The control rides the divider rather than sitting in the list's header, because in the `split`
form the header belongs to a `ListColumn` the caller built and this node has nothing to put a button
into, and because a collapsed column has no header left to sit in.

The divider and the control on it are one node, `CollapseEdge`, and both tiers draw it: the kit's
`ListDetail` and the host's `list-detail` layout. They each wrote their own at first, and the two
buttons drifted apart, one with a border and one without. A split that does not collapse still gets
the bare `SplitHandle`, which is what it always had.

Collapsing is a bargain, and the other half of it is the rows. A column at 48px has room for one
mark, so every row in it takes a `collapsed` slot: the run state for an agent, an avatar over a
number for a pull request, a state icon over a key for a ticket. The slot's presence is what
collapses the row, and the caller passes it from the same signal the column reads
(`kit/lib/collapseState.ts`), so the two cannot disagree. Leading, body, meta and trailing give way
to it, along with depth, nesting and revealed controls, which are about a width the row no longer
has. The name comes back as the tooltip, from the `title` the row already carried.

The slot has the row's existing height to work in and never more. A virtualized list takes its row
height from `--row-h-virt` read off the document root (`kit/lib/metrics.ts`), so a per-column
override is invisible to the virtualizer and a taller collapsed row tears the scroll range.

Opt in on both tiers, and for the same reason. The kit node is told with `collapseKey` because it
also draws splits that are two halves of one document, where a pull request's section nav has no rail
form to collapse to. A pane is told with `collapsible` because a pane that collapses without giving
its rows a rail form gets full-width rows clipped mid-word. A pane drawn from a remote tree cannot
keep the bargain at all: its rows are built in a plugin worker with no way to read a host signal, so
it keeps a column that resizes and does not collapse.

A section label and a pane's list header are both `.section-header`, and neither survives 48px, so
the stylesheet drops them in a collapsed column. Not a prop, because there is no width at which a
caller would want to keep them; the `<section>` keeps its aria-label, so the grouping is still
announced. A header holding a *control* is a different question, and a caller answers that one by
reading the collapse signal and drawing the control itself, which is what the descriptor source panel
does with its refresh button.

The terminal ignores all of it. A rail of marks reads only because the names it drops come back on
hover, and that host has neither hover nor `tip`; it narrows by showing one region at a time instead,
which loses no names.

It is deliberately not the layout for two separate surfaces. The test is whether the two columns are
one surface split by a divider or two surfaces side by side; `.panes` + `.pane` from
`styles/shell.css` is the second case, inset surfaces with a gap between them. **Every browse source
is the first case**, including the ones a descriptor declares. Linear, Rollbar and the HTTP rail used
to be the exception, drawn by `ChromeSourcePanel` as two inset cards on the `.panes` grid while
GitHub and Workflows were one surface and a divider; the file's own comment already called that
surface "master/detail like every other Source browse" and the markup was the thing that disagreed.
It hands `SourceSurface` two halves now, so all five draw through the same node, and those three
gained a resize handle and a collapse they never had. `.panes` keeps Home, Fleet, the task view and
the empty state.

**A pane that writes its own `grid-template-columns` for `.panes` never redefines the shell grid.**
It gets a column width that only resembles the shell's — Docker's was `clamp(320px, 30vw, 460px)`
against the shell's `clamp(320px, 28vw, 420px)` — and a rule that has to out-specify every style
pack's own `.panes` override. Spanning with `grid-column: 2 / -1` has neither problem and needs no
CSS at all.

`ListDetail` sets no narrow-width behaviour. Stacking the columns needs a container query rather
than a media query, and `container-type` would make the element a containing block for
`position: fixed` descendants, which silently mispositions any `Modal` rendered inside it. Narrowing
is the layout's job, not a node's: the `list-detail` layout carries the narrow projection, and a pane
that wants one names that layout instead of nesting this node.

## Chrome and overlays

A loaded plugin's `overlay` frame surface (`docs/plugins.md`) gets an explicit height from the host,
not a `max-height`: the iframe inside sizes to 100% of its container, so a container sized by its own
content would size to nothing. The same reasoning applies to a `refPanel` frame's iframe inside its
fixed-height drawer column: asking for `height: 100%` there would mean 100% of the whole drawer and
overflow past the header, so the frame takes the drawer's remaining space instead, matching what the
enclosing flex column already implies.

`Drawer` is the app's one bottom dock. It is a host component rather than a kit node, because where
the icon rails are and how tall the top bar is are the shell's own geography, and because its height
is a pixel the resize grip produced, which is exactly what a kit node's props may not be. It reaches
plugins through `@acorn/plugin-api/ui/host` beside `PaletteSurface`. The terminal is its only caller.
Nothing behind a drawer goes inert, there is no backdrop, and Escape does not dismiss it: a drawer is
a second place to work rather than an interruption.

The toast stack sits above `--term-drawer-h`, the terminal drawer's published height (set on
`documentElement` by the terminal plugin, with a fallback for a window where that plugin is not
mounted), so a toast never renders behind the drawer. The stack itself ignores pointer events so it
never swallows a click on the app behind it, and each toast re-enables its own.

The command palette and the file finder share one surface, `PaletteSurface`, rather than the
near-duplicate `.palette-*` and `.finder-*` rule sets that used to exist side by side.

Modal dismissal (Escape, backdrop click, Tab focus containment) is `kit/lib/dismissable.ts`, a hook
returning handlers rather than a component; markup stays at the call site. Nine call sites
hand-wrote this before it existed, five of them with only a backdrop click and nothing else, so Tab
walked straight out of the dialog into the page behind it and Escape did nothing. `Modal` uses it
verbatim, which is what keeps it purely cosmetic and safely reviewable. The bottom `Drawer` above
does not, because it is not modal.

Escape is handled twice on purpose: once on the dialog element, and once on the document. The
element handler alone only fires while focus sits inside the dialog, and focus drops back to the
body as soon as the focused child unmounts, so a modal could end up ignoring Escape entirely. The
document handler answers for the topmost dialog that is still in the page, which lets a stack of
them unwind one press at a time, and it stands down when the element handler has already claimed
the key. The overlay palettes (command palette, file finder, workspace switcher) do not use it:
`createOverlayPalette` already owns their dismissal, focus restore, and single-active-overlay
coordination.

## Tooltips

A tooltip is five data attributes, honoured on any element anywhere, not a `<Tooltip>` wrapper
component:

| Attribute | Meaning |
| --- | --- |
| `data-tip` | The tip text. Required; no attribute, no tip. |
| `data-tip-sub` | A second, muted line. |
| `data-tip-key` | A keyboard chord, rendered as a key cap. |
| `data-tip-at` | An event's epoch-millisecond time. The muted line becomes its relative age, calculated when the tip opens. |
| `data-tip-legend` | A JSON array of status markers (icon name, `StatusDot` tone, colour tone, meaning). `RailTab` serialises this from its own markers; call sites never build it. |

A wrapper component adds an element around every trigger, which changes layout; attributes work on
plugin-contributed markup, need no per-site listener, and cost one delegated listener for the whole
document. This outgrew the task rail long ago: it was `tooltip/RailTips.tsx`, used by four core
surfaces and exactly one plugin, while about fifty other sites fell back to native `title=`, which
is slow, unstyled, and invisible to keyboard users on some platforms. Native `title` stays
acceptable only where the styled tip cannot reach, inside xterm's canvas, for instance.

The tip is a singleton, positioned `fixed` so it escapes a scrolling list that clips absolutely
positioned children. Side is automatic: the right rail (`.pane-switcher`) flies left, everything
else flies right, and the CSS offset anchors to whichever side the bubble is pinned to, with `right`
rather than `left` plus a transform so the bubble keeps real layout width instead of squeezing to
the edge. A legend entry mirrors one active rail status marker, placed or crowded out, so the tooltip
both reports current state and teaches what each glyph on the rail means.

A sandboxed plugin frame has its own document, so the shell's tooltip singleton cannot see elements
inside it and `data-tip` would otherwise be silently inert there. `kit/lib/frameTips.ts` mounts the same
delegated listener and bubble markup into a frame's document, the way frames already mount their
own copy of the shared CSS. It stays framework-free and importless on purpose: it is reached from
`@acorn/plugin-api/ui/sdk`, which bundles into a plugin's frame and must not drag a slice of the
shell, or a second copy of Solid, across that boundary.

## Drag-to-resize

`kit/lib/split.ts`'s `createSplitDrag` is the drag-resize hook behind the pane row divider, the terminal
drawer's height handle, and the splits the host layouts draw. Three hand-rolled splitters existed
before it, and none had a keyboard contract. A plugin never calls it: where a split is between two
*regions* the layout owns the handle ([docs/panes.md § Layout model](./panes.md#layout-model)), and
where it is inside one region the `ListDetail` and `SplitHandle` nodes call this for the pane.

It reports a pixel delta, not a value, because the three call sites model size differently: the
pane row resizes two adjacent panes against each other by a delta, the drawer owns one absolute
height, and the document surface owns a fraction. A delta is the one thing all three can turn into
their own units; a `value`/`onChange` hook would have fit only one of them. It owns pointer
capture, rAF coalescing, text-selection suppression during the drag, and `role="separator"` with
arrow/Home/End keys. Persistence stays with the caller, since only the caller knows what it is
persisting: a preference, a layout weight, a fraction. It is the same idiom as `dismissable.ts`:
behaviour as a hook, markup at the call site.

A drag clamps against the element it is resizing, never against `window.innerWidth`. That is the
never-do rule about reading the window, and it is what lets a mobile shell set its own breakpoints.

A drag that outlives its component would keep moving panes that no longer exist, so cleanup runs on
unmount. Clearing `document.body.style.userSelect` removes the property rather than restoring a
snapshot, because a snapshot taken while an earlier drag was still stuck would preserve `none`
forever; removal heals a document that already leaked one. Both `pointerup` and `pointercancel` are
handled, since an interrupted gesture fires `pointercancel` instead and losing pointer capture
mid-drag fires neither; missing either path once left the whole document unselectable for the rest
of the session.

## Interaction rules

Every one of these is a layer over the keymap rather than a handler somewhere: the engine, the intent
set, and the layer priorities are in
[command-palette-and-shortcuts.md § Focus and typing](./command-palette-and-shortcuts.md).

- Command palette opens with `⌘K` and uses contributed actions and rows.
- `⌘1`–`⌘9` activates the corresponding visible task, unless a `tabs` pane has focus, where the same
  chords pick that pane's tabs.
- `⌘⇧T` toggles the terminal drawer; `⌘⇧N` creates a task; `⌘P` opens the file finder; `⌘/` shows what
  the keyboard will do right here.
- F6 and Shift+F6 move between the regions of a pane; Ctrl+Option+Left and Ctrl+Option+Right move
  between panes.
- Pane chords are contribution-owned and user-overridable through Settings → Shortcuts.
- Typing fields, editors, terminals, and contenteditable elements stop global shortcuts unless the
  action is explicitly text-safe. That exemption is a property of the intent now, not of whoever
  remembered to declare it: `dismiss`, `commit`, and the four region and pane moves reach a focused
  composer and nothing else does.
- A node handles intents and never reads a key code. `Input`, `Textarea`, `Composer` and the inside of
  a rectangle are the only places a plugin sees a key event at all.
- Destructive actions and approvals use shell-owned confirmation chrome.

### Menus and right-click

There is one menu. `kit/components/overlays/Menu.tsx` owns the surface — `role="menu"`/`menuitem`, close-on-select, Escape,
outside-click, and focus returning to where it came from — and both ways of opening it mount that same
surface (`MenuSurface`) over the same hook (`kit/lib/anchor.ts`). The roving focus is not its own: a menu is
a collection, so the arrows, Home, End, the page keys and `j`/`k` arrive as intents from
`keys/collection.ts`, the same ones a list of rows gets. A
button anchors it to a rect; a right-click anchors it to a point, which is the only difference. A
right-click menu with its own markup would be a second place for the accessibility to be wrong.

**Right-click is never the only door.** The rows come from the context-menu registry
(`registries/panes/contextMenus.ts`), and the button menu on the same row renders the identical list, so
nothing is mouse-only. It is also keyboard-reachable directly: `contextmenu` is what the platform
dispatches for Shift+F10 and the menu key as well as for the right button, and the surface focuses its
first item on mount, so the menu is operable the moment it appears rather than something to Tab into.
Every anchored surface stays in the viewport. An element-anchored surface flips above, below or to
the other side when its requested side has less room, then clamps any remaining overflow. A
point-anchored menu only clamps — the pointer really can be a pixel from the bottom edge, and there
is no trigger rect to flip around.

Surfaces nest. A `Select` drawn inside a `Popover` puts its list in a portal of its own, so that
list is not inside the popover holding it, and a press on one of its rows would otherwise read as a
press outside. `anchor.ts` keeps the open surfaces in the order they opened, and a surface closes
only on a press that lands outside itself and outside everything opened after it.

A contribution is a label, an optional icon, an order, a predicate over the host-defined target, and
one action. Core's own rows fit that shape — the tab rail's Pin/Unpin/Rename/Archive are registrations,
not inline JSX — which is what makes the contract real before a plugin uses it. Plugins declare the
same thing from a manifest (`docs/plugins.md § Context menus`); the host binds the owner into the id
and evaluates the declared predicate itself.

`RowActions` is the button half of that shape as a component: an ellipsis `Button` wrapping a `Menu`,
placed `bottom-end`, that swallows the click so the row underneath it does not activate. Every list
row that offers an action uses it, so the affordance sits in the same corner and reads the same way
in a plugin's list as in the shell's own. Today it holds one item in three lists, `Create task` in
the GitHub pull list and in the rail list every descriptor source renders through. The agent session
sidebar, which is where the pattern came from, keeps its stop, rename, and archive rows.

It carries its own reveal rather than taking `Row`'s `reveal`, and the difference matters. `Row`
hides the whole trailing slot, which is right when actions are all that slot holds. A rail row also
puts a badge there, and a badge that disappears until you point at it is a badge nobody reads. So the
CSS hangs off `.ui-row-actions` and keys on the row's `:hover`, `:focus-within`, and `[data-selected]`
plus the button's own `aria-expanded`. The last one is not redundant: the surface is portalled, so
while the menu is open, `:focus-within` on the row is false and the trigger would otherwise fade out
from under the menu it opened.

Both `Menu.tsx` and its anchoring hook (`kit/lib/anchor.ts`) replaced hand-rolled implementations that
had each solved less of the problem: TabRail's task menu had neither outside-click nor Escape nor
roles, terminal's profile menu had no portal at all so an overflow ancestor clipped it, and
AccountMenu and NotificationBell each hand-rolled their own outside-click listener. `anchor.ts` owns
dismissal and geometry only; list semantics come from `focus.ts`, markup from the call site. It keeps
the collision pass in one pure helper beside the `placement` flag and re-measures on reflow, so menus,
selects, pickers and popovers cannot drift into separate viewport rules.

The portal is why an overflow-clipped pane no longer cuts a menu off at its edge: an absolutely
positioned child cannot escape an ancestor that sets `overflow`, so it renders through a portal
instead and is fixed-positioned to the trigger's rect. That positioning works unchanged inside a
sandboxed plugin frame, where the "viewport" is just the frame.

`Menu.tsx` layers menu semantics on the same hook: items are buttons, not Rows, because menus have
their own semantics and forcing every clickable through one shared component would blur that.
`Menu.Item`'s `onSelect` closes the menu, with one exception: `closeOnSelect={false}` exists for an
item that toggles something, whose press has to leave the list open to show the new state.

Arm-to-confirm is `Menu.Item`'s own `confirm` prop, not a `ConfirmButton` dropped into the list. The
item keeps its place, reads `Discard?` between the first press and the second, and only then calls
`onSelect` (`createArmedConfirm`, `kit/lib/confirm.ts`). A button among menu items is the wrong
height and carries no `.ui-menu-item`, so the roving focus walks straight past it and the keyboard
cannot reach the one row in the menu that matters most. Changes' Discard and Force push were both
that shape and are both items now.

An `AnchorTarget` can be a point as well as an element; a point is a zero-size rect, so everything
downstream of the positioning math already works unchanged, which is what lets `ContextMenu` reuse
`MenuSurface` for a right-click instead of building a second menu. Visibility is the caller's state,
since a right-click menu belongs to whichever row was clicked; the surface remounts, keyed on the
`at` point, so right-clicking a second row does not leave the first row's items registered on it.

## States

A node's interaction states are the host's too, and held outside the node: `focused` and `pressed` for
every stop, `active`, `selected` and `offset` for every collection, and `hovered` on the DOM host only.
`keys/collectionState.ts` keys them by the item's own key, which is what makes a list keep its place
and its selection across a refetch. The data states below are a different question and are answered
per surface.

Every Node-backed surface can show live, refreshing, stale, offline, disabled, or error. Stale data
retains its last value and names the Node. Offline mutations fail fast and keep typed input. Empty
states explain whether a feature is unconfigured, provider-gated, disabled, or simply has no data.

`disabled` (the plugin is off) takes precedence over everything else, because it is not a data state.
After that, an unreachable Node outranks `refreshing`: a fetch against an offline Node is going to
fail, and calling it "refreshing" would be an infinite spinner. `degraded` (the WebSocket is down but
HTTP still answers) counts as `stale`, since reads keep working but nothing on screen is being updated
by live events. No surface may show a spinner with no deadline: past that deadline it resolves to
`stale`, `offline`, or `error`, never keeps spinning. `error` means there is no data and a retry is the
useful next action; a row served from cache uses `stale` or `offline` instead, because it does have
data. Ages shown next to `stale`/`offline` read "never" rather than a fabricated `0` when the Node has
not answered once this session.

## Accessibility and density

Focus rings, keyboard traversal, text labels, tooltip delays, and reduced-motion tokens are shared by
client-core primitives. Dense layouts must preserve readable line height and a visible focus target;
style packs may compress spacing but must not hide status or action affordances.

Keyboard traversal comes from the tree rather than from each pane. Each kit node's focus role is fixed
in `kit/tokens/focusRoles.ts` and a plugin sets none of it, and the ARIA follows from the role: a `Rows`
renders `listbox` or `tree` with `aria-activedescendant`, a tab strip renders `tablist`, a modal
renders `dialog` with `aria-modal` and hands focus back to its opener. Hover is never load-bearing:
anything a pointer can reach, focus can reach, so a `RowActions` that appears on hover appears on
focus too.

A long list says `virtual` on its `Rows` and changes nothing else. The scroller, the row placement and
the density number all become the kit's, and the collection stays keyed over the whole list rather than
the drawn window, so the arrows still walk past the last row on screen. Before it existed, GitHub's
pull list owned a virtualizer, a scroll element, two animation frames and a pair of hand-registered
`j` and `k` bindings to say the same thing.

## What the kit and layouts must never do

Twelve standing constraints. Each one keeps open a door that the terminal renderer
([docs/tui.md](./tui.md)) already walked through and a mobile PWA
([docs/future/remote.md](./future/remote.md)) walks through later, and each is cheap to hold now
and expensive to reopen. The arguments are in [What the kit refuses](./ui-design/closed-kit.md#what-the-kit-refuses) and
in [docs/security.md](./security.md).

1. No `class`, `className`, or `style` prop on any kit node, even "just for desktop".
2. No raw scale value in a plugin-facing enum. `space.row`, never `space.3` or a number.
3. No plugin-positioned layout. A plugin picks a layout; it never says where a region goes.
4. No key event reaches a plugin outside `Input`, `Textarea`, `Composer`, `MentionTextarea`, and the
   inside of a rectangle.
5. No second keymap. One engine, one command catalog, an adapter per host
   ([docs/command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md)).
6. No kit node without a support row and an 80×24 sentence.
7. No layout without both projections written down.
8. No iframe inside an iframe; `frame-src 'none'` stays.
9. No `postMessage` between plugin origins that the host does not carry and validate.
10. No static widget schema. Logic stays in plugin code; the wire is a tree of kit nodes.
11. No hover-only affordance.
12. No node or layout that reads `window`, the pointer, or a key code.

### What a mobile PWA needs from this

The mobile client is a browser talking to a node, so it is the same DOM host at different widths with
a different shell. What the kit and the layouts owe it:

- **Every layout carries a narrow projection**, written before the layout lands
  ([docs/panes.md § Layout model](./panes.md#layout-model)).
- **Breakpoints are style tokens**, not numbers inside a layout, so the mobile shell can set them.
  Nothing in a layout reads the window width; a drag clamps against the layout's own element.
- **`formFactor` on surfaces stays** (`packages/protocol/src/plugin/contract.ts`). A rectangle that
  only makes sense wide says `['desktop']`, and the mobile shell hides it rather than mangling it.
- **No kit node carries a desktop-only assumption without a support row.** Hover is never
  load-bearing and every tooltip has a focus equivalent.

Host-owned layouts make a focused mobile subset cheap; they do not decide what is in it, which is
`remote.md`'s question.

### What a terminal renderer needs from this

A terminal host cannot run the web renderer, so it needs the tree, the kit, the layouts and the
keymap to be honest about intent. The host that reads these is `acorn`
([docs/tui.md](./tui.md)), which shipped on 2026-08-31 and draws the whole kit in cells.
Drawing all seventy-four nodes cost the kit one prop:
`Markdown` had an `onClick` beside its `onSelect`, handing over a DOM event that a remote tree cannot
receive and a terminal has no way to raise. Its two callers wanted the link's href and the browser on
a miss, so `onSelect` returns `false` for "I did not take it" and `onClick` is gone. Nothing else
moved. This is what the kit holds for it:

- **Every kit node has an 80×24 monochrome sentence** below and a `tui` level in
  `packages/client-core/src/kit/tokens/support.ts`, and both are read: the TUI host draws every node
  from its sentence, and a `reduced` one says what it loses beside its level.
  `tools/arch/kitTable.test.ts` fails if the appendix, the matrix and either host's component table
  disagree about which nodes exist.
- **Every layout has a terminal projection** in [docs/panes.md](./panes.md#layout-model).
- **Role tokens never expose pixels.** Each role has a documented terminal value, including
  `ignored`, in `packages/client-core/src/kit/tokens/roles.ts`, and `roleCell()` beside `roleVar()`
  hands the same answer to a cell renderer. A role names a colour slot, never a colour: which
  sixteenth or which hex is the appearance layer's (`apps/tui/src/appearance.ts`).
- **The keymap core is host-agnostic.** One engine, `@opentui/keymap`, and an adapter per host: the
  package's HTML one on the desktop, and the terminal client's own
  (`apps/tui/src/keys/keymapHost.ts`). acorn adds no key handling outside them. Nodes handle `next`,
  not `ArrowDown`.
- **Collection state is host-owned**, so a cell-buffer host keeps `active`, `selected` and `offset`
  the same way.
- **The tree protocol names nothing about the DOM.** The same mutations apply to a retained tree of
  any kind ([docs/plugins.md § The tree contract](plugins/descriptors.md#the-tree-contract)).
- **Rectangles are the only DOM-only thing**, and `kind="pty"` and `kind="editor"` are native there.
  A `pty` rectangle is filled through `attachPty`, which takes the channel rather than handing back a
  box: an xterm on the DOM, `@xterm/headless` in cells, one source in the plugin
  ([docs/terminal.md § Client](./terminal.md)). What crosses to a terminal plugin by plugin is in
  [docs/first-party-plugins.md](./first-party-plugins.md) § What each of these loses in a terminal.
- **A prop type is declared once and both hosts compile against it.** `ButtonProps`, `InputProps`,
  `SelectProps`, `PickerProps` and `MentionTextareaProps` are exported from the DOM kit and imported by
  the terminal one, because a node's props are one contract and a hand-written second copy loses a prop
  without anybody noticing. The pane sweep found four that had.
- **Nothing in the kit shrinks to make room.** Yoga answers a height deficit by taking it out of every
  child that will give, and a one-line row given half a line lands on the line above it. Every block
  node and every row refuses to shrink; the region around them clips, and a pane taller than the screen
  is the normal case at 24 rows.

## Every node at 80 by 24

The kit's admission rule asks for a written rendering on a host with no pixels, in monochrome, at 80
columns by 24 rows. This is that list, one row per node, and it is the reason `NODE_SUPPORT`'s `tui`
column can be filled in honestly rather than guessed.

A node's props are its exported type in `@acorn/plugin-api/ui` and are not restated here, because a
second copy would be wrong within a release and nothing would catch it. The focus column is
`kit/tokens/focusRoles.ts`, and `tools/arch/kitTable.test.ts` fails if this table and those two files
disagree about which nodes exist or what each one does with focus.

Every row here has a case in `apps/tui/src/kit/kit.test.tsx` that draws the node and reads the cells
back, and every node the focus column calls a stop, a collection or a conditional stop also has a
case that presses it or a written reason why the press is driven in a suite of its own. The reason
sentences are in `NOT_DRIVEN_HERE` in that file, and the list cannot grow quietly: a node cannot join
the kit as a stop without somebody deciding whether this host presses it.

### Grouping

The DOM `Fold` mounts its body on first open and retains it thereafter. Native `<details>` alone
only hides an already-rendered body; deferring that first mount avoids building hidden transcripts
and code blocks while preserving child state on subsequent toggles.

`Timeline` draws whatever turns its caller hands it and keeps the reader's place by turn identity.
A caller with a long list draws part of it through `createTimelineWindow` and passes the window to
the Timeline: `hidden` (older turns not drawn, which puts **Show earlier (N)** above the first turn),
`onShowEarlier`, `reveal` (asked before a hidden reading place is swapped for a neighbour), and
`onTrim` (called while following the live end, never past a turn holding the selection or focus).
`Timeline.Turn` takes a stable `key`, and `position` and `setSize` for `aria-posinset` and
`aria-setsize`, so a screen reader hears a turn's place in the whole list. Its child may be a function
of `near`, which turns true once the turn comes within a screen of the viewport and stays true; a
caller builds an expensive body there and a summary until then. `reveal` returns a value, so it only
works for a caller in the host's realm, not across a sandboxed tree. Timeline turns are not given CSS
containment (`content-visibility`): paint containment would clip a card's focus ring at the turn's
edge, and no real-WebKit run has accepted it.

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Stack` | none | children on successive lines, `gap` as 0 or 1 blank lines. `grow` means the stack is the region rather than a run of content in one: it takes what is left of the box, so a scroller or a canvas inside it has a height to work against |
| `Inline` | none | children on one line separated by a space; wraps to a `Stack` when too wide |
| `Section` | conditional | label in grey uppercase, children below |
| `Fold` | stop | `▸ label` or `▾ label`, children indented two cells |
| `Card` | conditional | a box-drawing frame, or a blank line above and below in compact density |
| `Timeline` | collection | cards in sequence, a grey rule between turns. `follow` makes it the scroller and holds it on the last turn until the reader scrolls away, which is what leaves a pane's header and composer pinned around it; without `follow` it is a plain column and whatever is around it scrolls. `place` and `onChange` are dropped, and `Timeline.Turn` ignores its `key`: the reader is not put back on the turn they left, because a viewport here knows its own offset and nothing about where each turn sits, so a redrawn list opens at the newest turn. `hidden` draws the same **Show earlier** button above the turns, `reveal` and `onTrim` are ignored, and a `near` child is told it is near at once. `Timeline.Turn` is a node of its own on both hosts |
| `Tabs` | collection | `Tab  [Tab]  Tab` on one line, the selected one in brackets. A tab's `icon` becomes the glyph in front of its label, and drops out where the name has no glyph; its `title` has nowhere to hover |
| `Toolbar` | none | children on one line where they fit and wrapped onto the next where they do not, because a bar written for a window is drawn here in a pane column and a row that shrinks its children cuts their labels to nothing |
| `Modal` | trap | a centred box with its title; Escape dismisses, which `keys/keys.test.tsx` drives. `Modal.Body` and `Modal.Actions` answer to their flat spellings too, on both hosts |
| `ModalBody` | none | the lines between the title rule and the actions line |
| `ModalActions` | none | the buttons on one line, right-aligned inside the box |
| `Menu` | trap | a vertical list in a box |
| `Popover` | none | reduced: the panel opens as a block under its anchor, not floating. Open, the anchor and its panel take a line of their own, because a row shares its width between its children and a panel laid out in a trigger's few cells reads as nothing |
| `ListDetail` | none | reduced: two columns above 80 cells. Below it, the `list` form draws the detail alone and the `split` form stacks its two column children, because this node has no keys of its own to switch with and a column of 38 cells is a column nobody can read. `collapseKey` is ignored: a rail of marks reads only because the names it drops come back on hover, and this host has neither hover nor `tip`, so narrowing by region is the answer here |
| `ListColumn` | none | reduced: the left column, or the whole width when the split has collapsed |
| `DetailColumn` | none | the right column, or the whole width |
| `Sections` | collection | reduced: a strip of tabs over one panel — the header first, then each section, then `main` below 120 cells, where a diff in half the width is a diff wrapped at 45 columns. `h` and `l` walk the strip. A section's `meta` is not drawn: a strip has room for a label and a count |
| `SplitHandle` | stop | absent: a terminal split moves by a key, not a grip |
| `DocumentTabs` | collection | one line of tab labels with a `×` on the current one |
| `SectionHeader` | none | a bold line with its actions right-aligned |
| `TabPanel` | none | the rows under the tab strip |
| `ToolbarSpacer` | none | the padding that pushes what follows to the right edge |

### Showing

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Text` | none | plain text; `mono` is a no-op, `muted` is the palette grey, `strong` is bold |
| `Link` | stop | the text, underlined, pressable |
| `Heading` | none | eyebrow in grey uppercase, heading in bold |
| `Rows` | collection | its items on successive lines; `virtual` is the window of rows that fit, and it follows the active row because there is no pointer to scroll with |
| `Row` | item | one line: status glyph, title, meta right-aligned. `variant="stacked"` puts the second child on a second line, as it does on the DOM. `reveal` has no meaning, because there is no hover, so the trailing controls always show. `collapsed` is ignored for the same reason its column's `collapseKey` is: the full row draws, and no name is lost |
| `TreeRow` | item | `Row` indented `depth` cells with `▸` or `▾` |
| `RowActions` | none | the row's actions as glyphs at the right end, always drawn, never on hover |
| `Badge` | none | `[text]` in the tone's colour |
| `Chip` | conditional | `(text)`, with a trailing `×` when removable |
| `ChipRow` | collection | chips on one line, wrapping |
| `StatusDot` | none | `●` in colour, `○` for muted |
| `Facts` | none | two columns, labels grey; `grouping="rows"` is one pair per line; `wide` on an item is a desktop-only full-row tile |
| `DescriptionList` | none | as `Facts`, one pair per line |
| `Table` | none | reduced: box-drawn, truncating columns by the priority its heads declare |
| `TableHead` | none | reduced: the column's label in the bold header line; the lowest priority is dropped first, and a line under the table names the columns that went |
| `TableRow` | conditional | reduced: one line, cells separated by `│`, truncated by column priority; a tab stop only when it has an action |
| `TableCell` | none | reduced: the cell's text in its column's width, ellipsised where it does not fit; `header` makes it bold |
| `Grid` | collection | reduced: as `Table`, with a row-range indicator instead of a scrollbar |
| `Graph` | collection | reduced: the indented list, one line per card — glyph, label, `⇐ n` where the card waits on more than one, detail at the far end — indented by rank and capped at four levels. No positions and no wires: a picture is what this host cannot draw, and the ranks are what the picture was saying. Where an edge can be authored, a picker under the list draws one out of the selected card |
| `Meter` | none | `████░░░░ 62%`; `mark` takes over the cell it falls in, as `███▲░░░░`, rather than a row of its own |
| `CodeBlock` | none | monospace lines, a grey rule above and below |
| `Log` | stop | monospace lines, find as a bottom line |
| `Markdown` | none | reduced: headings bold, lists as `•`, code in a `CodeBlock`, no images, no wide tables, and a link as its text with the URL beside it in grey |
| `DiffPane` | none | reduced: unified only, `+`/`-` in colour, annotations as indented lines under their row; windowed, so a long patch draws the rows around the viewport and not all of them |
| `DiffLine` | none | reduced: one line, `+`/`-`/space in the gutter, no intra-line highlight |
| `FileHead` | none | reduced: the path in bold with `+n −m` right-aligned |
| `NonCodeRow` | none | reduced: a grey line saying what is not being shown, such as `binary file` |
| `SplitCell` | none | absent: side-by-side needs 160 cells, so a terminal diff is unified |
| `EmptyState` | none | centred grey text |
| `Alert` | none | one line prefixed with the tone's glyph |
| `Spinner` | none | reduced: a braille spinner, or `…` where motion is off |
| `Kbd` | none | `⌘K` or `ctrl+k`, per host |
| `UserAvatar` | none | reduced: initials in brackets; no image |
| `Icon` | none | reduced: a glyph from a small name table, an emoji as itself, or nothing for a name the table has no glyph for |

### Asking

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Button` | stop | `[ label ]`, or `[l]abel` with a mnemonic. An icon-only button draws its `label`, because a glyph child has no text to read off it |
| `ConfirmButton` | stop | `[ Delete? ]` after the first press; the armed button is the prompt |
| `IconButton` | stop | reduced: one cell, the mark itself, per `apps/tui/src/kit/glyphs.ts`. A name with no glyph yet falls back to the `label`, which is wide on purpose — the width is what says which name to add to the map |
| `Input` | stop | a field taking the room its row has left; owns keys while focused |
| `Textarea` | stop | a boxed multi-line field; owns keys. `rows` is a floor rather than a fixed height, so an empty field still stands its ground and a full one grows past it; the frame lights in the accent tone while the keys are inside. A caller drawing its own frame, such as `Composer`, turns this one off |
| `Select` | stop | `[ value ▾ ]`, opening a `Menu` |
| `Checkbox` | stop | `[x] label`; Space toggles |
| `SegmentedControl` | collection | `( a \| [b] \| c )`, the selected one in brackets |
| `ToggleButton` | stop | `[x] label` |
| `Picker` | stop | a field that opens a `Menu` filtered by typing |
| `PickerRow` | item | one line in that menu: glyph, label, grey hint |
| `Composer` | stop | a boxed field with a `> ` prompt; commit submits |
| `MentionTextarea` | stop | reduced: a `Textarea` with the mention menu below it; no inline highlight of the token |
| `KeyValueEditor` | none | a two-column table with editable cells, each cell a stop |
| `FindBar` | stop | `/ query  3/12` on one line |
| `Field` | none | the label above its child |
| `CopyButton` | stop | fallback: the button copies over OSC 52 where the terminal takes it, and prints the value on its own line to copy by hand where it does not |
| `ModelBackendPicker` | stop | two `Select`s over the backends a Generate control can spend: a stored key, or an installed agent CLI |

### Pixels, and the host wrappers

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Rectangle` | stop | absent, with two exceptions the node handles itself: `kind="pty"` and `kind="editor"` are native, and `webview` and `frame` draw their `<Fallback>` child or nothing |
| `Only` | none | children exist on the named hosts and nowhere else; no fallback wanted |
| `Fallback` | none | what to draw where the matrix says this host cannot draw the node it is inside |
