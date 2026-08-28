# Focus and keys: navigation the tree gives for free

Part of [docs/future/layout/](./README.md). Keyboard navigation is an afterthought today:
`createListNavigation` and `trapOverlayFocus` in `client-core/src/ui/focus.ts`, attached where
someone remembered, and DOM defaults everywhere else. Once plugins can only emit kit nodes and pick
layouts, the host knows the whole tree, and the tree can carry focus. Every list gets arrows and
type-ahead, every modal traps and restores, every layout has one chord to move between regions, and
the same model gives ARIA roles on the DOM and, later, an identical keyboard story in a terminal.

## What exists today

- `client-core/src/registries/keybindings.ts`: a registry with four scopes,
  `KeybindingScope = 'global' | 'task' | 'pane' | 'typing-exempt'`, resolved against a frame's
  context, with conflict detection between scopes.
- `client-core/src/registries/commands.ts`: the command registry the palette reads.
- `client-core/src/tasks/tasks.ts`: `focusedPane(taskId)`, one focused pane per task.
- `client-core/src/ui/focus.ts`: `nextListIndex`, `createListNavigation`, `trapOverlayFocus`.
- `client-core/src/plugins/frames/`: frames receive keydowns over the bridge, `claimsKeys` from the
  manifest says which chords a frame may keep, and `DocumentSurface` resolves a chord pressed inside
  the host editor, flushes, and delivers it to the frame region.
- `docs/command-palette-and-shortcuts.md` § Focus and typing describes the current forwarding.

## The four references, and what each contributes

**ratatui** has no focus system. The app owns a focus enum and widgets are stateless renderers that
take state (`ListState { offset, selected }`) from outside. Lesson: selection and scroll are data
owned outside the widget and keyed by the thing being listed. That is what keeps a list's place when
its rows are rebuilt.

**opentui** is a retained tree. A `Renderable` declares `focusable`; `focus()` subscribes it to key
presses and `blur()` unsubscribes; the change propagates up the parents as `hasFocusedDescendant`
so a container knows it has focus within; a click walks up to the nearest focusable. Lesson: the
structure the remote tree host wants, and it is what the DOM does natively made explicit.

**`@opentui/keymap`**, opentui's separate package, is the engine this programme adopts. A
host-agnostic core over a small `KeymapHost` interface (focused target, parent traversal, key press,
focus change, target destroyed), with an HTML adapter and a terminal adapter already written, Solid
helpers, focus-scoped binding layers (`global`, `focus`, `focus-within`) with priority and
fallthrough, multi-key sequences with exact-versus-prefix disambiguation, a command catalog with
visibility tiers, and diagnostics for shadowed and dead bindings.

**Flutter** maps keys to intents in a `Shortcuts` layer and lets widgets handle intents through
`Actions`. Platform differences live in the shortcut map only. Lesson: components never see a key.

**React Aria** and its Solid port **Kobalte** treat every collection as one tab stop with roving
focus, arrows, Home and End, type-ahead, and selection kept separately from items
(`useSelectableCollection`, `useListState`). **Textual** declares bindings on widgets, derives the
focus chain from the tree, and renders the active bindings as a footer from that data.

## The model

Four layers. The host is in the middle of all of them and a plugin touches none directly.

### 1. Focus is a property of the tree, fixed by the kit

Each kit node has a focus role the plugin cannot change ([04-kit.md](./04-kit.md) lists them):

- **Stops**: `Button`, `Input`, `Textarea`, `Select`, `Checkbox`, `Toggle`, `Picker`, `Composer`,
  `FindBar`, a `Fold` header, a removable `Chip`, a `Rectangle`.
- **Collections**, one stop with roving focus inside: a run of `Row`s or `TreeRow`s, `Tabs`, `Menu`,
  `SegmentedControl`, `ChipRow`, `Table` and `Grid` rows, `Timeline` cards, `DiffPane` lines,
  `KeyValueEditor` rows.
- **Not focusable**: `Text`, `Heading`, `Badge`, `StatusDot`, `Meter`, `Facts`, `Alert`,
  `EmptyState`, `Icon`, `Image`, `Stack`, `Inline`.
- **Traps**: `Modal` and `Menu` while open; focus returns to the opener on dismiss.

Layout regions are **focus groups**. `nextRegion` and `prevRegion` move between them; each group
remembers its last focused node; the task layout row is the outermost group. This generalises
`focusedPane` to every region of every pane and replaces it.

Focus-within propagates up the tree, so a `Card` or a region can draw a focus-within state without
the plugin asking.

### 2. Collection state is the host's, keyed by identity

For every collection node the host keeps: `active` (where roving focus is), `selected`, and `offset`
(scroll). For every focusable: `focused` and `pressed`. On the DOM host only: `hovered`. All of it is
in a host store keyed by the node's stable key, not its index, so a list rebuilt from new data keeps
its place. This is `ListState` with the host holding it, and it is the standing fix for the `<For>`
versus `<Index>` defocus bug recorded in the memory index.

The plugin reads this state as events, `onSelect`, `onActivate`, `onFocus`, and may control
`selected` if it declares so on the node. Controlled mode is all-or-nothing per node; a plugin never
manages `active` or `offset`.

### 3. Keys become intents before anyone sees them

A closed set:

```
next  prev  first  last  pageNext  pagePrev
expand  collapse  activate  dismiss  commit
search  menu  delete
nextRegion  prevRegion  nextPane  prevPane
```

The keymap maps platform keys to intents. Kit nodes handle intents. A plugin receives only the
semantic events above and never a key. The map is per host: on desktop `↓` and, outside inputs, `j`
are both `next`; `Enter` and `Space` are `activate` on a button and `Enter` alone is `commit` in a
composer; `Escape` is `dismiss`; `Cmd+Enter` on macOS and `Ctrl+Enter` elsewhere are `commit`.

`Input`, `Textarea`, and `Composer` own their keys while focused. Typing-exempt intents (`dismiss`,
`commit`, and the region chords) still pass, which is today's `typing-exempt` scope and
`lib/isTypingTarget.ts` made structural.

An intent bubbles: the focused node handles it or not; then its ancestors up to the region; then the
region's layer; then the global layer, which is the command registry. `Menu` and `Modal` stop the
bubble while open.

### 4. Bindings are layers over the same tree

`@opentui/keymap` provides the layers; acorn's four scopes map onto them:

| Today's `KeybindingScope` | Keymap layer | Target |
| --- | --- | --- |
| `global` | `global` | the root |
| `task` | `focus-within` | the task layout row |
| `pane` | `focus-within` | the pane's layout, or a region of it |
| `typing-exempt` | a `fallthrough` flag on a global binding | reaches inputs |

The command registry is the keymap's command catalog. A plugin binds commands to its own nodes and
regions in the manifest as today; the host renders the active bindings from the same data as a
cheat-sheet on desktop (and, later, a footer strip in the terminal, which is the Textual pattern).
Multi-key sequences are allowed; a leader key is not enabled on desktop.

`@opentui/keymap`'s HTML adapter tracks targets with a `MutationObserver`; the direct render path
gives it real DOM nodes and the remote path gives it the host-mounted components, so both paths are
one keymap with no adapter of our own.

### Rectangles

A rectangle is one focus stop. `activate` enters it and hands the iframe focus; `dismiss` inside
returns focus to the host. Inside, the frame's own keys apply and `claimsKeys` governs which host
chords it may keep, unchanged from today. `DocumentSurface`'s flush-then-deliver for a chord pressed
inside the host editor is unchanged; it is the one place a host chord reaches into a plugin, and it
stays declared per command (`surfaceAction`).

## Rules with tests behind them

- **Hover is never load-bearing.** Anything reachable on hover is reachable by focus. `RowActions`
  that appear on hover also appear on focus. A test renders each kit node with hover disabled and
  asserts every action is reachable by keyboard.
- **A plugin never receives a key event** outside `Input`, `Textarea`, `Composer`, and the inside of
  a rectangle. Enforced by the event set in the tree protocol.
- **Every collection keeps its place across a data rebuild.** A test rebuilds a `Row` list with the
  same keys in a new array and asserts `active` and `selected` survive.
- **Every focus group has an entry and an exit.** A test walks `nextRegion` around every layout and
  arrives back where it started.
- **ARIA roles derive from node roles.** `Row` collections render `role="listbox"` or `role="tree"`
  with `aria-activedescendant`; `Tabs` render `role="tablist"`; `Modal` renders `role="dialog"`
  with `aria-modal`. Checked in the jsdom host tier.

## What this replaces

- `ui/focus.ts`: `createListNavigation`, `nextListIndex`, `trapOverlayFocus`. Deleted in phase 9
  once every call site is a kit collection or a `Modal`.
- `focusedPane` in `tasks.ts`: becomes the region focus store.
- The frame keydown forwarding described in `docs/command-palette-and-shortcuts.md` § Focus and
  typing, for everything that is not a rectangle.
- Hand-rolled `onKeyDown` handlers in plugins (agents composer, github lists, editor file tree).

## Doors left open

- The keymap core is host-agnostic and the terminal adapter exists in the same package.
- Intents are the only thing a node handles, so a terminal host maps `j`, `k`, `Enter`, `Escape`, and
  a leader key onto the same set without touching the kit.
- Collection state is host-owned, so a terminal host with a cell buffer keeps it the same way.
- No node reads `window`, the pointer position, or a key code.
