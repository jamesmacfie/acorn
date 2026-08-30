# Layouts: six arrangements the host owns

Part of [docs/future/layout/](./README.md). A plugin never lays anything out. It picks a layout and
fills its regions. The host owns what each layout means at every width and, later, on every host.
Responsiveness becomes a cost per layout instead of per pane, regions become focus groups, and a
terminal projection becomes a property of the layout.

## How this relates to what exists

Two layers of layout exist today and only one changes.

The **task layout row** (`docs/panes.md` § Layout model) is the persisted list of pane ids with
weights, pins, and a maximised pane, managed by the layout reducer. It is unchanged. A task is still
a flat row of panes, each pane still has one id, and `?pane=&item=` addressing still works.

The **inside of a pane** is what changes. Today each pane arranges itself with `<section
class="pane">`, a header div, a scroll div, and its own CSS; `ListDetail` and `DocumentOverFrame`
are the two places the host already owns an arrangement. After phase 1 every pane declares one of the
layouts below, and the host draws it.

`docs/third-party/monaco.md` § The template vocabulary named `document`, `document-over-frame`, and
`frame-beside-document` and set the generative rule: position is in the name, never a knob. That
rule holds here and that section folds into this file.

## The six layouts

Each layout: its regions, which regions are focus groups, the desktop rendering, and two
projections that are documented now and built later (narrow, for the PWA; terminal). The projections
are part of the admission rule for a layout, the same way the 80×24 sentence is for a node.

### `single`

One region, `body`. The trivial layout, so a pane that is one tree still declares a layout and
inherits the focus group and the padding rules.

### `list-detail`

Regions: `list`, `detail`, optional `list-header`, optional `list-footer`. Two focus groups, `list`
and `detail`. The host draws the split and the drag handle; the list width is a style token
(`--listdetail-w`, `--listdetail-w-narrow`). Existing code: `ui/ListDetail`.

Narrow: one region at a time. Selecting in the list pushes the detail; a back affordance returns.
Terminal: the same as narrow below 80 columns, two columns above it; a key switches groups.

Used by: agents, changes, notes, editor, http, database, linear, rollbar, github browse.

### `header-body-footer`

Regions: `header`, `body` (scrolls), `footer`, any of the three optional. Body is the focus group;
header and footer join it unless they hold a stop of their own (a `Composer` in the footer does).
`header-body` is this layout with no footer.

Narrow: unchanged; the footer is pinned. Terminal: same.

Used by: the agents detail region (transcript over composer), context, docker task pane, memory's
section, preview.

### `tabs`

Regions: `tabs` (the bar) and one `panel` per tab, drawn one at a time. The bar is one focus stop
with roving focus; the visible panel is a focus group. The `Tabs` node exists for tab strips inside
a tree; this layout is for a pane whose top level is tabs, so the host can persist the selected tab
per pane and give the strip its keybinding (`⌘1`..`⌘9` inside the pane).

Narrow: the bar scrolls horizontally. Terminal: the bar is one line.

Used by: docker detail, linear, rollbar, http response, editor sidebar, the github PR pane.

### `document-over-frame` and `frame-beside-document`

Regions: `document` (a host-owned editor; `DocumentSurface`) and `frame` (a plugin tree, or a
rectangle for a plugin that still ships one). Two focus groups. Existing code:
`frames/DocumentOverFrame.tsx`, `frames/documentSurfaces.ts`, `editor/DocumentSurface`. The
beside variant is the one the editor plugin named as its blocker.

Narrow: the frame region collapses to a sheet the document can summon. Terminal: the document region
is a host text view, read-only in a first version; the frame region draws its tree.

Used by: database today; editor and http after their moves.

### `stack-split`

Regions: `top`, `bottom`, a handle. Two focus groups. Existing code: `SplitHandle`,
`ui/split.ts`. The terminal drawer is the consumer.

Narrow: `bottom` becomes a full-height sheet. Terminal: same as desktop, native.

### `wizard`

Regions: `step` (one at a time), with the host drawing the step indicator and the back and next
controls from `steps: [{ id, label }]` and `current`. One focus group. Replaces the custom backdrop
and dot strip in `plugins/onboarding/src/client/OnboardingWizard.tsx` and the github importer.

Narrow and terminal: unchanged.

## Declaring a layout

A compiled pane declares it on the contribution and provides a component per region:

```ts
ctx.panes.register({
  id: 'notes', label: 'Notes', order: 30,
  layout: 'list-detail',
  regions: { list: NotesList, 'list-footer': NotesActions, detail: NoteBody },
})
```

A loaded plugin declares it in the manifest and provides a remote entry per region:

```json
"frames": [{
  "target": "pane", "id": "issues", "label": "Issues",
  "layout": "list-detail",
  "regions": { "list": "remote:./dist/list.js", "detail": "remote:./dist/detail.js" }
}]
```

A region may also name a rectangle (`"frame": "preview"`) for a plugin that owns pixels there, or a
`Slot` (`"slot": "beside"`) so the region is itself an extension point. The `layout` key on a `frames`
entry today (`document-over-frame`) is this same key with a wider vocabulary.

## Regions are focus groups

Every region is a focus group in the sense [07-focus-and-keys.md](./07-focus-and-keys.md) uses:
one chord moves between groups (`nextRegion`, `prevRegion`), focus inside a group is roving, and the
group remembers its last focused node. This generalises `focusedPane` in `client-core/src/tasks/
tasks.ts`, which tracks one focused pane per task, to every region of every pane. The task layout row
is the outermost group.

## Slots in regions

A region can hold a `Slot` node, and a region can be a slot. The arbitration rules
(`stack`, `replace`, `selector`, `max`) are in [03-extension-kinds.md](./03-extension-kinds.md). The
one layout rule they add: a rectangle slot is a sibling region, never a child of another region's
iframe, and its position is the region name (`pane.inline-below` is a `header-body-footer` footer
region; `pane.inline-beside` is a `list-detail` detail region).

## Adding a seventh

The list grows when a surface appears that needs one and cannot be expressed in the six, never
ahead of a consumer. A candidate must state its regions, its narrow projection, and its terminal
projection before it lands. A knob (`orientation`, `columns`) is never the answer; a new named layout
is.

## Tests

- Each of the six layouts renders in the jsdom host tier (the `hosts` vitest project in
  `client-core`) with placeholder regions, and the test asserts region order and that each region is a
  focus group.
- A layout with a missing required region throws at registration, not at render.
- The `frames` manifest parser rejects a `layout` outside the list and a `regions` key the layout does
  not have.

## Doors left open

- Every layout carries its narrow and terminal projections in this file even though nothing draws
  them. A layout added without both is refused.
- Nothing in a layout reads the window width directly; breakpoints are the host's, expressed as
  style tokens, so the PWA can set them differently.
- No layout exposes a pixel or a percentage to the plugin. Weights, if a layout ever takes one, are
  small integers.
