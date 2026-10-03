# Every node at 80 by 24

This page is the kit's admission list: one row per kit node, with its focus role and what it draws on
a host with no pixels, in monochrome, at 80 columns by 24 rows. It also lists what the kit and
layouts owe a terminal host and a mobile web app. Read it before you add or change a kit node. It's
part of [UI design](../ui-design.md).

## What a terminal renderer needs from this

A terminal host can't run the web renderer, so the tree, the kit, the layouts, and the keymap have to
describe intent. The terminal client ([the terminal client](../tui.md)) draws the whole kit in cells.
This is what the kit holds for it:

- Every kit node has an 80 by 24 monochrome sentence below and a `tui` level in
  `packages/client-core/src/kit/tokens/support.ts`, and the terminal draws every node from its
  sentence. A `reduced` node says what it loses beside its level. `tools/arch/kitTable.test.ts` fails
  if this page, the matrix, and either host's component table disagree about which nodes exist.
- Every layout has a terminal projection in [pane layouts](../panes/layout.md#layout-model).
- Role tokens never expose pixels. Each role has a terminal value, including `ignored`, in
  `packages/client-core/src/kit/tokens/roles.ts`, and `roleCell()` beside `roleVar()` gives a cell
  renderer the same answer. A role names a color slot, never a color
  ([appearance](./appearance.md#roles-and-what-each-host-makes-of-them)).
- The keymap core is host-agnostic: one engine, `@opentui/keymap`, and an adapter per host. Nodes
  handle `next`, not `ArrowDown`.
- Collection state belongs to the host, so a cell host keeps `active`, `selected`, and `offset` the
  same way.
- The tree protocol names nothing about the DOM
  ([the tree contract](../plugins/descriptors.md#the-tree-contract)).
- Rectangles are the only DOM-only thing, and `kind="pty"` and `kind="editor"` are native in a
  terminal. `attachPty` takes the channel, so one plugin source drives xterm on the desktop and
  `@xterm/headless` in cells ([terminal](../terminal.md) § Client).
- A prop type is declared once, and both hosts compile against it. `ButtonProps`, `InputProps`,
  `SelectProps`, `PickerProps`, and `MentionTextareaProps` are exported from the DOM kit and imported
  by the terminal one.
- Nothing in the kit shrinks to make room. Every block node and row refuses to shrink, and the region
  around them clips, because a pane taller than the screen is normal at 24 rows.

## What a mobile PWA needs from this

A mobile client is a browser talking to a Node, so it's the same DOM host at other widths with a
different shell. The kit and layouts owe it these:

- Every layout carries a narrow projection, written before the layout lands.
- Breakpoints are style tokens, so the mobile shell can set them. Nothing in a layout reads the window
  width, and a drag clamps against the layout's own element.
- `formFactor` on surfaces stays (`packages/protocol/src/plugin/contract.ts`). A rectangle that makes
  sense only wide says `['desktop']`, and the mobile shell hides it.
- No kit node carries a desktop-only assumption without a support row. Hover is never required, and
  every tooltip has a focus equivalent.

## Every node at 80 by 24

A node's props are its exported type in `@acorn/plugin-api/ui` and aren't restated here. The focus
column is `kit/tokens/focusRoles.ts`, and `tools/arch/kitTable.test.ts` fails if this table and those
files disagree about which nodes exist or what each does with focus.

Every row has a case in `apps/tui/src/kit/kit.test.tsx` that draws the node and reads the cells back.
Every node the focus column calls a stop, a collection, or a conditional stop also has a case that
presses it, or a reason in `NOT_DRIVEN_HERE` in that file for why another suite drives it.

### Grouping

The desktop `Fold` mounts its body on first open and keeps it, so hidden transcripts and code blocks
aren't built until needed, and child state survives later toggles.

`Timeline` keeps your place by turn identity. A caller with a long list draws part of it through
`createTimelineWindow` and passes the window in: `hidden`, the older turns not drawn, which puts
**Show earlier (N)** above the first turn, `onShowEarlier`, `reveal`, asked before a hidden reading
place is swapped for a neighbor, and `onTrim`, called while following the live end, never past a turn
holding the selection or focus. `Timeline.Turn` takes a stable `key`, and `position` and `setSize` for
`aria-posinset` and `aria-setsize`. Its child can be a function of `near`, which turns true once the
turn comes within a screen of the viewport, so a caller builds an expensive body only then. `reveal`
returns a value, so it works only in the host's realm. Turns get no CSS `content-visibility`, because
paint containment would clip a card's focus ring.

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Stack` | none | Children on successive lines, `gap` as 0 or 1 blank lines. `grow` means the stack is the region rather than a run of content in one: it takes what is left of the box, so a scroller or a canvas inside it has a height to work against |
| `Inline` | none | Children on one line separated by a space. Wraps to a `Stack` when too wide. `even` is ignored, because the desktop's equal columns have no use in a row of cells |
| `Section` | conditional | Label in grey uppercase, children below. `help` is a grey line under the label, because this host has no hover |
| `Fold` | stop | `▸ label` or `▾ label`, children indented two cells by default; `contentIndent="none"` aligns child content with the header. A `leading` control sits between the mark and the label |
| `Card` | conditional | A box-drawing frame that fits its pane. A toned card uses a coloured `▍` left edge for its full height while the other edges stay neutral. Compact density keeps that left edge without the frame |
| `Timeline` | collection | Cards in sequence, a grey rule between turns. `follow` makes it the scroller and holds it on the last turn until the reader scrolls away, which is what leaves a pane's header and composer pinned around it. Without `follow` it is a plain column and whatever is around it scrolls. `place` and `onChange` are dropped, and `Timeline.Turn` ignores its `key`: the reader is not put back on the turn they left, because a viewport here knows its own offset and nothing about where each turn sits, so a redrawn list opens at the newest turn. `hidden` draws the same **Show earlier** button above the turns, `reveal` and `onTrim` are ignored, and a `near` child is told it is near at once. `Timeline.Turn` is a node of its own on both hosts |
| `Tabs` | collection | `Tab  [Tab]  Tab` on one line, the selected one in brackets. Its text label carries the meaning; `icon` is omitted and `title` has nowhere to hover |
| `Toolbar` | none | Children on one line where they fit and wrapped onto the next where they do not, because a bar written for a window is drawn here in a pane column and a row that shrinks its children cuts their labels to nothing |
| `Modal` | trap | A centred box with its title; Escape dismisses, which `keys/keys.test.tsx` drives. `Modal.Body` and `Modal.Actions` answer to their flat spellings too, on both hosts |
| `ModalBody` | none | The lines between the title rule and the actions line |
| `ModalActions` | none | The buttons on one line, right-aligned inside the box |
| `Menu` | trap | A vertical list in a box. A choice item prints `(•)` or `( )` for a radio and `[x]` or `[ ]` for a checkbox before its label, and `Menu.Separator` is a rule |
| `Popover` | none | Reduced: the panel opens as a block under its anchor, not floating. Open, the anchor and its panel take a line of their own, because a row shares its width between its children and a panel laid out in a trigger's few cells reads as nothing |
| `ListDetail` | none | Reduced: two columns above 80 cells. Below it, the `list` form draws the detail alone and the `split` form stacks its two column children, because this node has no keys of its own to switch with and a column of 38 cells is a column nobody can read. `collapseKey` is ignored: a rail of marks reads only because the names it drops come back on hover, and this host has neither hover nor `tip`, so narrowing by region is the answer here |
| `ListColumn` | none | Reduced: the left column, or the whole width when the split has collapsed |
| `DetailColumn` | none | The right column, or the whole width. `measure` is ignored, since the column is already no wider than a readable line |
| `Sections` | collection | Reduced: a strip of tabs over one panel: the header first, then each section, then `main` below 120 cells, where a diff in half the width is a diff wrapped at 45 columns. `h` and `l` walk the strip. A section's `meta` is not drawn: a strip has room for a label and a count |
| `SplitHandle` | stop | Absent: a terminal split moves by a key, not a grip |
| `DocumentTabs` | collection | One line of tab labels with a `×` on the current one |
| `SectionHeader` | none | A bold heading with actions on the next line, so a long action label cannot erase the heading. `help` is a grey line between them, because this host has no hover |
| `TabPanel` | none | The rows under the tab strip |
| `ToolbarSpacer` | none | The padding that pushes what follows to the right edge |
| `SettingsSection` | none | The label in bold, the description in grey under it, then `help` as a grey line, because this host has no hover, then its rows. The danger zone's label is in the danger colour instead of a frame. `actions` draw on the line under the label |
| `SettingRow` | none | Reduced: one line, the label then the control, and `stacked` puts the control on the next line. The description in grey under it, then `help` as a grey line, because this host has no hover, **Saved** in green or the error in red. `onReset` adds `•` to the label and a `Reset` button. A row with `from` draws `From <where>` and no control, so the value this machine holds is not shown. A row with `scope="device"` draws `(this device)` after its label |

### Showing

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Text` | none | Plain text; `mono` is a no-op, `muted` is the palette grey, `strong` is bold |
| `Link` | stop | The text, underlined, pressable. `tip` draws nothing, because this host has no hover |
| `Heading` | none | Eyebrow in grey uppercase, heading in bold. `help` is a grey line under it, because this host has no hover |
| `Rows` | collection | Its items on successive lines; `virtual` is the window of rows that fit, and it follows the active row because there is no pointer to scroll with |
| `Row` | item | One line: status glyph, title, meta right-aligned. `variant="stacked"` puts the second child on a second line, as it does on the DOM. `reveal` has no meaning, because there is no hover, so the trailing controls always show. `collapsed` is ignored for the same reason its column's `collapseKey` is: the full row draws, and no name is lost |
| `TreeRow` | item | `Row` indented `depth` cells with `▸` or `▾` |
| `RowActions` | none | The row's actions at the right end, always drawn with their control labels, never on hover |
| `Badge` | none | `[text]` in the tone's colour. `tip` draws nothing, because this host has no hover |
| `Chip` | conditional | `(text)`, with a trailing `×` when removable |
| `ChipRow` | collection | Chips on one line, wrapping |
| `StatusDot` | none | `●` in colour, `○` for muted. `tip` draws nothing, because this host has no hover |
| `Facts` | none | Two columns, labels grey; `grouping="rows"` is one pair per line; `wide` on an item is a desktop-only full-row tile |
| `DescriptionList` | none | As `Facts`, one pair per line |
| `Table` | none | Reduced: box-drawn, truncating columns by the priority its heads declare |
| `TableHead` | none | Reduced: the column's label in the bold header line. The lowest priority is dropped first, and a line under the table names the columns that went |
| `TableRow` | conditional | Reduced: one line, cells separated by `│`, truncated by column priority. A tab stop only when it has an action |
| `TableCell` | none | Reduced: the cell's text in its column's width, ellipsised where it does not fit; `header` makes it bold |
| `Grid` | collection | Reduced: as `Table`, with a row-range indicator instead of a scrollbar |
| `Graph` | collection | Reduced: the indented list, one line per card: label, `⇐ n` where the card waits on more than one, detail at the far end, indented by rank and capped at four levels. No positions and no wires: a picture is what this host cannot draw, and the ranks are what the picture was saying. Where an edge can be authored, a picker under the list draws one out of the selected card |
| `Meter` | none | `████░░░░ 62%`; `mark` takes over the cell it falls in, as `███▲░░░░`, rather than a row of its own |
| `CodeBlock` | none | Monospace lines, a grey rule above and below |
| `Log` | stop | Monospace lines, find as a bottom line |
| `Markdown` | none | Reduced: headings bold, lists as `•`, code in a `CodeBlock`, no images, no wide tables, and a link as its text with the URL beside it in grey |
| `DiffPane` | none | Reduced: unified only, `+`/`-` in colour, annotations as indented lines under their row. Windowed, so a long patch draws the rows around the viewport and not all of them |
| `DiffLine` | none | Reduced: one line, `+`/`-`/space in the gutter, no intra-line highlight |
| `FileHead` | none | Reduced: the path in bold with `+n −m` right-aligned |
| `StackedDiff` | none | Reduced: the `FileHead` line, then each hunk header and `DiffLine` below it |
| `NonCodeRow` | none | Reduced: a grey line saying what is not being shown, such as `binary file` |
| `SplitCell` | none | Absent: side-by-side needs 160 cells, so a terminal diff is unified |
| `EmptyState` | none | Centred grey text |
| `Alert` | none | One line prefixed with the tone's glyph |
| `Spinner` | none | Reduced: a braille spinner, or `…` where motion is off |
| `Kbd` | none | `⌘K` or `ctrl+k`, per host |
| `UserAvatar` | none | Reduced: initials in brackets. No image |
| `Icon` | none | A one-cell mapped mark. Unmapped names and desktop hover `title` draw nothing |

### Asking

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Button` | stop | `[ label ]`, or `[l]abel` with a mnemonic. An icon-only button draws its `label`, because a glyph child has no text to read off it |
| `ConfirmButton` | stop | `[ Delete? ]` after the first press. The armed button is the prompt |
| `IconButton` | stop | Its text `label` is the control, since the terminal has no Lucide or SVG rendering |
| `Input` | stop | A field taking the room its row has left. Owns keys while focused |
| `Textarea` | stop | A boxed multi-line field. Owns keys. `rows` is a floor rather than a fixed height, so an empty field still stands its ground and a full one grows past it. The frame lights in the accent tone while the keys are inside. A caller drawing its own frame, such as `Composer`, turns this one off |
| `Select` | stop | `[ value ▾ ]`, or `value▾` for a bare control, opening a `Menu` |
| `Checkbox` | stop | `[x] label`; Space toggles |
| `SegmentedControl` | collection | `( a \| [b] \| c )`, the selected one in brackets |
| `ToggleButton` | stop | `[x] label` |
| `Picker` | stop | A field that opens a `Menu` filtered by typing. It draws no remove control, so it ignores `removable` and `removeLabel`, which name a row's remove button and arm it on the first press in the window |
| `PickerRow` | item | One line in that menu: label and grey hint. A leading icon is omitted |
| `Composer` | stop | A boxed field with a `> ` prompt. Commit submits |
| `MentionTextarea` | stop | Reduced: a `Textarea` with the mention menu below it. No inline highlight of the token |
| `KeyValueEditor` | none | A two-column table with editable cells, each cell a stop |
| `FindBar` | stop | `/ query  3/12` on one line |
| `Field` | none | The label above its child, the hint under it, then `help` as a grey line, because this host has no hover |
| `CopyButton` | stop | A labeled Copy control sends OSC 52 where the terminal takes it, and prints the value on its own line to copy by hand where it does not |
| `ModelBackendPicker` | stop | Two `Select`s over the backends a Generate control can spend: a stored key, or an installed agent CLI |

`modelProviderFailure` is a presentation helper at `@acorn/plugin-api/ui/model-provider-failure`,
also exported by `@acorn/plugin-api/ui` and `@acorn/plugin-api/ui/tree`. Generate controls use it for
shared provider error codes. It adds no kit node.

### Pixels, and the host wrappers

| Node | Focus | At 80×24 |
| --- | --- | --- |
| `Rectangle` | stop | Absent, with two exceptions the node handles itself: `kind="pty"` and `kind="editor"` are native, and `webview` and `frame` draw their `<Fallback>` child or nothing |
| `Only` | none | Children exist on the named hosts and nowhere else. No fallback wanted |
| `Fallback` | none | What to draw where the matrix says this host cannot draw the node it is inside |
