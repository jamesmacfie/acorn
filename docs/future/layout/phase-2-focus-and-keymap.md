# Phase 2: focus roles, intents, and the keymap

Status: not started.

## Goal

Make focus and keyboard behaviour a property of the tree. Adopt `@opentui/keymap` with its HTML
adapter over the command registry, map acorn's four keybinding scopes onto its layers, introduce
intents, give every kit node its focus role, give every layout region a focus group, and hold
collection state (`active`, `selected`, `offset`) in a host store keyed by identity. At the end of
this phase every `Row` list in every pane has arrows, Home and End, and type-ahead without the pane
doing anything.

## Why this phase, and why now

Focus attaches to kit nodes (phase 0) and layout regions (phase 1), so both must exist. It comes
before the remote root because a remote tree must behave exactly like a direct one under the keyboard,
and the cheapest way to guarantee that is for the behaviour to live in the host before the second
render path exists.

## Scope

In:

- Add `@opentui/keymap` as a dependency of `client-core`. Wire its HTML adapter to the shell root.
- Register the command registry as the keymap's command catalog; register every `keybindingRegistry`
  entry as a layer binding, scope mapped per the table in [07-focus-and-keys.md](./07-focus-and-keys.md).
- The intent set as a closed enum in `client-core/src/keys/intents.ts`; the per-platform key map in
  `keys/keymap.ts`.
- Focus roles on kit nodes: stops, collections with roving focus, traps. Implemented inside the kit
  components; a plugin sets nothing.
- The collection store `client-core/src/keys/collectionState.ts`, keyed by node identity; `Row`,
  `TreeRow`, `Tabs`, `Menu`, `Timeline`, `Table`, `Grid`, `ChipRow`, `SegmentedControl`,
  `KeyValueEditor` read and write it.
- Layout regions as focus groups with `nextRegion` and `prevRegion`; `focusedPane` in `tasks.ts`
  becomes a view over the region store.
- `Modal` and `Menu` trap and restore focus through the kit, replacing `trapOverlayFocus`.
- ARIA roles and `aria-activedescendant` from node roles.
- The cheat-sheet: a command that lists active bindings from the keymap's catalog.

Out: any change to what rectangles do with keys (`claimsKeys`, `DocumentSurface`'s flush-then-deliver
stay); plugin-level changes beyond deleting hand-rolled `onKeyDown` handlers that the kit now covers.

## Design detail

**Adapter.** `createHtmlKeymap(root)` from `@opentui/keymap/html`, installed once in the shell
composition root. Its `MutationObserver` tracks targets; kit nodes mark themselves as targets with a
data attribute the adapter reads. The Solid helpers (`@opentui/keymap/solid`) provide `useKeymap`
inside kit components.

**Layers.** `global` for the root; `focus-within` on the task layout row for today's `task` scope;
`focus-within` on a pane's layout or region for `pane`; a `fallthrough` flag for `typing-exempt`.
Conflict detection in `keybindings.ts` (`scopesConflict`) is replaced by the keymap's shadowing
diagnostics, surfaced in the same place.

**Intents.** The kit's nodes handle intents, not keys. `Row` collections handle `next`, `prev`,
`first`, `last`, `pageNext`, `pagePrev`, `activate`, `menu`; `Fold` handles `expand` and
`collapse`; `Modal` handles `dismiss`; `Composer` handles `commit`. An unhandled intent bubbles to
the region, then the global layer. `Input`, `Textarea`, `Composer` own keys while focused;
`isTypingTarget` becomes a node role check rather than a DOM query.

**Collection state.** `{ active, selected, offset }` per collection node id, in a Solid store. Keyed
by the node's stable key so a rebuilt list keeps its place. Host-owned `selected` by default;
`controlled: true` on the node hands `selected` to the plugin for every operation.

**Focus groups.** Each layout region registers a group; the group remembers its last focused node;
`nextRegion` cycles groups within a pane, `nextPane` cycles panes in the task row. Focus-within
propagates as a data attribute for styling.

## Code touched

- `packages/client-core/package.json`: `@opentui/keymap`.
- New `packages/client-core/src/keys/`: `intents.ts`, `keymap.ts`, `collectionState.ts`,
  `regions.ts`, `install.ts`.
- `packages/client-core/src/registries/keybindings.ts`: becomes a thin registration into the
  keymap; the scope type stays for manifests.
- `packages/client-core/src/registries/commands.ts`: exposes the catalog.
- `packages/client-core/src/tasks/tasks.ts`: `focusedPane` reads the region store.
- `packages/client-core/src/ui/focus.ts`: `createListNavigation` and `trapOverlayFocus` callers
  move to kit behaviour; the file is deleted in phase 9.
- `packages/client-core/src/lib/isTypingTarget.ts`: replaced by node roles.
- Kit nodes in `ui/`: `Row`, `TreeRow`, `Tabs`, `Menu`, `Modal`, `Picker`, `Composer`, `Fold`,
  `Timeline`, `Table`, `Grid`, `ChipRow`, `SegmentedControl`, `KeyValueEditor`, `Button`, `Input`,
  `Textarea`, `Select`, `Checkbox`, `Toggle`, `FindBar`.
- `packages/client-core/src/layouts/*`: regions register groups.
- The shell composition root (`apps/desktop/src/app/client/App.tsx` or wherever the shell installs
  global listeners): install the adapter.
- `packages/client-core/src/plugins/frames/PluginFrame.tsx`: unchanged for rectangles; the frame is
  one stop.

## Tests

- Rebuilding a `Row` list with the same keys in a new array keeps `active` and `selected`.
- `nextRegion` walked around every layout returns to the start.
- Every kit node with actions is fully operable with hover disabled.
- ARIA: `Row` collections render `listbox` or `tree` with `aria-activedescendant`; `Tabs` render
  `tablist`; `Modal` renders `dialog` with `aria-modal`.
- A plugin never receives a key event outside inputs and rectangles: a test mounts a tree and
  asserts the only events crossing are the kit's semantic set.
- Existing keybinding tests (`keybindings.test.ts`, the palette tests) pass against the keymap.

## Docs owed

- `docs/command-palette-and-shortcuts.md` § "Focus and typing" rewritten around intents, groups, and
  layers; § "Pane shortcuts" and § "Plugin shortcuts" describe bindings as layers.
- `docs/state.md` § "Which mechanism holds a given fact" gains the collection and region store.
- `docs/ui-design.md` § "Interaction rules", § "Menus and right-click", § "States", § "Accessibility
  and density" move under the intent layer.
- `docs/frontend.md` § "Shell state" notes the focus store.

## Doors left open

- The keymap core is `@opentui/keymap`'s, and its terminal adapter is in the same package.
- Nodes handle intents only; no node reads a key code.
- Collection state is host-owned and keyed by identity, so any host keeps it the same way.
- No leader key on desktop, but the engine supports one for the terminal.

## Done when

- Every `Row` list, `Tabs`, `Menu`, `Modal`, `Fold`, and `TreeRow` in the app is keyboard-operable
  without pane code; `⌘1`..`⌘9` inside a `tabs` layout works; one chord moves between regions.
- The palette and every existing shortcut work as before.
- `pnpm lint` and `pnpm test` are green.

## Verify before building

- `packages/client-core/src/registries/keybindings.ts` still has `KeybindingScope = 'global' | 'task'
  | 'pane' | 'typing-exempt'` and `scopesConflict`.
- `packages/client-core/src/tasks/tasks.ts` holds `focusedPane` as a signal-backed record.
- `packages/client-core/src/ui/focus.ts` exports `createListNavigation`, `nextListIndex`,
  `trapOverlayFocus`.
- `references/opentui/packages/keymap/` is present and its README lists the HTML adapter and Solid
  helpers; check the published package name and version on npm before adding it.
- `docs/command-palette-and-shortcuts.md` § "Focus and typing" describes the frame keydown
  forwarding and `claimsKeys` as the survey saw.
