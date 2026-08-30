# Phase 2: focus roles, intents, and the keymap

Status: shipped 2026-08-29. Behaviour is owned by `docs/command-palette-and-shortcuts.md`
§ "Focus and typing"; the deviations from this plan are at the foot of this file.

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
- **The "focus changed" core event**, owed to `docs/future/events.md § Not built here` and
  deliberately left out of the events programme so it has one implementation. The region store is the
  emit point: `{ taskId, paneId, regionId }`, coarse, on the client bus first and, because focus is a
  fact about a window rather than a node, never broadcast by the node. A frame or tree subscribes to
  it through the same `SUBSCRIBABLE_CHANNELS` entry and host-owned sentence any core event costs.
  Emitting it from `activeTaskId` before this phase would be a second implementation to delete.
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
- `ui/focus.ts` in client-core: `createListNavigation` and `trapOverlayFocus` callers move to kit
  behaviour. Phase 9 deleted the file.
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
- `ui/focus.ts` in client-core exports `createListNavigation`, `nextListIndex`, `trapOverlayFocus`.
  Phase 9 deleted the file.
- `references/opentui/packages/keymap/` is present and its README lists the HTML adapter and Solid
  helpers; check the published package name and version on npm before adding it.
- `docs/command-palette-and-shortcuts.md` § "Focus and typing" describes the frame keydown
  forwarding and `claimsKeys` as the survey saw.

## What shipped, and where it differs

Seven deviations, each taken for a reason worth writing down.

**1. `Rows` is a new kit node.** The plan said "every `Row` list has arrows without the pane doing
anything", and the kit had no container to hang that on: `Row` has always been "an item in a
collection" and the collection was whatever `<div>` the pane wrapped it in. `Rows` is that container.
A pane still writes no key handling; it names the collection and hands over the item keys. `Rows` is
in the support matrix, the focus table and the plugin API barrel, and panes adopt it in phases 5
through 8.

**2. Two collection implementations, not one.** `createCollection` is the keyed one: `Rows`, `Tabs`,
`SegmentedControl`. `createDomCollection` reads its items out of the DOM when a key arrives and is
what `Menu`, `Select`'s list, `ChipRow` and `Timeline` use, because all four take opaque JSX from the
caller and the host cannot key what it cannot see. They share the intent set, which is the part that
matters. The DOM one keeps no stored place, and should not: all four are transient or unselected.

**3. `Grid` moves the selection, not the focus.** Its rows are virtualised, so most of them have no
element to focus. The arrows move `selected` and scroll it into view, with
`aria-activedescendant` on the scroll container. That is the ratatui shape and the only one that
survives virtualisation.

**4. `Table` and `KeyValueEditor` are not collections.** `Table` takes children and has no selection
model, and `KeyValueEditor`'s rows are text inputs where an arrow key is text navigation. Both are
`none` and `collection` respectively in the focus table, and the editor's row roving is owed when
something asks for it.

**5. `scopesConflict` stays.** The plan had the engine's shadowing diagnostics replace it.
`resolveKeybindings` does more than the engine can: user overrides, first-party-then-lockfile order,
legacy pane chords, and a conflict verdict for rows Settings draws as unbound. Resolution happens
first and the engine is handed one binding per resolved chord.

**6. `focusedPane` is written by the region store rather than read from it.** The plan said
`focusedPane` becomes a view. It stays a signal in `tasks/tasks.ts`, because the layout invariant in
`dispatchLayout` and the scope eviction in `evictTaskState` both write it, and `keys/regions.ts` is
its only other writer. The substance holds: the region store is where focus is decided and where
`runtime:focus-changed` is emitted.

**7. The focus event is `runtime:focus-changed`.** `channels.ts` splits its names by delivery:
`<noun>:changed` is node-emitted and reaches every window, `runtime:*` is renderer-local. Focus is
renderer-local by construction, so it takes the `runtime:` name and that family's comment widened to
cover it.

**8. Escape's dialog carve-out is a binding matcher.** The plan put it in a keymap intercept, and the
engine cannot express it: `consume()` stops keymap dispatch only by calling `stopPropagation()` on the
DOM event, which would also stop the overlay stack in `ui/dismissable.ts` from ever seeing the press.
An `escape` binding goes inactive instead while focus is inside a dialog.

`isTypingTarget` was not replaced by a node role. On the DOM host it already is one: `INPUT`,
`TEXTAREA`, `SELECT` and contenteditable are exactly the nodes that own their keys, and the predicate
is shared with the node-side manifest parser and the frame SDK, which have no kit to ask. The focus
table records the same fact as `OWNS_KEYS`.
