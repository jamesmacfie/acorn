# Rail controls and plugin-published status markers

Design and implementation plan from the rail audit on 2026-08-27. Planned against commit `8e773d70`.

**Status: slices 1 and 2 shipped on 2026-08-27. Slice 3 has not been built.**

The shipped behaviour is owned by the docs, not by this file:
[ui-design.md § Rail controls and status markers](../ui-design.md) for the component and the marker
model, [plugins.md § Rail markers](../plugins.md) for the compiled contribution,
[frontend.md § Registries and plugins](../frontend.md) for the registry, and
[panes.md](../panes.md) for why a pane marker is not a pane freshness hook. What is left here that is
still live is **slice 3**, the loaded-plugin manifest contribution, held back on this document's own
advice: build it when a real loaded plugin has a status to publish, using that plugin as the
end-to-end consumer. The rest is kept as the record of what was decided and why.

Before starting any slice, run:

```sh
git diff --stat 8e773d70..HEAD -- apps/desktop/src/app/client packages/client-core/src \
  packages/plugin-api/src packages/protocol/src packages/node-core/src plugins/docker/src
```

Compare any changed in-scope file with the current-state section below. Material drift is a STOP
condition, not permission to merge the old and new designs by guesswork.

## Decision summary

Acorn should keep one host-owned rail control and make it more opinionated. `RailTab` remains a
presentation component: it receives a main glyph, active state, semantic tone, busy state, optional
secondary text, and already-resolved status markers. It does not read task state, query plugins, or
know which rail it is in.

Status production belongs beside the state that owns it. Core and compiled plugins publish semantic
marker data through one client registry. Loaded plugins declare a host-drawn `railMarkers`
contribution whose one node-scoped route returns a bounded batch of markers keyed by task, source, or
pane. A host runtime fetches those descriptors once per plugin and node, then feeds the same marker
resolver as core and compiled plugins.

The host, not a caller or plugin stylesheet, owns placement and collisions. A marker asks for an
ordered list of positions; the host deterministically assigns the first free position, retains every
unplaced marker in the tooltip legend, and never renders two icons on top of one another.

Implement this in three independently useful slices:

1. Make every left- and right-rail control use the expanded `RailTab` contract.
2. Move core task status and Docker onto semantic markers, then retire the arbitrary
   `tabrail.task-row` component slot.
3. Add the declarative, batched loaded-plugin contribution.

The first slice fixes the current 44px/52px bottom-control mismatch. The second makes the marker
model safe before it becomes public. The third can wait until a loaded plugin actually needs it.

## Why this exists

Both vertical rails are documented as using `packages/client-core/src/tabs/RailTab.tsx`, but that
component currently standardises only the button element and `.tabrail-tab` class. Callers still
choose their own icon representation, font size, active class, destructive colour, loading glyph,
click guard, and surrounding status markup.

The visible bottom mismatch is the clearest symptom:

- `packages/client-core/src/tabs/TabRail.tsx` renders the left new-task `+` as a raw
  `.tabrail-add` button.
- `.tabrail-add` is 44px high.
- `packages/client-core/src/tasks/TaskPaneHost.tsx` renders the right close-task `✕` as a
  `RailTab`.
- `.tabrail-tab` is 52px high, matching `--tabrail-w`.

Markers have a deeper version of the same problem. Core's `railStatusItems()` returns raw CSS class
names, and the task row renders those spans next to an arbitrary `TaskSlotHost`. That already permits
collisions:

- CI checks and unread-agent attention can both occupy the top-right corner.
- Core's pinned marker and Docker's running-container marker both occupy the top-left corner.
- Docker has to know the shell's undocumented pixel geography in its own stylesheet.

Opening that system to more plugins without first centralising placement would make the order in
which CSS happens to load part of the product contract.

## Current architecture

### Controls

The current render flow is:

```text
left source/task rail
  TabRail
    source button             -> RailTab + Icon
    task button               -> RailTab + Icon
    new-task button           -> raw .tabrail-add button

right pane rail
  TaskView
    run targets               -> RailTab + raw text glyph + sublabel
    terminal                  -> RailTab + raw text glyph
  TaskPaneHost
    pane contribution         -> RailTab + Icon
    close task                -> RailTab + hand-built busy/close content
```

`RailTab` accepts `ComponentProps<'button'>` and arbitrary children. `classList={{ active: ... }}`
works only because it is passed through as a generic Solid button property; active state is not part
of the component's semantic API. Busy handling is likewise local to the close-task call site, which
keeps the button enabled for hover tooltips and manually refuses repeat clicks.

### Markers

There are currently two unrelated systems on a task row:

```text
task / agent / notification state
  -> railStatusItems()
  -> RailStatusItem { overlayCls, glyph or dot, label, tone }
  -> positioned spans owned by core and notification CSS

compiled plugin state
  -> ctx.taskSlots.register({ slot: 'tabrail.task-row', component })
  -> TaskSlotHost(taskId)
  -> arbitrary plugin JSX and plugin-owned absolute-position CSS
```

Docker is the only production consumer of `tabrail.task-row`. Its existence proves that compiled
plugins can publish a task marker today, but it is an escape hatch rather than a reusable contract.

Source and pane contributions expose only a static `glyph`. There is no marker host on either source
buttons or pane buttons. `PaneContribution` deliberately has no `freshness(task)` callback because a
plain callback would capture a non-reactive query snapshot and a host-created observer per pane would
duplicate subscriptions.

### Loaded plugins

Loaded plugins cannot publish rail markers. Their manifest `slots` enum is intentionally only
`footer | topbar`. Reusing the existing slot badge route for `tabrail.task-row` was refused because
that route is node-scoped: it would either draw the same value on every task or issue one request per
visible task per refresh.

Useful infrastructure already exists:

- Manifests are Zod-validated and contribution routes are confined to `/v2/p/<plugin>/`.
- Host-drawn descriptors already resolve Lucide and `brand:` icons.
- Chrome descriptors already use per-node query caches, content-free status invalidation,
  plugin-specific WebSocket invalidation, and a bounded polling fallback.
- The host already validates descriptor response bodies before putting them in shell chrome.

The missing pieces are the target vocabulary, the batched response, and deterministic placement—not
a new trust or transport system.

## Goals

- Every control in both vertical rails uses the same 52px square container by default.
- Main icons use the same `Icon` resolution and optical sizing by default.
- Active, semantic tone, project accent, and busy/deleting states are explicit props.
- Busy controls stay focusable and hoverable for their tooltip while refusing repeat activation.
- A rail control can render non-interactive status markers around its outside edge.
- Marker placement, colour, spinning, tooltip legend, and collision handling are host-owned.
- Core, compiled plugins, and loaded plugins ultimately feed the same marker model.
- Loaded plugin status is fetched in a bounded batch, never once per visible control.
- The design works for task, source, and pane targets without making `RailTab` understand any of
  those domain objects.
- Existing project accents, multi-pane active state, run-target sublabels, tooltips, drag handling,
  task menus, and archive lifecycle behaviour survive the migration.

## Non-goals

- Do not redesign either rail's information architecture, order, or overall width.
- Do not make status markers interactive. A marker inside a button cannot itself be a button; an
  action belongs to the rail control, a context menu, or a command.
- Do not allow arbitrary plugin JSX or CSS in loaded-plugin chrome.
- Do not add a per-pane query/freshness observer. Pane-owned data status remains in the pane header
  unless the plugin deliberately publishes a marker from state it already owns.
- Do not let users customise marker positions in this phase.
- Do not make arbitrary CSS colours the normal status API. Themes need semantic tones. The existing
  validated project colour remains a separate accent override.
- Do not change `PLUGIN_API_MAJOR` merely to add an optional manifest contribution that older clients
  already ignore.
- Do not preserve `tabrail.task-row` as a second way to publish the same thing once its only consumer
  has migrated.

## Presentation contract

Keep the component in `packages/client-core/src/tabs/RailTab.tsx`. A rename would churn every caller
without making the boundary clearer; the useful change is the contract, not the noun.

The target shape is:

```ts
export type RailTone = 'neutral' | 'accent' | 'warn' | 'danger'

export type RailMarkerPosition =
  | 'top-start'
  | 'top-end'
  | 'bottom-start'
  | 'bottom-end'
  | 'bottom-center'

export type RailMarker = {
  id: string
  label: string
  icon?: string
  dotTone?: 'ok' | 'warn' | 'bad' | 'mixed'
  tone?: RailTone
  busy?: boolean
  placements: readonly RailMarkerPosition[]
  priority?: number
}

export type RailTabProps = Omit<ComponentProps<'button'>, 'children' | 'color'> & {
  label: string
  glyph?: string
  active?: boolean
  tone?: RailTone
  accent?: string
  busy?: boolean
  busyLabel?: string
  sublabel?: JSX.Element
  markers?: readonly RailMarker[]
  children?: JSX.Element
}
```

The exact TypeScript may use a union requiring either `glyph` or `children`, but the runtime rules
must remain these:

- `glyph` goes through `ui/Icon.tsx`; a brand mark, Lucide icon, and text fallback keep one resolver.
- `children` is the escape hatch for a genuinely compound centre, not the default way to pass an
  icon. Run targets should prefer `glyph` plus `sublabel`.
- `active` owns the visual data attribute/class only. The caller still supplies `aria-current`,
  `aria-pressed`, or `aria-expanded`, because source navigation, multi-open panes, running processes,
  and an open drawer are different accessibility semantics.
- `tone` is semantic and theme-safe. `accent` sets a scoped `--rail-accent` custom property for the
  validated project colour; it is not reused for warning or failure states.
- `busy` replaces the main glyph with the shared loader, sets `aria-busy`, changes the tooltip to
  `busyLabel` when supplied, and suppresses activation without applying native `disabled`. That
  preserves hover and focus, matching the current archive control's deliberate behaviour.
- Marker children are non-interactive, `pointer-events: none`, and rendered inside the button. The
  button remains the component's single root so `Menu` trigger anchoring, drag wrappers, and focus
  return do not change.
- Marker labels feed `data-tip-legend` automatically. Callers no longer serialise legends or choose
  positioning classes.
- The component exposes marker descriptions to assistive technology without replacing the primary
  button label. Prefer an `aria-describedby` relationship to a visually hidden status string over
  concatenating a changing status into the accessible name.

CSS should use logical start/end positions even though Acorn is currently left-to-right. The right
rail's only structural override remains the active stripe moving from the left edge to the right;
callers do not pass a side prop that the `.pane-switcher` ancestor already knows.

## Marker model and collision policy

Create `packages/client-core/src/tabs/railMarkers.ts` as a pure module. It owns marker validation for
in-process contributions, deterministic ordering, placement allocation, and conversion to tooltip
legend entries. It imports neither Solid nor a registry.

Rules:

1. A marker must have a stable id, non-empty label, exactly one of `icon` or `dotTone`, and at least
   one requested placement.
2. `busy` means animate the marker's icon with the shared reduced-motion-safe spinner. It does not
   make the whole rail control busy.
3. Sort by descending effective priority, then qualified contribution id, then marker id. This makes
   the result independent of plugin activation and object iteration order.
4. Assign each marker to the first unoccupied requested placement.
5. Render at most one marker in each placement.
6. Keep unplaced markers in the tooltip legend and accessible status description. Compact chrome may
   hide an icon; it must not hide the state.
7. Reserve priorities above the public plugin range for host safety and control lifecycle states.
   Loaded and compiled plugin priorities are clamped to `0..100`; host states may use `200+`.
8. A whole-control busy state wins over its normal main glyph but does not erase independent markers.
   Task archiving is migrated deliberately: if product wants the task glyph to remain visible, model
   archive as a high-priority `bottom-center` busy marker; if product wants the close control to turn
   into a spinner, use `RailTab.busy`. Do not make the resolver guess.

Suggested migration preferences:

| Marker | Preferred placements | Host priority |
| --- | --- | ---: |
| task archiving / agent working | `bottom-center` | 300 / 220 |
| unread agent attention | `top-end`, `bottom-start` | 280 |
| missing worktree | `bottom-end`, `bottom-start` | 260 |
| pinned task | `top-start`, `bottom-start` | 240 |
| CI checks | `top-end`, `bottom-end` | 200 |
| dirty worktree | `bottom-end`, `bottom-start` | 180 |
| plugin marker | contributor-declared ordered list | 0..100 |

Those values are policy, not user-visible data. Tests should pin the relative order and resulting
positions, not encourage callers to depend on the literal numbers.

## Compiled-plugin contribution

Create `packages/client-core/src/registries/railMarkers.ts`, following the JSX-free registry pattern
in `registries/slots.ts`.

```ts
export type RailMarkerTarget =
  | { kind: 'task'; id: string }
  | { kind: 'source'; id: string }
  | { kind: 'pane'; id: string; taskId: string }

export type RailMarkerContribution = {
  id: string
  order: number
  markers(target: RailMarkerTarget): readonly RailMarker[]
}
```

`markersFor(target)` invokes contributions independently, qualifies marker ids by contribution id,
clamps contributor priorities, catches one failing provider, and returns unresolved semantic markers
to the pure allocator. The callback is invoked inside the consuming Solid render, so a compiled
plugin can read signals it already owns without the host inventing query observers.

Expose the registry only through `ClientPluginContext.railMarkers.register`. Export contribution and
target types from `@acorn/plugin-api/client`; do not export the raw registry. The plugin host must own
the disposable just as it does for panes, sources, and task slots, so disabling or reactivating a
plugin removes its markers.

Migrate core by turning `railStatusItems()` into semantic `RailMarker[]` with no CSS class names.
Migrate Docker by replacing `DockerRailBadge.tsx` and its `.tabrail-docker` rule with a provider that
returns a marker when `dockerTaskSummary(taskId).running > 0`.

After verifying there are still no other consumers:

- Remove `tabrail.task-row` from `TaskSlotId`.
- Remove the `TaskSlotHost` at the task-row call site.
- Delete `DockerRailBadge.tsx` and the corresponding absolute-position CSS.
- Keep `task.footer`; it is a different, useful component slot and Docker still uses it.

## Loaded-plugin contribution

Add an optional `railMarkers` array to `PluginContributions` and the Zod manifest schema. Cap it at
four descriptors per plugin; one descriptor may return many targets, so a larger cap would encourage
fragmented polling rather than richer batches.

```ts
type PluginRailMarkersDescriptor = {
  id: string
  data: PluginRoute
  refresh?: number
}

type PluginRailMarkerTarget =
  | { kind: 'task'; id: string }
  | { kind: 'source'; id: string }
  | { kind: 'pane'; id: string }

type PluginRailMarkerItem = {
  id: string
  target: PluginRailMarkerTarget
  label: string
  icon?: string
  dotTone?: 'ok' | 'warn' | 'bad' | 'mixed'
  tone?: RailTone
  busy?: boolean
  placements?: RailMarkerPosition[]
  priority?: number
}

type PluginRailMarkersResponse = {
  items: PluginRailMarkerItem[]
}
```

Wire constraints:

- Cap a response at 256 markers and reject/drop malformed items individually. The cap bounds chrome
  memory and DOM work while covering substantially more tasks than the rail can show at once.
- Require exactly one of `icon` and `dotTone`.
- Require a non-empty label; an unexplained status glyph is not valid chrome.
- Default placements to all four corners in a stable order; `bottom-center` is reserved for host
  lifecycle/activity unless a future use earns opening it.
- Clamp priority to `0..100`.
- A source target must name a source declared by the same plugin. A pane target must name a task pane
  frame declared by the same plugin. Enforce those ownership checks when adapting the response, then
  ignore targets that are not currently registered.
- A task target may name any task id the plugin knows. The host only renders markers for tasks in its
  own task roster, so an invented or archived id has no mount site.
- Qualify descriptor and marker ids with the plugin id before they enter the client registry.
- Markers remain descriptive. The contribution has no click verb.

Do not add `?taskId=` calls. One descriptor read returns all of that plugin's current markers for the
node. It uses the existing `chromeKey`, active-node query partition, `chromeDeps(pluginId)`, plugin
push invalidation, global status invalidation, and 30-second polling floor.

### Loaded marker runtime

Manifest registration happens outside a Solid owner, while `createFleetQuery` must run inside one.
Do not hide a query inside the pure registry or create one query per rail button.

Add a host-owned `RailMarkerRuntime` mounted once from the desktop renderer shell. The chrome
registration pass registers inert feed descriptors. The runtime renders one
`PluginRailMarkerFeed` per eligible descriptor; each feed creates one fleet query, validates the
batch response, and writes the latest markers into a node- and plugin-scoped signal store. Cleanup
removes that feed's rows when the plugin is disabled, the descriptor disappears, or the active node
changes.

Rail consumers merge three sources synchronously:

```text
core markers
  + compiled registry markers(target)
  + loaded marker store(target, activeNode)
  -> qualify and clamp
  -> resolveRailMarkers()
  -> RailTab markers
```

This preserves the existing boundary: the UI component receives data, the runtime owns fetching,
and loaded plugin code never executes in shell chrome.

## Implementation sequence

### Slice 1: one rail-control component — SHIPPED

Files expected in scope:

- `packages/client-core/src/tabs/RailTab.tsx`
- `packages/client-core/src/tabs/tabrail.css`
- `packages/client-core/src/tabs/TabRail.tsx`
- `packages/client-core/src/tasks/TaskPaneHost.tsx`
- `packages/client-core/src/tasks/task-view.css`
- `apps/desktop/src/app/client/TaskView.tsx`
- `docs/ui-design.md`

Steps:

1. Add semantic glyph, tone, accent, active, busy, sublabel, and marker rendering props to `RailTab`.
2. Keep the button as the single DOM root and preserve pass-through button props.
3. Move the bottom divider/placement difference to a modifier class; render the left new-task action
   through `RailTab` and delete `.tabrail-add`.
4. Migrate source, task, pane, run, terminal, and close controls to named glyphs and explicit props.
5. Preserve call-site ARIA semantics and the close control's hoverable busy behaviour.
6. Document the component contract and why it remains distinct from the general `Button` primitive.

Slice 1 must land without introducing a plugin API or moving marker ownership. Existing status spans
may remain temporarily while the component API is characterised.

### Slice 2: semantic markers and the compiled registry — SHIPPED

Files expected in scope:

- `packages/client-core/src/tabs/railMarkers.ts` (new)
- `packages/client-core/src/tabs/railMarkers.test.ts` (new)
- `packages/client-core/src/registries/railMarkers.ts` (new)
- `packages/client-core/src/registries/railMarkers.test.ts` (new)
- `packages/client-core/src/registries/plugin.ts`
- `packages/client-core/src/tasks/railStatus.ts`
- `packages/client-core/src/tasks/railStatus.test.ts`
- `packages/client-core/src/tabs/TabRail.tsx`
- `packages/client-core/src/tabs/tabrail.css`
- `packages/client-core/src/notifications/notifications.css`
- `packages/client-core/src/registries/slots.ts`
- `packages/client-core/src/registries/uiSlots.tsx`
- `packages/plugin-api/src/client/index.ts`
- `packages/plugin-api/src/surface.snapshot.txt`
- `plugins/docker/src/client/index.ts`
- `plugins/docker/src/client/slotContribution.ts`
- `plugins/docker/src/client/DockerRailBadge.tsx` (delete)
- `plugins/docker/src/client/docker.css`
- client-plugin disable/registration tests and snapshots that name task slots
- `docs/frontend.md`, `docs/panes.md`, `docs/plugins.md`, and `docs/ui-design.md`

Steps:

1. Write the pure marker validator and allocator first, including collision and overflow tests.
2. Add the compiled contribution registry and plugin-host ownership/disposal tests.
3. Convert core statuses from CSS classes to semantic placements.
4. Render core and compiled markers through `RailTab`; derive tooltip legends in one place.
5. Convert Docker to a marker provider and verify a pinned task with running containers allocates two
   distinct positions.
6. Remove the old task-row slot and every retired positioning class after an exact consumer search.
7. Update the public plugin API type surface and owning architecture documentation.

### Slice 3: loaded-plugin descriptors — NOT BUILT

Files expected in scope:

- `packages/protocol/src/pluginContract.ts`
- the protocol module that owns `PluginContributions` and descriptor response types
- `packages/node-core/src/main/pluginManifest.ts` and its tests
- `packages/node-core/src/main/pluginLoader.test.ts` and fixtures that assert empty contribution sets
- `packages/client-core/src/plugins/chrome/data.ts` and tests
- `packages/client-core/src/plugins/chrome/register.ts` and tests
- `packages/client-core/src/plugins/chrome/RailMarkerRuntime.tsx` (new; exact placement may change)
- the renderer composition root that mounts the runtime once
- `packages/plugin-api/src/surface.snapshot.txt` if the compiled contribution export changes it
- `packages/node-core/src/server/agentTools/pluginAuthoring.ts` and its schema-derived tests if needed
- `docs/plugin-authoring.md`, `docs/plugins.md`, `docs/extensibility.md`, and `docs/ui-design.md`

Steps:

1. Add the optional descriptor and cross-field ownership validation to the manifest contract.
2. Add response types, budgets, and client-side validation with malformed-item isolation.
3. Register feed descriptors without starting I/O during plugin registration.
4. Mount one runtime, fetch one batch per descriptor and node, and cleanly evict disabled/stale feeds.
5. Adapt loaded rows into the common registry/store and reuse the pure allocator.
6. Test task, source, and pane targets; multi-node cache isolation; plugin disable/re-enable; malformed
   routes and bodies; push invalidation; and response caps.
7. Document the manifest example and explicitly retain the refusal of arbitrary rail components.

Do not build Slice 3 just to prove the abstraction. Land it when a real loaded plugin has a status to
publish, using that plugin as the end-to-end consumer.

## Test plan

The client-core Vitest configuration is intentionally Node-only and does not render `.tsx`, so do not
claim component geometry is covered by its logic suite. Split verification accordingly.

Pure tests:

- Empty marker list.
- One icon marker and one dot marker.
- Stable allocation independent of input/registration order.
- Two markers asking for the same corner use declared fallbacks.
- A marker with no free requested position remains in the legend but not visual placements.
- Host priority outranks the clamped plugin range.
- Busy markers get spin metadata without making the whole control busy.
- Invalid icon/dot combinations and empty labels are refused.
- Current simultaneous states: checks + unread + dirty + working.
- Current real collision: pinned + Docker running.

Registry tests:

- Reactive compiled provider output is read at render-time access, not snapshotted at registration.
- A throwing provider is isolated.
- Plugin disable and reactivation dispose and replace contributions without duplicates.
- Marker ids are qualified and priorities clamped.

Loaded-plugin tests:

- Manifest accepts `railMarkers`, caps descriptor count, confines data routes, and checks source/pane
  ownership.
- Older manifests default to an empty marker contribution list.
- A response is capped and malformed items are dropped without taking down other chrome.
- One response carries multiple task targets without per-task fetches.
- Active-node changes do not leak cached markers between nodes.
- Plugin push invalidates only that plugin; global status invalidation refreshes all.
- Disabling or removing a plugin removes its markers.

Manual desktop QA is still required because the repo has no DOM or screenshot suite for rail chrome:

- Check Terminal, Modern, Cozy, and Cute style packs.
- Check source, task, pane, run, terminal, add, and close controls at rest, hover, focus, active, and
  busy.
- Confirm the left `+` and right `✕` occupy equal 52px boxes with aligned dividers.
- Confirm project accent stripes remain on the left and right-rail active stripes remain on the right.
- Confirm a task with pin, Docker, unread, working, dirty, and checks never overlaps markers and still
  lists every state in its tooltip.
- Confirm reduced-motion mode stops marker and busy animation.
- Confirm task-row menus still anchor and return focus to the rail button.

## Verification commands

Run after each applicable slice; all must exit zero:

```sh
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/plugin-api test
pnpm --filter @acorn/protocol test
pnpm --filter @acorn/node-core test
pnpm --filter @acorn/plugin-docker test
pnpm lint
pnpm --filter @acorn/desktop test
```

Static completion checks after Slice 2:

```sh
rg "tabrail-add" apps packages plugins
rg "tabrail\.task-row" apps packages plugins
rg "tabrail-(checks|dirty|repair|spinner|needs|docker|pin)" apps packages plugins --glob '*.css'
```

Expected: no production matches for the retired raw add control, task-row component slot, or
feature-owned marker-positioning classes. Documentation may retain historical mentions where they
explain the migration.

## Done criteria

- Every visible control in both rails is rendered by `RailTab`.
- No rail-control caller hand-builds a main loading/deleting spinner.
- Main icons use `Icon` unless the call site is an explicitly documented compound-content escape
  hatch.
- The left and right bottom controls inherit the same 52px container geometry.
- No marker model contains a CSS positioning class.
- Marker allocation is deterministic and has collision/overflow tests.
- Core and Docker use the same marker path.
- `tabrail.task-row` no longer exists after its exact consumer count reaches zero.
- Loaded plugin support, when implemented, performs one bounded descriptor read rather than one read
  per task/source/pane.
- Loaded plugin marker pixels are entirely host-drawn.
- Tooltip legends and assistive descriptions come from the same logical markers as the visible icons.
- Owning docs describe the final contract rather than this future plan being the only source of truth.
- All verification commands pass and the manual rail matrix has been checked.

## STOP conditions

Stop and report rather than improvising if:

- In-scope rail or marker files have drifted materially from the current-state description before an
  implementation slice starts.
- Keeping `RailTab` as a single button root proves incompatible with the menu trigger or focus-return
  contract. Do not silently add wrappers around every rail control.
- A new production consumer of `tabrail.task-row` appears before Slice 2. Reassess and migrate it; do
  not delete a live seam or keep two permanent marker APIs without a decision.
- A loaded-plugin design requires one request, timer, observer, or WebSocket subscription per visible
  rail control.
- A requested plugin marker needs interactive UI, arbitrary CSS, or plugin code executing in shell
  chrome. That is a different surface and must be designed separately.
- Source/pane marker ownership cannot be verified from the winning manifest in a mixed-version fleet.
- Marker overflow cannot preserve every hidden status in the tooltip and accessible description.
- A style pack needs literal per-call-site sizing to make the new component align. Fix the shared
  token/component contract instead of reintroducing local geometry.

## Maintenance notes

- `RailTab` is intentionally not exported from `@acorn/plugin-api/ui`: loaded plugin frames do not
  draw shell rails, and compiled plugins publish marker data rather than rendering the host control.
- Keep semantic tones aligned with the shared UI vocabulary. If the design system adds a new status
  tone, update marker validation and plugin wire types together.
- Treat placement requests as preferences, never guarantees. Future core states or compact layouts
  may reserve a position.
- If a sixth visual position is ever proposed, first show why overflow-in-legend is insufficient. A
  52px control has a strict information budget.
- If the loaded contribution ships, update the generated plugin-authoring vocabulary and release
  notes. Optional contribution parsing makes it backward-compatible, but authors still need to know
  which client version first renders it.
- The loaded feed store must be scoped by node, plugin, descriptor, and target identity. Omitting any
  one of those recreates the cross-node or reload leaks the rest of client state is designed to
  prevent.
- Reviewers should be suspicious of any CSS selector in a feature/plugin stylesheet that positions a
  rail marker. That is the regression signal that placement escaped the host again.
