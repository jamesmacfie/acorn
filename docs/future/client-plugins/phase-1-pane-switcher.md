# Phase 1: the pane switcher as an exclusive slot

Status: not started. Waits on layout phase 4 and on phase 0 of this folder.

## Goal

`pane.switcher` joins `CORE_EXCLUSIVE_SLOTS`. Core's switcher becomes a registered provider rather
than a fallback prop. A compiled plugin and a loaded plugin can each offer a replacement drawn from
the kit against one contract, the user picks in Settings, and core returns on failure. Proven with a
device-held test plugin that draws a vertical switcher with labels instead of icons.

## Why this phase, and why now

It is the example the owner gave, it is the smallest surface with a real contract, and
`rail.taskList` already proves the arbitration on the neighbouring control. Layout phase 4 has just
landed the generalised picker and the trust copy builder, so this phase adds one slot to each rather
than building either. Doing the switcher before the rail also settles the "core is a provider"
refactor on a small surface.

## Scope

In:

- `'pane.switcher'` in `CORE_EXCLUSIVE_SLOTS`; its label in `PluginsSettings.tsx`; its trust
  sentence in the phase 4 line builder.
- `PaneSwitcherProps` in `@acorn/protocol`: `panes: { id, label, icon, shown, pinned, shortcut }[]`,
  `maximized: PaneId | null`, `task: { id, title, project }`, and the verbs `show`, `add`, `close`,
  `pin`, `toggleMaximize`, `equalize`. Verbs take ids and nothing else.
- Core's switcher extracted from `TaskPaneHost.tsx` into `tasks/PaneSwitcher.tsx` as a component
  over `PaneSwitcherProps`, registered as the `core` provider.
- `ExclusiveSlotHost` loses its `core` prop. The resolver picks among providers, one of which is
  `core`, and the host draws the pick. `rail.taskList` moves to the same shape in this phase.
- The loaded path: a frame or remote contribution with `target: 'coreSlot'` and `coreSlot:
  'pane.switcher'` mounts a `TreeHost` with `PaneSwitcherProps` as its props, through layout phase
  3's worker.
- `meta+1` to `meta+9` route to the slot's `show` verb through the host, so a replacement gets them
  and cannot rebind them.
- The failure policy: three throws in a session disables the provider for the session and the
  Settings row says why.
- The test plugin, device-held, in the fixture from phase 0.

Out: the rail and topbar (phase 2), any change to the pane layout reducer, any change to the pane
chords' ownership.

## Design detail

**The contract as data.** `PaneSwitcherProps` has no `JSX.Element`, no `MouseEvent`, no `Component`.
`icon` is a name string resolved by `Icon.tsx`. `shortcut` is a display string the host computed.
The `add` vs `show` distinction that today comes from `event.metaKey` in `TaskPaneHost.onSwitch`
becomes two verbs, and core's provider decides which to call from the event it received; a remote
provider receives an intent (`activate` with a modifier flag from the kit's semantic event set) and
does the same.

**Core as provider.** `tasks/PaneSwitcher.tsx` is today's switcher markup moved, taking props
instead of reading `layout()` and `dispatch` from closure. `TaskPaneHost` builds the props from
`layout()`, `switcherPanes()`, `maximizedPane()`, and `props.shortcutFor`, and renders
`<ExclusiveSlotHost slot="pane.switcher" props={...} />`. The host resolves, mounts the provider
with the props, and catches throws.

**The remote provider.** `frames/register.ts` already registers `coreSlot` surfaces as
`ExclusiveSlotProvider`s with a `component` that mounts a frame. After layout phase 3 the same
registration mounts a `TreeHost` when the contribution is `remote`, and the frame path is kept only
until layout phase 5 deletes it. The `component` receives the slot's props and forwards them as the
tree's mount props.

**Focus.** The switcher is a `Rows` collection or a `Tabs` collection in the kit, so a replacement
gets `next`, `prev`, `activate` from layout phase 2 without writing key handling. F6 moves into and
out of it as a region because `TaskPaneHost` registers the switcher's region, not the provider.

**Trust copy.** "Draws the pane switcher for every task." Under `enforced`, because the host mounts
the tree.

## Code touched

- `packages/protocol/src/extensionPoints.ts`: the slot.
- `packages/protocol/src/paneSwitcher.ts` (new): `PaneSwitcherProps`.
- `packages/client-core/src/registries/exclusiveSlots.ts`: `resolveExclusiveSlot` always returns a
  provider; the `core` provider is registered like any other; props typing per slot.
- `packages/client-core/src/plugins/ExclusiveSlotHost.tsx`: no `core` prop; the failure counter.
- `packages/client-core/src/tasks/PaneSwitcher.tsx` (new) and `TaskPaneHost.tsx`.
- `packages/client-core/src/tabs/TabRail.tsx`: `rail.taskList` moves to the same shape.
- `packages/client-core/src/plugins/frames/register.ts`: props forwarding for `coreSlot`.
- `packages/client-core/src/keys/install.ts`: the pane chords call the slot verb.
- `packages/client-core/src/settings/PluginsSettings.tsx`: the label and the failure reason.
- `packages/plugin-api/src/client/index.ts`: `PaneSwitcherProps` re-exported; the surface snapshot
  gains the name.
- `plugins/*/acorn-plugin.config.mjs`: none. The test plugin lives in the fixture.

## Tests

- `exclusiveSlots.test.ts`: with no pick, `core` is chosen; with a pick for an absent plugin,
  `core`; after `noteExclusiveSlotFailure` three times, the provider is disabled for the session and
  `exclusiveSlotFailed` says so.
- `hosts` (jsdom): core's switcher over a fixed `PaneSwitcherProps` renders the expected rows and
  calls `show` on activate and `add` on activate-with-modifier; a provider that throws yields core
  and a notice.
- The test plugin's switcher renders identically through the direct path and through a worker,
  diffed as layout phase 3 does for the tool card.
- `install.test.ts`: `meta+3` calls `show` with the third pane's id regardless of provider.
- `props.test-d.ts`: `PaneSwitcherProps` contains no DOM type (a type-level assertion using the
  kit's existing "no `class`" pattern).

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 1 rows: `docs/plugins.md § Replacing a core
surface`, `docs/frontend.md` (two sections), `docs/command-palette-and-shortcuts.md`,
`docs/panes.md`, `docs/testing.md`, `docs/future/compiled-tier.md`.

## Doors left open

Against [07-hosts.md](./07-hosts.md):

4. `PaneSwitcherProps` carries no DOM type, no event, no callback a worker cannot receive. The
   type-level test holds it.
5. The offer carries `formFactor`; the mobile shell hides an offer that says `['desktop']`.

And against the layout programme's list: no key event reaches the provider (intents only); no
`class` or `style`; the switcher is a collection so its terminal projection is the kit's.

## Done when

- The device-held test plugin's vertical switcher is picked in Settings, appears in every task,
  responds to `meta+1` to `meta+9`, and F6 moves into and out of it.
- Making it throw returns core's switcher at once with a notice; three throws disable it for the
  session.
- `rail.taskList` still works with core as a registered provider.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- Layout phase 4 has shipped: `Slot` arbitration with `replace` mode, the generalised Settings
  picker, and `extensionPermissionLines` taking per-slot sentences. If not, stop.
- Layout phase 3 has shipped: `TreeHost`, the worker, `mountTree`.
- `packages/client-core/src/tasks/TaskPaneHost.tsx` builds the switcher from `switcherPanes()` and
  dispatches `LayoutAction`s (`show`, `add`, `close`, `pin`, `maximize`, `equalize`) through
  `dispatchLayout`.
- `packages/client-core/src/plugins/ExclusiveSlotHost.tsx` takes a `core` render prop.
- `packages/client-core/src/keys/install.ts` owns the `meta+1`–`meta+9` bindings for the tabs layout
  and the pane row.
- `packages/protocol/src/pluginContract.ts` has `coreSlot: z.enum(CORE_EXCLUSIVE_SLOTS)`.
- Phase 0 of this folder has shipped and its fixture plugin exists.
