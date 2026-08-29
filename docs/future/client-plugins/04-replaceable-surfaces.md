# Replaceable surfaces: core chrome as providers of named slots

Part of [docs/future/client-plugins/](./README.md). This is the design for the second stance change:
the pane switcher, the rail, and the topbar become exclusive slots that core fills by default and a
plugin may offer to fill instead. Phases 1 and 2 build it.

## What exists

`docs/plugins.md § Replacing a core surface` describes the mechanism, and one surface uses it.

- `CORE_EXCLUSIVE_SLOTS = ['rail.taskList'] as const` in `packages/protocol/src/extensionPoints.ts`,
  with `CORE_SLOT_PROVIDER = 'core'`.
- `packages/client-core/src/registries/exclusiveSlots.ts` holds `ExclusiveSlotProvider` (`id`,
  `pluginId`, `slot`, `label`, `when?`, `component`), the registry, `resolveExclusiveSlot`,
  `noteExclusiveSlotFailure`, and the user's choices under `PrefKeys.exclusiveSlots`.
- `packages/client-core/src/plugins/ExclusiveSlotHost.tsx` draws the resolved provider inside an
  error boundary and falls back to `core` on a throw.
- `TabRail.tsx:347` is the one call site. `PluginsSettings.tsx:430` has the one label.
- A loaded plugin offers through a frame with `target: 'coreSlot'` and `coreSlot: 'rail.taskList'`
  (`pluginContract.ts:122`, `:143`). A compiled plugin registers a provider directly.
- The rule: "Registering seizes nothing." Nobody chosen, plugin absent, disabled, untrusted, or its
  surface threw, all draw core.

Layout phase 4 generalises the Settings picker from `rail.taskList` to every `replace`-mode slot
tie, and adds the trust copy and the developer view. This folder inherits both.

## The design

### Core is a provider too

Today core's task list is the `core` prop of `ExclusiveSlotHost`, a special case beside the
registry. The first change in phase 1 is to make core's own drawing a registered provider with
`pluginId: 'core'`, so the resolver picks between providers and never between a provider and a
fallback. The fallback is then "the `core` provider", and it is always present because it is
compiled in. This is the fourth admission rule from the README, and it is what makes each later
surface one registry entry rather than one new host.

### The contract is a props type, and the provider is a tree

A provider for a surface receives one props object and returns one tree of kit nodes. The props are
data and verbs: what the surface is showing, and the functions a switcher, a rail, or a topbar may
call to change it. Nothing in the props says how core draws the surface, and nothing in the props is
a shell callback that a worker could not receive over a `MessagePort`. Where a verb needs a value
the plugin cannot have, such as a `MouseEvent`, the contract carries the meaning instead (`add` vs
`show`).

A compiled provider is a Solid component over those props. A loaded provider is a remote tree
mounted by `TreeHost` from layout phase 3 with the same props, so the two are diffable in a test, as
the layout programme does for the changes tool card.

### The surfaces

Each row is one phase's work. The contract sketches are the starting point and the phase file is the
authority.

| Slot | Today | Provider receives | Provider may call | Phase |
| --- | --- | --- | --- | --- |
| `rail.taskList` | shipped | the tasks for the workspace, their statuses and markers, the selected task | select, open in new task view | shipped |
| `pane.switcher` | `TaskPaneHost.tsx` draws it from `switcherPanes()` | `panes: { id, label, icon, shown, pinned, shortcut }[]`, `maximized`, `task` (id, title, project) | `show(id)`, `add(id)`, `close(id)`, `pin(id)`, `toggleMaximize(id)`, `equalize()`; these are today's `LayoutAction`s | 1 |
| `rail` | `TabRail.tsx`, the whole `<nav class="tabrail">` | `sources: { id, label, icon, selected, markers }[]`, `workspaces`, `collapsed`, and the `rail.taskList` slot as a nested slot the provider must place | `selectSource(id)`, `openWorkspace(id)`, `toggleCollapsed()`, `reorderSources(ids)` | 2 |
| `topbar` | `App.tsx`, the `<header class="topbar">` | `workspace`, `project`, `breadcrumb`, `node: { id, label, state }`, `nodes[]`, `account`, and the `topbar.right` slot contents | `pickWorkspace(id)`, `pickProject(id)`, `pickNode(id)`, `openSettings()`, `collapseRail()` | 2 |

The nested `rail.taskList` inside `rail` is one level, which is what `refused.md § Nested slots` in
the layout folder allows: the rail provider places a slot the host fills, and does not open slots of
its own beyond that. The topbar provider likewise places `topbar.right`. A provider that omits a
nested slot hides it, and the Settings row for that provider says so, because a rail with no task
list is a choice a user should see before they make it.

### What stays core's

The command palette. `PaletteSurface` lives on `/ui/host` because a palette drives the shell's focus
stack, and the layout programme's `refused.md § A second keymap` refuses any plugin key handling
outside inputs and rectangles. A replacement palette would need both. The palette's rows are already
contributable through `paletteRows`, which is the extension point a palette needs.

The overlay stack. The argument in `docs/plugins.md` is unchanged: a contribution there would paint
over the trust prompt.

The pane layout row. Pane ids, weights, pins, and maximise are persisted state with a reducer, and a
switcher provider calls the reducer through the verbs above. It never owns the row.

`RailTab`'s geometry. A rail provider draws the rail from kit nodes and rail markers stay data. The
"a CSS selector that positions a rail marker is the regression signal" rule from `docs/ui-design.md`
still holds because a kit tree cannot write one.

### Arbitration

Unchanged from `rail.taskList` and generalised by layout phase 4. The user picks a provider per slot
in Settings → Plugins. The pick is a device pref (`PrefKeys.exclusiveSlots`), so a replaced rail on
one machine is not a replaced rail on another, which matches device provenance. A device plugin and
a node plugin may both offer; the picker lists both and says where each came from.

### Fallback

`noteExclusiveSlotFailure` marks a provider that threw and the resolver stops choosing it until the
plugin set is re-synced. For a rail or topbar provider this matters more than for the task list,
because a thrown rail leaves the user with no navigation. The host draws core's provider at once and
raises a notice naming the plugin. A provider that fails three times in a session is disabled for
the session and the Settings row says why.

### Keys

A provider's tree gets focus and intents from the kit, as any tree does after layout phase 2. The
region chords (F6, Shift+F6, the pane chords) are the host's layer at priority 5 and a provider
cannot claim them; `meta+1` to `meta+9` for pane switching stay host-owned and route to the
`pane.switcher` verbs, so a replacement switcher gets them for free and cannot rebind them.

## Trust copy

Each slot has one host-owned sentence in the trust prompt, under the `enforced` tier because the
host mounts the tree:

- `pane.switcher`: "Draws the pane switcher for every task."
- `rail`: "Draws the left rail, including the workspace and source list."
- `topbar`: "Draws the top bar, including the workspace, project, and node pickers."

Layout phase 4's `extensionPermissionLines` builder takes them. A plugin that offers a slot but is
not picked still shows the line, because the offer is a declared capability and the prompt describes
what the bundle may do, not what it is doing.
