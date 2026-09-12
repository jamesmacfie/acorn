# Phase 2: the rail and the topbar as exclusive slots

Status: not started. Waits on phase 1.

## Goal

`rail` and `topbar` join `CORE_EXCLUSIVE_SLOTS`, each with a contract that hands a provider data and
verbs and places one nested host-filled slot (`rail.taskList` inside `rail`, `topbar.right` inside
`topbar`). Core's `TabRail` and the `<header class="topbar">` in `App.tsx` become the `core`
providers. This is Omarchy's full-bar replacement, done as two slots with contracts.

## Why this phase, and why now

Phase 1 settled the shape: core is a provider, props are data, a worker can draw it. The rail and
topbar are the two remaining chrome surfaces a person would want to replace, and their contracts are
larger than the switcher's but the same in kind. The rail comes with the topbar because a replaced
rail that hides the collapse control needs the topbar's `collapseRail` verb to exist, and because
the two share the workspace picker's data.

## Scope

In:

- `'rail'` and `'topbar'` in `CORE_EXCLUSIVE_SLOTS`, labels, trust sentences.
- `RailProps`: `sources: { id, label, icon, selected, markers: RailMarker[] }[]`, `workspaces: { id,
  label, active }[]`, `collapsed`, `formFactor`; verbs `selectSource`, `openWorkspace`,
  `toggleCollapsed`, `reorderSources`; and `slots: { taskList: SlotRef }`, the nested slot the
  provider must place with a `Slot` node from layout phase 4.
- `TopbarProps`: `workspace`, `project`, `breadcrumb: { label, route }[]`, `node: { id, label, state
  }`, `nodes[]`, `account: { label, avatar? }`, `railCollapsed`; verbs `pickWorkspace`,
  `pickProject`, `pickNode`, `openSettings`, `collapseRail`, `navigate(route)`; and `slots: { right:
  SlotRef }`.
- Core's `TabRail.tsx` refactored to a component over `RailProps`, registered as `core`. Core's
  topbar extracted from `App.tsx` into `chrome/Topbar.tsx` over `TopbarProps`, registered as `core`.
- `App.tsx` and the shell render `<ExclusiveSlotHost slot="rail" props={...} />` and the same for
  `topbar`, building props from the registries they read today.
- Rail markers stay data: `RailMarker` is the existing marker description from
  `features/tabs/railMarkers.ts`, and a provider draws a marker with the kit's `StatusDot`, which is
  where the host's colour and spin rules live.
- The Settings row for a provider that omits a nested slot says "hides the task list" or "hides
  plugin status items" before the user picks it.
- The failure policy from phase 1 applies; a failed rail provider raises a notice because the user
  has lost navigation.
- Two test plugins in the fixture: a rail with labels and no icons, and a topbar with the node
  picker first.

Out: the palette, the overlay stack, `RailTab`'s pixel geometry as a plugin concern (a provider
draws rows from the kit; it has no geometry), and any change to how sources, markers, or slots are
contributed.

## Design detail

**Sources are data.** `availableSources()` in `features/tabs/railSources.ts` already applies four gates and an
order. The host applies them and hands the provider the result, so a rail provider cannot show a
source the user cannot open. `reorderSources` writes `PrefKeys.railOrder` through the host.

**The nested slot.** A `SlotRef` is an opaque token the host mints for one mount. The provider
places `<Slot ref={props.slots.taskList} />` in its tree and the host fills it with the
`rail.taskList` resolution, which may itself be a plugin. One level: the task list provider does not
receive slots. This is the allowance layout `refused.md § Nested slots` leaves for "one level", and
the trust prompt for a rail provider says it places the task list, not that it draws it.

**The topbar's right side.** `topbar.right` is the existing `UiSlotId` with a `SlotHost`. It becomes
a `SlotRef` the topbar provider places. The other members of the `UiSlotId` union (`topbar.left`,
`task.switcher.extra`) have no host today and are not given one here; a provider that wants a
left-side region draws one from its own tree.

**Workspace and node pickers.** Today `WorkspacePicker`, the project `Picker`, `Select` for nodes,
and `AccountMenu` are components. The provider receives their data and calls verbs; core's provider
uses the components as before because it is compiled. A remote provider draws a `Select` from the
kit over `nodes[]` and calls `pickNode`. The `NodeChip` state colours are `StatusDot` tones.

**Collapse.** `leftCollapsed` is a device pref. Both providers can read it and either can toggle it
through the host, so a topbar provider without a collapse button and a rail provider without one
leaves the user with `meta+b` (or whichever chord the command has), which stays host-owned.

**Trust copy.** "Draws the left rail, including the workspace and source list, and places the task
list." "Draws the top bar, including the workspace, project, and node pickers, and places plugin
status items."

## Code touched

- `packages/protocol/src/extensionPoints.ts`: the two slots.
- `packages/protocol/src/chrome.ts` (new): `RailProps`, `TopbarProps`, `SlotRef`.
- `packages/client-core/src/features/tabs/TabRail.tsx`: over `RailProps`; registered as `core`.
- `packages/client-core/src/chrome/Topbar.tsx` (new, from `App.tsx`): over `TopbarProps`.
- `apps/desktop/src/client/App.tsx`: builds both props objects; renders two
  `ExclusiveSlotHost`s.
- `packages/client-core/src/host/registries/extensionPoints/exclusiveSlots.ts`: per-slot props typing for the two new
  slots; nested-slot minting.
- `packages/client-core/src/host/plugins/ExclusiveSlotHost.tsx`: fills `SlotRef`s.
- `packages/client-core/src/host/registries/extensionPoints/slots.ts`: `topbar.right` gains a `SlotRef` path beside its
  `SlotHost`.
- `packages/client-core/src/features/settings/PluginsSettings.tsx`: labels; the "hides" warnings.
- `packages/plugin-api/src/client.ts` and the surface snapshot: the two props types.

## Tests

- `hosts` (jsdom): core's rail over fixed `RailProps` renders the same DOM as today's `TabRail` for
  a fixture workspace (a snapshot taken before the refactor); the same for the topbar.
- A rail provider that omits the task list slot renders, and its Settings row carries the warning.
- A rail provider that throws yields core and a notice; the notice names the plugin.
- `reorderSources` from a provider writes `railOrder` and the next props reflect it.
- The two test plugins render identically direct and through a worker.
- `props.test-d.ts`: `RailProps` and `TopbarProps` carry no DOM type.

## Docs owed

Per [docs-migration.md](./docs-migration.md), phase 2 rows: `docs/plugins.md § Replacing a core
surface`, `docs/frontend.md § Composition`, `docs/ui-design.md § Shell hierarchy`,
`docs/testing.md`.

## Doors left open

Against [07-hosts.md](./07-hosts.md):

4. No DOM type in either contract. Markers are the existing data shape.
5. Both offers carry `formFactor`. The mobile shell has its own chrome and hides a `['desktop']`
   offer; a provider with a narrow projection may say `['desktop', 'narrow']` and the mobile shell
   may pick it, which is a decision `remote.md` makes, not this phase.

Against the layout list: rail markers remain data; a provider cannot position one because it cannot
write a selector.

## Done when

- The labels-only rail is picked, shows every source the user can open, places the task list, and
  falls back to core with a notice when made to throw.
- The node-first topbar is picked, switches nodes through `pickNode`, and places `topbar.right`
  contributions.
- Core's rail and topbar are indistinguishable from before the refactor in the jsdom snapshot.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- Phase 1 of this folder has shipped: core is a provider, `ExclusiveSlotHost` has no `core` prop.
- `packages/client-core/src/features/tabs/TabRail.tsx` is the `<nav class="tabrail">` with `RailTab` children
  and one `ExclusiveSlotHost` for `rail.taskList`.
- `apps/desktop/src/client/App.tsx` holds `<header class="topbar">` with `WorkspacePicker`, the
  project `Picker`, the breadcrumb, the node `Select`, `NodeChip`, and `AccountMenu`.
- `packages/client-core/src/features/tabs/railSources.ts` exports `availableSources()` with the four gates.
- `packages/client-core/src/host/registries/extensionPoints/slots.ts` has `UiSlotId` with `topbar.right` hosted and
  `topbar.left` unhosted.
- Layout phase 4's `Slot` node exists and supports a host-minted ref.
