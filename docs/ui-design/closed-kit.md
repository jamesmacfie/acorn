# The closed UI kit

This page covers the closed kit: what a node must meet to join, what closing the list implies, the
kit's special nodes, its invariants, and what it refuses. Read it before you add a kit node or a prop.
It's part of [UI design](../ui-design.md).

## The closed kit

Every component a plugin may draw with is in one list, in `packages/client-core/src/kit/`, reaching
plugins through `@acorn/plugin-api/ui`. The list is closed: a component's props are role tokens,
content, counts, booleans, and handlers, never `class`, `className`, `style`, or a DOM attribute.
`@acorn/plugin-api/ui/tokens` carries the role enums and the support matrix as data, with no
components, so a Node test can read them.

A node joins only if all four of these hold:

1. Two or more plugins need it, or one first-party pane can't be expressed without it.
2. It has a written rendering at 80 columns by 24 rows in monochrome, and a terminal component that
   draws it. If that sentence can't be written, the thing is a rectangle, not a node.
3. Its props are semantic: tone, emphasis, size in three steps, and grouping. Never a pixel, a color,
   a class, or a style.
4. If it's an extension kind, one host-owned sentence describes it in the trust prompt, and a person
   would knowingly accept that sentence.

Layouts follow the same rule ([pane layouts](../panes/layout.md#layout-model)), where condition 2 is a
written narrow and terminal projection.

Closing the list has three consequences, and each has a test:

- **A node takes a meaning, not a value.** `tone="danger"`, `gap="section"`, `size="sm"`. So a host
  with no pixels can draw the same tree. `kit/tokens/tokens.ts` declares the six enums, and
  `kit/tokens/roles.ts` maps each role to a CSS custom property and a terminal value. That mapping is
  the only place outside a stylesheet that names a custom property.
- **A node says which hosts can draw it.** `kit/tokens/support.ts` holds a row per node with a `dom`
  and a `tui` column, at one of four levels. `full` draws natively, `reduced` draws with named things
  missing, `fallback` draws a stated substitute, and `absent` draws nothing unless the node has a
  `<Fallback>` child. A `reduced` row names what's missing in a `loss` beside its level. The
  80-column sentence for each node is in [every node at 80 by 24](./every-node.md).
- **The classes moved inward.** A kit component keeps its `ui-*` classes and styles its own children
  by position, as in `.ui-code-wrap > .ui-btn`. Nothing exported accepts a class, and `cx.ts` is
  internal. A pane that wants a control to look different asks the kit.

`HOST` in `support.ts` is set at build time: `apps/desktop`'s Vite config defines it as `dom` and
`apps/tui`'s as `tui`. Where nothing defines it, such as a test or a browser served by a Node, it's
`dom`. Only `Only` and `Fallback` read it. A node that wants to know its host is about to draw
something host-specific, and the answer is a `<Fallback>` child, not a branch.

Two hosts draw the whole kit: `dom`, the desktop and browser, from
`packages/client-core/src/host/tree/components.ts`, and `tui`, the terminal, from
`apps/tui/src/kit/components.tsx`. `tools/arch/kitTable.test.ts` holds both tables and the matrix to
the same keys.

Compiled controls can compose nodes without joining the remote vocabulary. `ModelPickerPopover` and
`IconPicker` on `@acorn/plugin-api/ui/host` are compositions each host provides, with no support-matrix
row. The terminal `IconPicker` draws an editable icon name and a reset button, without previews or
random selection.

### Special nodes

**`Graph` is a picture and a list.** It draws cards on a grid with curved edges. The workflows editor
authors a definition on it and the run pane watches a run on it. It's in the kit because plugin client
code can't emit raw DOM or SVG, and both projections were written first. In cells it's an indented
list: the same cards, order, and selection, indented by rank. `kit/lib/layout/graphLayout.ts` is the
shared geometry. Where a card goes is a device preference the caller holds.

**`Rectangle` is a box.** `kind="pty" | "webview" | "frame" | "editor"` is what the kit offers a view
that owns its pixels. The node owns the box and the keyboard contract: one tab stop from outside,
Enter to hand the keys inside, and Escape to take them back. There are four kinds and no fifth, because
a kind a host doesn't know can't be projected. In a terminal, `pty` and `editor` are native and the
others draw their `<Fallback>`. `mount` hands the element to whatever draws inside, so the terminal
drawer, Docker's exec tab, the browser preview, the editor pane, and the host's document surface ship
no element or CSS of their own.

**`Only` and `Fallback` are the host wrappers.** `Only hosts={['dom']}` draws its children only on the
named hosts. `Fallback forNode="Grid"` draws its children where the matrix says this host can't draw
that node.

**A node has one name, and a handler has one of twelve.** On the remote path a node is a type string
and a prop is JSON. A dotted name can't cross, so `Modal.Body`, `Modal.Actions`, `Tabs.Panel`, and
`Toolbar.Spacer` are also exported as `ModalBody`, `ModalActions`, `TabPanel`, and `ToolbarSpacer`. A
callback prop crosses only under one of the kit's 12 semantic events, which is why `Modal` takes
`onDismiss`, `Input` and `Textarea` take `onChange` for the committed value, and `Grid` takes
`onSelect`. `ConfirmButton` sends `onConfirm` after its own confirmation. A name outside the twelve,
such as `onInput`, `onKeyDown`, or `onPaste`, works in the shell and is dropped on the way to a sandbox.

**A prop that has to hold an element has a data form beside it.** `ListDetail`'s `list` prop can't
cross, so `ListColumn` and `DetailColumn` are children. `Picker`'s `results(query)` callback can't, so
`items` is a list it filters itself. `DescriptionList.Item` children can't, so `Facts` takes
`{ label, value }` pairs. The callback forms stay for shell code.

**Two nodes are a settings page.** `SettingsSection` and `SettingRow` draw the label-left,
control-right shape every settings page uses ([settings](../frontend/settings.md) § Settings). The row draws
the save state without owning it: `savedAt` is a timestamp, so the row keeps the two-second **Saved**
timer, and `error` is a string. `from` names where a value is set and wraps the control in a disabled
fieldset. `scope="device"` marks a row this device stores on a page about the Node, with the **This
device** chip at row size. `onReset` is shell-side, because reset isn't one of the twelve events. A
section's `id` is an anchor scoped to its page, so two pages can each have a `general` section.
`description` holds what you need to choose now, and `help` holds how it works
([the help mark](./tooltips.md#the-help-mark)). An older acorn ignores `help`.

A row's label is a `<label for>` its one control, so clicking **Play a sound** flips the switch.
`Field` does the same and links its hint, error, and help by `aria-describedby`. The control claims
the ID through a context in `kit/components/inputs/controlAttrs.ts`: `Input`, `Textarea`, `Select`,
`Picker`, and a `Checkbox` without its own words call `claimField`. A second claim means several
controls, so the label names none, and the row stays a `role="group"`. In a terminal, a row whose value
is set elsewhere says where and draws no control.

[How the kit is built](./kit-internals.md) covers the CSS layering, timeline behavior, and Markdown
rendering.

## The three kit invariants

These three tests hold the kit to its declarations, modeled on `styles/tokenAxes.test.ts`:

- `kit/tokens/support.test.ts` reads the `/ui` barrel and asserts that its exported nodes and the rows
  in `NODE_SUPPORT` are the same list, with a `tui` level on every row.
- `kit/tokens/roles.test.ts` asserts that every role in every enum has a desktop value and a terminal
  value, and that each desktop value names a token `tokenAxes.ts` declares.
- `kit/tokens/props.test-d.ts` is a type-level test: no exported node's props accept `class`,
  `className`, `style`, or `classList`, and no role-typed prop accepts any string. `tsc --noEmit`,
  which `pnpm lint` runs, is the check.

## What the kit refuses

Each of these will be asked for again. The security refusals, such as an iframe inside an iframe,
free `postMessage` between plugin origins, nested slots, and reopening `frame-src`, are in
[security](../security.md), and the plugin ones in [plugins](../plugins.md).

- **Styling props on kit nodes.** No `class`, `className`, or `style`, even "just for desktop". Once a
  plugin can name a pixel or a color, a terminal host has to guess. A plugin that needs its brand
  purple has a rectangle.
- **Raw scale values in a plugin-facing enum.** `space.row`, never `space.3` or `gap: 8`. A terminal
  has no value for 8.
- **Plugin-positioned layout.** A plugin picks a layout and fills regions. `orientation`, `columns`,
  and `width` settings are refused, and a new named layout is the answer.
- **Anything that depends on hover.** Everything reachable on hover is reachable by focus.
  `kit/tokens/hover.test.ts` fails if a `:hover` rule reveals something no `:focus-within` rule does.
- **Controlled and uncontrolled selection mixed on one node.** The host owns `selected` by default,
  and a node that declares controlled mode is controlled for every operation.

## What the kit and layouts must never do

These 12 constraints keep the terminal client and a future mobile web app possible:

1. No `class`, `className`, or `style` prop on any kit node.
2. No raw scale value in a plugin-facing enum.
3. No plugin-positioned layout.
4. No key event reaches a plugin outside `Input`, `Textarea`, `Composer`, `MentionTextarea`, and the
   inside of a rectangle.
5. No second keymap: one engine, one command catalog, and one adapter per host
   ([focus and typing](../command-palette-and-shortcuts/focus-and-typing.md)).
6. No kit node without a support row and an 80 by 24 sentence.
7. No layout without both projections written down.
8. No iframe inside an iframe. `frame-src 'none'` stays.
9. No `postMessage` between plugin origins that the host doesn't carry and validate.
10. No static widget schema. Logic stays in plugin code, and the wire is a tree of kit nodes.
11. No hover-only control.
12. No node or layout that reads `window`, the pointer, or a key code.
