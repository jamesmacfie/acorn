# House patterns: the yardstick for the remaining batches

**Status:** reference for the open batches. Written 2026-10-01, after batches K1a to B05. Line numbers
are from 2026-10-01 and may have moved. Where this file and an owning doc disagree, the owning doc wins:
[UI design](../../ui-design.md), [the closed kit](../../ui-design/closed-kit.md), and
[frontend](../../frontend.md).

This is the review's baseline, condensed, and updated for what the kit batches changed. Measurements are
logical pixels in the Terminal style pack. Judge a fix against this file: the same role should look and
behave the same way on every page.

## The scales

**Spacing rungs** do not change with the style pack:

| Token | px | Token | px |
| --- | --- | --- | --- |
| `--space-1` | 2 | `--space-7` | 14 |
| `--space-2` | 4 | `--space-8` | 16 |
| `--space-3` | 6 | `--space-9` | 20 |
| `--space-4` | 8 | `--space-10` | 24 |
| `--space-5` | 10 | `--space-11` | 32 |
| `--space-6` | 12 | | |

**Semantic space** moves with the pack. Use these for anything that should feel denser or roomier:

| Token | Terminal | Modern | Cozy | Cute | Job |
| --- | --- | --- | --- | --- | --- |
| `--pane-pad` | 14 | 16 | 24 | 16 | The inline inset of every pane, bar, row, and card |
| `--gap-inline` | 6 | 8 | 8 | 8 | Between items in a line |
| `--gap-row` | 8 | 10 | 12 | 10 | Between buttons in any action row; `Stack gap="row"` |
| `--gap-stack` | 10 | 12 | 16 | 12 | `Stack` default |
| `--gap-section` | 14 | 20 | 32 | 20 | Between sections; settings page gaps |

Tokens the batches added: `--setting-control-w` (18rem, the one control column), `--page-measure`
(720px, the settings and form width), and `--ring-highlight` (the settings search landing fill).
`--pane-pad-y` and `--pad-body` stay declared as aliases nothing reads, so older style packs still
validate (lead's override 5).

**Type.** `--fs-2xs` 10 (eyebrows, fact labels), `--fs-xs` 11 (sm buttons, badges, table heads),
`--fs-sm` 12 (the working size: rows, inputs, md buttons, tabs, labels, and every `Text` emphasis),
`--fs` 13 (body, markdown headings), `--fs-md` 14 (`Heading level={3}`, settings section label),
`--fs-lg` 15 (`Heading level={2}`, modal titles), `--fs-xl` 18 (`Heading level={1}`). Weights 400,
500, 600 (`--label-weight`, `--heading-weight`), 700. The literal `font-size` count in shared CSS is
zero; keep it there.

**Control heights:** `--control-h-xs` 20 (xs buttons, the collapse control, switches), `--control-h-sm`
26 (sm buttons and inputs, filters, keycaps), `--control-h` 32 (md buttons, inputs, selects),
`--row-h-sm` 30 and `--row-h` 36 (menu items, list rows), `--tab-h` 40, `--pane-head-h` 48 (every chrome
bar), `--topbar-h` 48.

**Radius and borders** are picked by role. `--radius-control`, `--radius-surface`, `--radius-popover`,
and `--radius-chip`. `--divider` between rows (zero in Modern and Cute), `--chrome-divider` between
regions and under bars, `--control-border` on inputs and buttons, `--surface-border` on cards, popovers,
and modals. The wrong role renders nothing.

**CSS hygiene ratchets only go down:** no literal `border-radius`, no `border: Npx`, no literal
`box-shadow` geometry (put a new shadow in a token), no raw `z-index`, no new literal `font-size`, no
hex colour outside the token sheets, and at most 147 off-scale spacing pixels.

## Page or pane frame

- A pane has no padding of its own. Its layouts pad the scrolling body `--pane-pad` inline.
- Chrome takes the inset back: a `Toolbar`, `Tabs`, a pane-level `SectionHeader`, and a `Row` inside a
  padded region pull out by a pane pad, so their backgrounds reach the pane edge. A scrolling list column
  does the same for rows, section headers, fold summaries, and bar toolbars, but not inside a card or an
  alert.
- Every escape rule also names the remote-tree form (`> .remote-tree > .ui-listdetail`), because
  `.remote-tree` is `display: contents` but still a DOM child.
- A reading column stops at `--pane-measure`. A form or settings page stops at `--page-measure` (720).
  `DetailColumn measure="page"` caps a detail column's content at 720 and starts it at the column's
  start edge; chrome bars are not capped.
- A tree or pane root whose content can be long must be `<Stack grow>`, or the region clips it.

## Page title

- `Heading level={1}` (18, 600), with an optional `eyebrow`. Page actions go in an `Inline spread`
  beside it. The page's description is `help` on the title, or one short muted line when the person
  needs it to act.
- Home and Memory share this title and its padding.
- The settings header: the path to the page as a 10px eyebrow of links, the title, the scope `Badge`
  8 after it, and a close `IconButton` with `tipKey="Esc"` at the end. No separate back line.

## Pane header

- Exactly `--pane-head-h` (48), including its bottom `--chrome-divider`.
- Every chrome bar paints `--bg-subtle`. The top bar alone keeps `--bg`; `docs/ui-design.md` § Shell
  hierarchy says why.
- A list column's header is `SectionHeader` (label and count, one or two actions). A detail or pane
  header with a title and controls is `Toolbar` + `Heading level={2}` + `ToolbarSpacer` + controls at sm.
- A count sits 4 after its label in `--text-faint` with tabular figures.
- When a split has a collapse control, the first bar in each column makes room for it. A pane's first bar
  also reserves room at its end for the pane's pin and close (`--pane-actions-w`).

## Heading levels

A page title is level 1. A pane or detail title is level 2, including one in a `Toolbar`. A heading
inside content is level 3. Pick the level for the role, never for its size.

## Section headings and subheadings

- In a list, a group label is `SectionHeader level="group"` (or `Section`): `--label-size`,
  `--label-weight`, `--text-muted`, 10 above and 4 below, padded `--pane-pad` inline so it shares the
  header's edge. The settings rail heading and menu label rows share this look.
- A list with more than one section uses `level="group"` for each, never a pane-level header mid-list.
- A label that is content (a path, a name, a sentence) uses `level="sub"` for a `Fold` or
  `SectionHeader`, so it keeps its case.
- Only pane and group headers stick. A `sub` header and every `Fold` summary scroll, unless they carry
  `sticky`. A `sub` header right after a setting row takes `--gap-section` above it.
- In a dense list or form, a subheading is `SectionHeader level="sub"` (12, 600, `--text`). In a
  document, `Heading level={3}`. `Text emphasis="strong"` is for a strong run inside a line, not a
  heading.

## The help mark

`help` is a string prop on `SettingRow`, `SettingsSection`, `SectionHeader`, `Section`, `Heading`, and
`Field`. The node draws a "?" after its title, and the text opens on hover, on focus, and on a tap. Pass
it to the node that owns the title. Do not wrap the title in your own markup, and do not put a mark in
`actions`.

Which text goes where:

- `description` (or a `Field`'s `hint`): only what the person needs to choose correctly right now. A
  consequence that cannot be undone, a unit, a format. One line, about 70 characters.
- `help`: how it works, when it applies, or why it exists. One to three short sentences, under about 200
  characters.
- Neither: text that restates the label, or that describes how acorn is built rather than what the
  person gets.

A page with one section renames the section rather than hiding its label, which keeps a place for the
mark (plan decision 11). The terminal prints `help` as a grey line under the label. An older acorn
ignores the prop, so the explanation goes missing and nothing breaks. `Alert` has no `help`; keep one
short inline line there. Write every replacement with the `readable` skill.

## Settings sections and setting rows

- `SettingsSection`: an `h2` label at 14 and `--heading-weight`, an optional one-line description, rows
  separated by `--divider`. Sections after the first take `--gap-section` above and a divider (zero in
  Modern and Cute).
- `SettingRow`: a grid of the label column and `--setting-control-w` (288), `--space-6` between columns,
  `--gap-row` block padding. Inline rows have a floor of `--control-h` plus two `--gap-row` (48), so
  every inline row is the same height. Below 32rem of page width, inline rows stack.
- The row's title line holds the label, then the help mark, the changed dot, the scope badge (**This
  device**, `Badge size="xs"`), then **Saved** or **Reset** (ghost xs). The control column holds only the
  control and never changes width.
- The label is a real `<label for>` its one control: clicking "Play a sound" toggles the switch.
- A switch is 32 by 20 with a 14 knob. A select or text field fills the control column.
- Read-only facts are `Facts` in the setting grid, value end-aligned. A `Row` or a start-aligned
  `EmptyState` inside a section sits on the section's edge.
- Section actions are sm. An "add" action is outline sm (plan decision 5). A view switch for the list
  goes in the actions too. A link to another page is a ghost sm button named after the page; a link
  inside a sentence is a `Link`; nothing is bare.

**A list of things on a settings page** (connections, plugins, servers, agents): an inline `SettingRow`
with the thing's name as label and one line of source as description; in the control column, the status
as a toned `Badge` word, then ghost sm actions, the main one first. When the state is the setting, a
switch replaces the badge. An unusual state goes in the description with a danger badge, never in the
row's `error`, which means "the last write failed" (plan decision 12).

## Toolbars

- `Toolbar` (the bar): 48 high, `--pane-pad` inline, `--gap-inline` between items, `--bg-subtle`, a
  divider under it.
- `Toolbar size="sm"`: 26 high. The place for a filter input, so it stops growing.
- `Toolbar variant="actions"` is a footer, never a header. A page form's footer is an `Inline` (see
  [Page forms](#page-forms)).
- Buttons in any bar toolbar, tab-strip actions, document-tab actions, or settings-section actions are
  sm, forced by CSS. A bar that holds an input is left out, so a 32-high field and its button stay level;
  size those at the call site.
- A bare text button that is a direct child of a toolbar or an action row is 26 high. A bare text button
  alone in a body is not; make it ghost sm.
- A bar toolbar that closes a grow `Stack` (a footer) takes its divider on top. A list footer draws its
  divider on top.
- A `Toolbar` inside the `header-body-footer` header is the bar, with one divider.

## Tabs

- Tabs sit flush under the header they belong to, with no gap and no margin. Controls for the strip go
  in its `actions` slot, never in a second bar.
- The strip pads `calc(var(--pane-pad) - var(--space-6))`, so the first label lands on the content edge.
  A label shorter than a tab's 88 minimum still centres, a known few pixels off. In a list column tabs
  have no minimum.
- A strip that scrolls fades the edge that overflows.
- `DocumentTabs` pads so its first name lands on 14.
- On a settings page, a strip that is a direct child of the page has no fill and sits flush under the
  header's divider.
- A count in a tab is a plain faint number. Focus rings read the focus tokens.
- `SegmentedControl` switches a value; it is not a tab strip.

## Buttons and icon buttons

| Size | Height | Use |
| --- | --- | --- |
| `md` | 32 | A form or a page body, a modal footer |
| `sm` | 26 | Any chrome bar, an alert's actions |
| `xs` | 20 | Inside a row or a chip-height strip |

- Variants: `outline` (default), `solid` (the one primary in a group), `ghost`, and `bare` (no box).
- **Cancel** is always `ghost` (plan decision 2). One `solid` per group.
- A glyph-faced button is `IconButton` with a `label`. Its tip defaults to the label. A `Button`'s
  `title` draws as the styled tip.
- An "add" action is the word with `Icon name="plus"`, never a typed "+".
- A destructive two-press button is `ConfirmButton` with `confirmLabel="{Verb} {thing}?"`. Armed, it
  keeps at least its resting width. The default prompt is "Confirm?".
- Buttons, links, and segmented controls do not stretch in a `Stack`, a settings section, a stacked
  setting row, or a stacked `Field`.
- Every row of buttons is `--gap-row` apart.

## Form fields

- In a form or a modal, `Field` (stack): label over control, md controls. On a settings page,
  `SettingRow`, not `Field layout="split"`.
- `Field`'s caption is a `<label for>` its control; the hint, error, and help describe it. `hint` is what
  to type. `help` is how it works. A `Picker` claims the nearest field; wrap one in the `NO_FIELD`
  provider when the caption should name another control.
- Number fields that hold a few digits take `width="narrow"`.
- `Inline even` lays a row of equal fields or choice cards on an equal-column grid that wraps below
  12rem. Only a `Card` child stretches.
- A labelled checkbox is md (14). An unlabelled one is sm (12) unless the caller asks for md.
- Required fields have no convention yet; it is a deferred product call. Do not invent a marker.

## Dialogs

- Every dialog is `Modal` at 420, 560, 720, or 820 wide. The palette is exempt.
- The title is 15px at `--heading-weight`, in sentence case, in a 48-high bar with a divider and a close
  `IconButton` at its end. It is the dialog's only title; no body heading repeats it. Titles do not end
  in "?" (armed buttons do).
- Focus moves inside on open: `autoFocus` if given, else the first control in the body. An
  `alertdialog` starts on its first footer button that is not `solid`, which is **Cancel**. Closing
  returns focus to the opener.
- The footer, in order: any extra or destructive secondary, a `Toolbar.Spacer`, **Cancel** as `ghost`
  (**Close** when there is nothing to cancel), then exactly one `solid` primary named for its action,
  `tone="danger"` if it destroys. All buttons md. No hint text in the footer.
- An interrupting flow is a `Modal`. A settings flow stays on the page.

## Page forms

A page form (a settings detail page with fields and a save) is `Field`s in a `Stack gap="stack"`, then a
left-aligned `Inline gap="row"` under the last field: the one `solid` primary first, then **Cancel** as
`ghost` (plan decision 1). Errors go between the last field and the buttons.

A boxed form on a page (pairing a node, adding a run target) is a `Card` of the same fields and the same
left footer. A flow of three or more screens says "Step 2 of 3" in a muted line at the top of its form.

The wizard footer matches the modal footer: skip (ghost) at the start, a spacer, **Back** (ghost), then
the solid primary, with the modal footer's padding and divider (plan decision 15).

## Empty states

- An empty page, pane, or detail column uses the centred `EmptyState` with a title. The title says what
  is missing, the body says how to get it, the action does it. Titles have no trailing period.
- A list's "no rows" line is `EmptyState align="start" size="sm"`, standing in for the rows. Say "none"
  and "none match a filter" differently.
- Loading is `EmptyState busy align="start" size="sm"` "Loading…". A busy start-aligned state puts the
  spinner and text in one row.
- A failure says what failed in one sentence, gives a plain reason, and offers **Try again** (or
  **Reconnect** for an auth failure). Never show a raw error code. Write "Couldn't", not "Could not".

## List and detail, and rows

- A list column is `SectionHeader` (48), then optional `Tabs`, then an optional filter in
  `Toolbar size="sm"`, then `Rows`. A detail column is a `Toolbar` header and a body, or a centred
  `EmptyState` when nothing is selected.
- A `Row` is 36 high (compact 30, roomy 44), padded `--pane-pad` with a 3px marker, so row text starts
  at 17.
- Row meta shrinks, caps at half the row, and ends in an ellipsis; the body keeps at least `8ch`. Keep
  meta short ("14m", "Up 14h") and put the full value in a tip.
- In a row body written as a line of texts, the first keeps its width and the rest give way, so a file
  name stays whole.
- `RowActions` hides until hover, focus, or selection, and stays while its menu is open.
- Tips open with no delay, so a tip on every row of a long list can flash under a moving pointer.
  `TreeRow` keeps the native `title` for that reason. Judge a row tip in the window.
- An include or stage checkbox in a list is the row's last trailing control, lined up with its group's
  box, with a styled tip. In a full-width pane it leads instead (`Fold leading`).
- Do not change row heights, the diff's line height, or virtual-list geometry in this pass.

## Status badges

- Status is a toned `Badge` with a sentence-case word: Open, Draft, Merged, Closed; Passed, Failed,
  Running; Connected, Needs you, Off; Installed, Not installed. Never an enum word, never colour alone.
- A dot that stays gets `StatusDot tip`. A badge whose word needs a reason gets `Badge tip` (a tipped
  badge is a tab stop).
- Every small bordered label is a `Badge`. `Chip` is the interactive node; never use it as a label.
  Nothing hand-rolls a chip.

## Alerts, menus, tooltips, and toasts

- An inline `Alert` has no outer margin. Its buttons go in `actions`, `--space-3` after the text,
  forced to sm. A banner inside a list column takes the pane pad inline.
- `Menu` is at least 10rem wide. A destructive item is `tone="danger"`, last, below a separator, and
  either arms with `confirm="{Verb} {thing}?"` or opens a dialog and ends in "…". A chosen item is
  `Menu.Item checked` with `kind="radio"` or `"checkbox"`; a checkbox item keeps the menu open. Group a
  long menu with `Menu.Label` and `Menu.Separator`, which both hosts draw.
- A popover's header is `SectionHeader level="group"` (plan decision 4).
- Every hover label is the styled tip. Kit nodes route `title` to it. It flips to the other side at the
  window edge and clamps vertically. Write chords through `formatChord`.
- Toasts stack top right, under the top bar, in every view (lead's override 1). An autosave is silent
  unless it fails.
- Floating surfaces read one token set: `--popover-bg`, `--surface-border`, `--elev-popover` or
  `--elev-modal`.

## Copy

- The product is "acorn", lower case, in running text.
- Plain words, short sentences, sentence case, no em dashes. Load the `readable` skill first.
- When a label changes, change its settings search declaration and any test that asserts the old text.
- Plugins are named by `pluginLabel(idOrRow)` (from `@acorn/plugin-api/client`), which falls back to the
  id. Paths are shortened with `formatPath` (core only; it keeps the last two folders and writes the
  home folder as `~`). Chords go through `formatChord`.
- Vocabulary, until the product call: "this computer" in static copy about the machine the window runs
  on; **This device** for device-scoped chips; the node's label where the code knows it is another
  machine.

## Decisions this plan takes

These settled conflicts between areas. Each is reversible. Status as of 2026-10-01.

1. **Page-form footers are a left-aligned `Inline gap="row"`:** the one `solid` primary first, then
   **Cancel** as `ghost`, under the last field. Modal footers stay `Modal.Actions`, right-aligned.
   Applies.
2. **Cancel is `ghost` everywhere,** never bare or outline. Applies.
3. **A modal title looks like a detail title:** 15px, `--heading-weight`, `--text`, sentence case, in a
   48-high bar. Shipped in K4a.
4. **Popover headers are `SectionHeader level="group"`.** No `Popover title` prop. Applies.
5. **An "add" action in a section's actions is outline sm.** Applies.
6. **The app menu trigger is `IconButton icon="menu"`.** Every "more actions" on an item is
   `icon="ellipsis"`. Shipped in B02.
7. Toasts move to the top right in the task view only. **Overruled** by the lead's override 1: toasts
   take one position everywhere.
8. **The top bar keeps `--bg`.** Every other chrome bar is `--bg-subtle`. Shipped in K2.
9. **`ConfirmButton` keeps `confirmLabel` optional,** default "Confirm?". Every call site passes a
   "{Verb} {thing}?" label. Applies to new call sites.
10. **Settings tabs get the CSS stopgap:** flush with the header divider. Moving tabs into the frame
    header is deferred. Shipped in K2.
11. **No `labelHidden` prop.** A page with one section renames the section. Applies.
12. **List status in settings is a toned `Badge` word plus the description line,** never the row's
    `error`. Applies (B06).
13. **Findings titles are derived on the client** from the body, so old records benefit too. Applies
    (B08b).
14. **Kept as they are, on purpose:** the workflow editor's **Save** button, the default Home tab name
    "Home", and the Notes autosave toast (the toast is a deferred product call). Applies.
15. **The wizard footer matches the modal footer.** Shipped in K4a.
16. **The Connect GitHub card is hidden** when this build cannot sign in to GitHub. Shipped in B01.
17. **`Text` draws at 12px for every emphasis.** The agent timeline keeps its inherited size. Shipped in
    K1b.
18. **The remote-tree number fix lands on both sides:** the tree SDK and the host sanitiser. Shipped in
    K4a.
19. **`NodeDevices.tsx` is deleted.** Shipped in B05.
20. **New optional kit props, no new nodes:** `Inline even`, `Fold leading`, `Badge tip`, `StatusDot tip`,
    `DetailColumn measure`, `Picker removeLabel` with a confirming remove, `Menu.Item checked` and
    `kind`, `Field help`, and the wizard labels on `LayoutProps`. All shipped. A later batch that needs a
    new prop adds it the same way: the prop, its terminal rendering, one 80-column sentence in
    `docs/ui-design.md` § Every node at 80 by 24, and a line in `props.test-d.ts`.

## Lead's overrides

These came from the lead after reviewing the plan, and win over anything else. Numbering follows the
plan, which has no override 4.

- **Override 1. Toasts take one position across the whole app,** top right under the top bar, so they
  never cover **Send**. Shipped in K4a. Keep it.
- **Override 2. Plugin display names.** 06-7 left the deferred list and became K5. Shipped. Use
  `pluginLabel`.
- **Override 3. No sub-agents.** One agent does each batch, alone. Still applies.
- **Override 5. Never narrow the style-token contract.** `STYLE_TOKEN_FAMILIES` in
  `packages/protocol/src/appearance/styleValues.ts` is what a plugin's style pack is validated against,
  so removing a token makes an older plugin's manifest fail to parse. Adding tokens is fine; removing
  one is not. Still applies.
- **Override 6. Other checkouts are off limits.** Another worktree may run its own acorn window. Never
  stop, signal, or reuse a process that is not this worktree's session or one you started. Still
  applies.
