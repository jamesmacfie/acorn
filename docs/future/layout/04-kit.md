# The kit: a closed set of components with semantic props

Part of [docs/future/layout/](./README.md). The kit is the vocabulary everything else is written in.
It is closed: every component a plugin may use is on this page, its props are role tokens, and each
one has a defined rendering on a host with no pixels. The kit lives in
`packages/client-core/src/ui/` and reaches plugins through `@acorn/plugin-api/ui`, as today.

## What changes about today's kit

Forty components are imported from the kit now (`02-survey.md` lists them by role). Three things
change:

1. **Nine arranging components become layouts** the host owns rather than nodes a plugin emits:
   `ListDetail`, `DocumentTabs`, `SplitHandle`, `Drawer`, `SectionHeader` as a pane header,
   and the wizard, header-body-footer, and stack-split patterns nobody had named.
   [05-layouts.md](./05-layouts.md) owns them.
2. **Nine nodes are added**, each replacing a pattern hand-written in two or more plugins.
3. **`class` and `style` disappear from every node's props.** Today `ButtonProps` is
   `ComponentProps<'button'> & {...}`, and most primitives accept `class?: string`
   (`ui/primitives.tsx`). After phase 0 a node's props are its own semantic set and nothing
   from the DOM. The "primitive adoption ratchet" in `docs/ui-design.md` becomes "closed kit."

## The node set

About 40 nodes. Each row: role, the props a plugin may set, the focus role the kit fixes for it, and
the rendering at 80 by 24 in monochrome. That last column is a requirement of the admission rule
even though no terminal host is built here; if it cannot be written, the thing is a rectangle.

### Grouping

| Node | Props | Focus | At 80×24 |
| --- | --- | --- | --- |
| `Stack` | `gap: space` | none | children on successive lines, `gap` as blank lines (0 or 1) |
| `Inline` | `gap: space`, `wrap` | none | children on one line separated by a space; wraps to `Stack` when too wide |
| `Section` | `label`, `collapsed?` | header is a stop only when collapsible | label in dim uppercase, children below |
| `Fold` | `label`, `meta?`, `defaultOpen`, `onOpenChange` | header is a stop | `▸ label` or `▾ label`, children indented two cells |
| `Card` | `tone`, `border`, `role?` | none unless it has `onPress` | a box-drawing frame, or a blank line above and below in compact density |
| `Timeline` | children `Card`s | one stop, roving | cards in sequence, a dim rule between turns |
| `Tabs` | `tabs: [{ id, label, badge? }]`, `selected`, `onSelect` | one stop, roving with left and right | `Tab  [Tab]  Tab` on one line, selected in brackets |
| `Toolbar` | `size`, `align` | none | children on one line |
| `Modal` | `title`, `size`, `onDismiss` | traps focus; Escape dismisses | a centred box over dimmed content |
| `Menu` | `items: [{ id, label, tone?, disabled? }]`, `onSelect` | roving | a vertical list in a box |
| `Slot` | `point`, `mode`, `key?`, `max?` | inherits from occupants | inherits |

### Showing

| Node | Props | Focus | At 80×24 |
| --- | --- | --- | --- |
| `Text` | `emphasis: text`, `tone`, `wrap` | none | plain text; `mono` is a no-op; `muted` is dim; `strong` is bold |
| `Heading` | `level: 1..3`, `eyebrow?` | none | eyebrow in dim uppercase, heading in bold |
| `Row` | `title`, `subtitle?`, `meta?`, `icon?`, `badge?`, `status?`, `selected?`, `checked?`, `actions?`, `onPress`, `onToggle` | item in a collection | one line: status glyph, title, meta right-aligned; subtitle on a second line if room |
| `TreeRow` | `Row` plus `depth`, `expanded?`, `onExpand` | item in a collection | `Row` indented `depth` cells with `▸` or `▾` |
| `Badge` | `tone`, `text` | none | `[text]` in the tone's colour |
| `Chip` | `text`, `icon?`, `onRemove?` | a stop if removable | `(text)` |
| `ChipRow` | children `Chip`s | one stop, roving | chips on one line, wrapping |
| `StatusDot` | `tone`, `pulse?`, `label` | none | `●` in colour, `○` for neutral |
| `Facts` | `items: [[label, value]]` | none | two columns, labels dim |
| `Table` | `columns`, `rows`, `onSelectRow?` | rows are a collection | box-drawn table, truncating columns by priority |
| `Grid` | virtualised `Table` for large data | rows are a collection | as `Table`, with a row range indicator |
| `Meter` | `value`, `max`, `label`, `tone: auto | tone`, `compact?` | none | `████░░░░ 62%` |
| `CodeBlock` | `text`, `language?`, `wrap?`, `maxHeight: size` | none; scrolls when focused | monospace lines, dim rule above and below |
| `Log` | `lines`, `follow?`, `find?` | one stop | monospace lines, find as a bottom line |
| `Markdown` | `text` | links are stops | reduced: headings bold, lists as `•`, code in a `CodeBlock`, no images, no wide tables |
| `DiffPane` | `file`, `mode`, `annotations?` | lines are a collection | reduced: unified only, `+`/`-` in colour, annotations as indented lines under their row |
| `EmptyState` | `text`, `icon?`, `busy?` | none | centred dim text |
| `Alert` | `tone`, `title?`, `text` | none | a line prefixed with the tone glyph |
| `Spinner` | `label` | none | a braille spinner or `…` |
| `Kbd` | `chord` | none | `⌘K` or `ctrl+k` per host |
| `Avatar` | `name`, `image?` | none | initials in brackets |
| `Icon` | `name`, `tone?` | none | a glyph from a small name table, or nothing |
| `Image` | `src`, `alt` | none | `alt` in brackets; nothing else |

### Asking

| Node | Props | Focus | At 80×24 |
| --- | --- | --- | --- |
| `Button` | `label`, `tone`, `variant: solid | outline | ghost`, `size`, `icon?`, `busy?`, `onPress` | a stop; Enter or Space activates | `[ label ]`, or `[l]abel` with a mnemonic |
| `ConfirmButton` | `Button` plus `confirmLabel`, `onConfirm` | a stop; second press confirms | `[ Delete? ]` on first press |
| `Input` | `value`, `placeholder`, `onChange` (commit), `onSubmit?` | a stop; owns keys while focused | an underlined field |
| `Textarea` | `value`, `rows: size`, `onChange` | a stop; owns keys | a boxed multi-line field |
| `Select` | `options`, `value`, `onChange` | a stop; up and down change | `[ value ▾ ]`, opens a `Menu` |
| `Checkbox` | `checked`, `label`, `onChange` | a stop; Space toggles | `[x] label` |
| `SegmentedControl` | `options`, `value`, `onChange` | one stop, roving | `( a | [b] | c )` |
| `Toggle` | `pressed`, `label`, `onChange` | a stop | `[x] label` |
| `Picker` | `items`, `onPick`, `placeholder` | a stop that opens a list | a field that opens a `Menu` filtered by typing |
| `Composer` | `value`, `onSubmit`, `onChange`, children slots | a stop; owns keys; `commit` submits | a boxed field with a `> ` prompt |
| `KeyValueEditor` | `rows`, `onChange` | rows are a collection | two-column table with editable cells |
| `FindBar` | `query`, `count`, `current`, `onChange`, `onNext`, `onPrev` | a stop | `/ query  3/12` on one line |
| `Field` | `label`, `hint?`, `error?` | none | label above the child |

### Pixels

| Node | Props | Focus | At 80×24 |
| --- | --- | --- | --- |
| `Rectangle` | `kind: pty | webview | frame`, kind-specific props, `Fallback` child | one stop; Enter enters, Escape leaves | `pty`: native. `webview`, `frame`: the `Fallback` child or nothing |

### Host wrappers

| Node | Purpose |
| --- | --- |
| `Only hosts={[...]}` | Children exist only on the named hosts. No fallback wanted. |
| `Fallback` | Inside a node whose support is `absent` or `fallback` on this host: what to draw instead. |

## Role tokens

The only values a kit prop accepts. A plugin never names a pixel, a colour, a class, or a scale
step.

```ts
// @acorn/plugin-api/ui/tokens
export const space    = ['none', 'inline', 'row', 'stack', 'section'] as const
export const size     = ['xs', 'sm', 'md', 'lg'] as const
export const tone     = ['neutral', 'muted', 'accent', 'ok', 'warn', 'danger'] as const
export const text     = ['body', 'strong', 'muted', 'mono', 'eyebrow', 'heading'] as const
export const border   = ['none', 'divider', 'control', 'surface', 'stripe'] as const
export const radius   = ['control', 'surface', 'chip', 'pill'] as const
```

Each host owns the mapping from role to value. The DOM mapping is the CSS custom property system
that already exists: `client-core/src/ui/tokenAxes.ts` declares the theme axis (colour, restated per
theme in `styles/tokens-theme.css`) and the style axis (shape, space, density, in
`styles/tokens-style.css`). Many of its properties are already roles, `--radius-control`, `--gap-row`,
`--divider`, `--state-warn`, and the border-role rule in `docs/ui-design.md` is this principle applied
to one category. The terminal mapping is documented now and implemented later.

| Role | DOM value | Terminal value |
| --- | --- | --- |
| `space.inline` | `var(--gap-inline)` | one cell |
| `space.row` | `var(--gap-row)` | 0 lines |
| `space.stack` | `var(--gap-stack)` | 0 lines |
| `space.section` | `var(--gap-section)` | 1 blank line |
| `border.divider` | `var(--divider)`, width may be 0 in a pack | `─`, or nothing in compact density |
| `border.control` | `var(--control-border)` | underline |
| `border.surface` | `var(--surface-border)` | box-drawing corners |
| `border.stripe` | `var(--stripe-w)` on the start edge | `▍` in the tone colour |
| `radius.*` | `var(--radius-control)` etc. | ignored |
| `tone.warn` | `var(--state-warn)`, per theme | the palette's yellow, per theme |
| `tone.muted` | `var(--fg-muted)` | dim |
| `text.mono` | the mono stack | no-op |
| `text.eyebrow` | small caps, letter-spaced, muted | dim uppercase |
| `size.sm` | `--row-h-sm`, `--control-h-sm` | one line either way; affects padding only |

So a theme stays forty-odd colours, and on a terminal it is sixteen of them plus dim and bold. A
style pack stays shape and space, and on a terminal most of it is ignored, which is honest: the
`cute` pack's 55 overrides are radii and paddings a terminal does not have. Density is the one style
axis a terminal keeps.

## The support matrix

Which hosts can draw which node, as data with a test behind it, the same pattern `tokenAxes.ts` uses
for "which axis owns this token."

```ts
// ui/kit/support.ts
export const NODE_SUPPORT = {
  Row:       { dom: 'full', tui: 'full' },
  Meter:     { dom: 'full', tui: 'full' },
  Markdown:  { dom: 'full', tui: 'reduced' },
  DiffPane:  { dom: 'full', tui: 'reduced' },
  Tooltip:   { dom: 'full', tui: 'fallback' },
  Image:     { dom: 'full', tui: 'absent' },
  Rectangle: { dom: 'full', tui: 'absent' },   // kind="pty" is the exception, handled in the node
} as const satisfies Record<KitNode, Record<Host, SupportLevel>>
```

Four levels with defined behaviour, so an author can predict a host without running it:

- **full**: same meaning, drawn natively.
- **reduced**: drawn, with named things missing. The node's row says what.
- **fallback**: not drawn; the host draws a stated substitute. The author does nothing.
- **absent**: nothing is drawn. If the node has a `Fallback` child, that is drawn instead.

Only `dom` is implemented in this programme. The `tui` column is documentation with a test that it
is filled in, so a node cannot be added without deciding what it does there.

## Where the classnames go

They move inward. Today a plugin writes `<div class="agent-composer-actions">` and the class is
layout. After this, only kit components have classes, they are internal to the DOM host, and they read
the same CSS variables they read now. A plugin never sees a class. The 700 raw tags in the survey
become kit nodes with role props, and per-plugin stylesheets are deleted rather than ported. The
loaded four went first and their four are gone (phase 5), the small compiled panes took theirs with
them (phase 6), and github's four went in phase 7. The agents CSS and the terminal drawer's outer box
are what is left. **A plugin with a `.css` file has not moved yet.**

The `ui/` purity rule stays: nothing under `client-core/src/ui/` may import state. Some focus
machinery that lives in `/ui/host` today (the palette surface, focus trapping) moves into the kit in
phase 2, because `Menu` and `Modal` nodes need it; the rule is preserved by moving the mechanism, not
the state.

## Tests

Modelled on `client-core/src/styles/tokenAxes.test.ts`, which reads the stylesheets and asserts they
agree with the declared axes.

1. Every exported kit node has a row in `NODE_SUPPORT`, and every row names a node.
2. Every role in the token enums has a value in every host mapping. The terminal mapping may say
   `ignored`; it may not be missing.
3. No kit node's props type accepts `class`, `className`, `style`, or an arbitrary `string` where a
   role enum is expected. Checked with a type-level test against the exported prop types.
4. No file under `plugins/*/src` imports a `.css` file (phase 9, once the moves are done).
5. The existing `adoption.test.ts` ratchet inverts: instead of counting primitives adopted, it fails
   on any raw `div` or `span` in a plugin's client or frame tree.

## Doors left open

- No node may take a pixel, a colour, or a class, so nothing in the kit is DOM-only by accident.
- The `tui` column exists from day one even though nothing reads it.
- `Only` and `Fallback` exist from day one so plugins can be written against a second host before
  it exists.
