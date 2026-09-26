# Phase 5: use one availability model at every contribution host

Status: proposal, 2026-09-26. Not started. Waits on
[phase 1](./01-runtime-identity.md); final integration uses
[phase 2](./02-fleet-distribution.md).

Part of [Node-provided UI](./README.md).

## Goal

Every host answers the same question before showing or invoking a plugin contribution: does the
relevant node have a matching active runtime and does this device have its accepted client selection?
The answer distinguishes absent, disabled, failed, waiting for restart, unreachable, trust-pending,
and available states without relying on a misleading boolean.

Compiled contributions that require a node plugin use the same node-runtime answer. Loaded settings,
importers, and task footer slots receive the gates they currently lack.

## The current failure

There are two incomplete predicates today:

- `pluginEnabledOnNode(nodeId, pluginId)` finds a roster row by name and checks `row.running`.
- `hasHostCapability({ plugin: id })` checks only that the id is absent from
  `disabledNodePlugins()`.

The first treats a failed row as usable because node state deliberately reports some failures as
`running: true` to avoid a restart banner. The second treats an absent, failed, unread, or
pending-restart plugin as present because none of those ids is in the disabled list. Before the first
roster read, every plugin capability is effectively true.

Most loaded panes, sources, overlays, topbar entries, commands, and extension bindings add a direct
`pluginEnabledOnNode` check. The coverage is not complete:

- loaded settings pages register no plugin requirement;
- project importers have no `requires` or `when` field and their host enumerates raw registry entries;
- loaded task footer slots register no requirement;
- each new registry has to remember a plugin-specific predicate in addition to its normal host
  capability gate; and
- the three-state `loadedPluginStateOnNode()` cannot explain failure, pending restart, trust, or
  runtime mismatch to Settings and command metadata.

The result is inconsistent UI and calls to routes that are not serving.

## Decision: availability is structured state

Keep runtime state and client selection state distinct, then derive a contribution result.

```ts
type NodePluginRuntimeState =
  | { kind: 'unknown' }
  | { kind: 'unreachable'; lastKnown?: PluginRuntimeIdentity }
  | { kind: 'absent' }
  | { kind: 'disabled' }
  | { kind: 'failed'; stage?: string; reason?: string }
  | { kind: 'waiting-for-restart'; candidate: InstalledPluginRow }
  | {
      kind: 'active'
      runtime: PluginRuntimeIdentity
      pendingCandidate?: InstalledPluginRow
      warning?: PluginFailure
    }

type LoadedSelectionState =
  | { kind: 'accepted'; hash: string }
  | { kind: 'pending-trust'; hash: string }
  | { kind: 'rejected'; hash: string }
  | { kind: 'bundle-missing'; hash: string }
  | { kind: 'incompatible' }
  | { kind: 'none' }

type ContributionAvailability = {
  available: boolean
  runtime: NodePluginRuntimeState
  selection: LoadedSelectionState
  reason: AvailabilityReason
}
```

The exact type names can change. The rules cannot:

- “available” for a loaded contribution requires an active runtime, a selected accepted client whose
  identity matches it, a reachable target node, and any contribution-specific `when` predicate;
- a compiled contribution with `{ plugin: id }` requires an active node service, but no loaded-client
  selection;
- unknown defaults to unavailable;
- failure with no previous active identity is unavailable;
- a failed reload that preserved a previous active identity remains available from that previous
  identity and carries a warning;
- a pending disk candidate does not displace an active old identity; and
- a fresh install waiting for first start is unavailable.

The selector takes a node id. An overload using the active node may exist at shell call sites, but the
core implementation never reads an ambient node when a surface already knows its node.

## Pending-restart semantics

`pending-restart` is a relation between active and desired state, not an availability result by
itself.

| Situation | Runtime availability | Candidate status |
| --- | --- | --- |
| 1.0 active, 2.0 installed | Available as 1.0 if its client selection is accepted | Update waits for restart. |
| 1.0 active, uninstall saved | Available as 1.0 until restart | Removal waits for restart. |
| 1.0 active, disable saved | Available as 1.0 until restart | Disable waits for restart. |
| No runtime, 1.0 freshly installed | Unavailable | Start waits for restart. |
| No runtime, enable saved | Unavailable | Enable waits for restart. |
| 1.0 active, 2.0 reload failed | Available as 1.0 with warning | Candidate failed; restart behavior follows the actual disk and loader state. |
| Boot of 1.0 failed | Unavailable and failed | No active identity exists. |

This table replaces attempts to make one `running` flag both suppress banners and authorize UI.

## One node-runtime selector

The active-node plugin roster in `infra/node/nodePlugins.ts` and the fleet distribution snapshot must
not drift into two models. Either expose the active node as a selector over phase 2's `byNode` map, or
make both projections consume one normalized row adapter from phase 1.

`hasHostCapability({ plugin: id })` then asks the normalized runtime selector whether the active node
has an active service. It no longer uses “not disabled” as a proxy for “present and running.”

The host capability retains its current purpose for compiled registrations:

```ts
hasHostCapability({ plugin: 'terminal' })
```

Loaded contributions add the accepted-selection half automatically through their registered plugin
owner metadata or a shared loaded-contribution gate. Call sites should not compose two unrelated
predicates by hand.

## Registry contract

Every contribution that the host filters before drawing has a host requirement. Every contribution
whose draw site has contextual state may also have `when`. This follows the existing registry rule.

For loaded contributions, registration supplies `{ plugin: pluginId }` or an equivalent typed owner
gate centrally. Prefer deriving it from registry ownership so a new registration site cannot forget
it. A plugin's own manifest must not be able to omit or override the requirement on its node half.

### Settings

`settingsRegistry` already supports `requires` and `settingsContributions()` filters it. Loaded
settings registration supplies the plugin requirement. If the currently selected settings page
becomes unavailable after a node switch or failure, `SettingsModal` selects the first available page
and announces why the previous page closed through existing status UI.

### Project importers

Add `requires?: HostCapabilityRequirement` to `ProjectImporterContribution` and one sorted,
filtered `projectImporterContributions()` selector. Both the button list and active importer lookup use
that selector. If an open importer becomes unavailable, close it through its normal host lifecycle and
clear its selected id.

Loaded importer registration supplies the plugin requirement. Compiled importers may declare other
requirements in the same field.

### Task slots

`SlotBase` already has `requires`, and the task slot host already applies `hasHostCapability`. Loaded
footer registration must supply the plugin requirement just as loaded topbar registration does. Add a
task-aware `when(taskId)` only if a real slot needs state beyond node runtime; availability itself does
not require a second gate type.

### Commands and shortcuts

A loaded command stays registered so persisted keybinding and command ids remain explainable, but its
`enabled` or `active` selector uses the common availability result. Invocation re-checks at execution
time so a node failure between drawing and pressing cannot call a missing route. Disabled rows should
surface a stable reason where the palette already shows disabled commands.

### Other loaded kinds

Audit every manifest-derived registry in `frames/register.ts` and `chrome/chromeRegister.ts`, including:

- task and project panes, reference panels, overlays, settings, importers, and routes;
- rail sources, source actions and empty states;
- topbar and task slots;
- commands, keybindings, context menus, and search or picker providers;
- cooperative extension points and contributions;
- task annotations, checks, and any scheduled client projection; and
- themes or other data-only contributions.

For data-only or client-only kinds, record why node service availability does or does not apply. Do
not add a route-bearing exception because it happens to fail quietly today.

## Visibility versus explanation

Unavailable product surfaces generally disappear or disable according to their existing host
contract. Settings → Plugins remains the explanation surface and shows the structured reason:

- “Not installed on this node”;
- “Disabled after restart” or “Still active until restart,” as appropriate;
- “Waiting for node restart”;
- “Failed to load: …”;
- “Node unavailable”;
- “Waiting for approval on this device”;
- “Rejected on this device”; or
- “Client bundle does not match the running plugin.”

Do not leave a blank pane or a badge that repeatedly calls a missing route as the diagnostic.
Contribution boundaries still catch unexpected render failures; availability is a normal state and
does not use the error boundary.

## Node switch behavior

The active-node switch commits phase 2's selected contribution set and availability projection
together. A render must not see node B's tasks with node A's plugin gates.

Per-task hosts that can display content for a node other than the shell's active node pass that node id
explicitly. If no such host exists, preserve that simpler invariant in an architecture test rather
than assuming it forever.

## Code touched

- `packages/client-core/src/host/plugins/distribution.ts`: normalized runtime and loaded availability
  selectors over the immutable fleet snapshot.
- `packages/client-core/src/infra/node/nodePlugins.ts`: active-node projection or adapter; retire
  `disabledNodePlugins` as the capability source.
- `packages/client-core/src/infra/node/hostCapabilities.ts`: `{ plugin: id }` means active service.
- `packages/client-core/src/host/plugins/contributions.ts`: attach the selected accepted identity to
  every loaded owner.
- `packages/client-core/src/host/frames/register.ts` and
  `packages/client-core/src/host/chrome/chromeRegister.ts`: use one common gate and fill missing
  requirements.
- `packages/client-core/src/host/registries/shell/settings.ts`: keep the existing filtered selector and
  make current-page fallback explicit.
- `packages/client-core/src/host/registries/sources/projectImporters.ts` and
  `features/workspaces/WorkspaceProjectAssignments.tsx`: add and consume a filtered importer selector.
- `packages/client-core/src/host/registries/extensionPoints/slots.ts` and `uiSlots.tsx`: verify task
  slots consume their requirement and add contextual `when` only if needed.
- Command, pane, source, and extension registries found by the audit.

## Tests

### Availability table

- Unknown, unreachable, absent, disabled, failed, waiting for first start, active, active with update,
  active with pending disable, and active with failed reload each produce the documented result.
- An accepted hash that does not match the active runtime is unavailable.
- Pending, rejected, missing, and incompatible selections never make loaded code available.
- A compiled `{ plugin: id }` requirement is false for absent, unknown, failed, disabled, and waiting
  for first start; true for an active old runtime even when a change waits for restart.

### Registry coverage

- Loaded settings, importers, task footer slots, topbar slots, panes, overlays, sources, commands,
  context menus, and extension contributions all disappear or disable on node switch to a node without
  the runtime.
- A failed plugin contributes none of those surfaces unless a previous active identity survived a
  failed reload.
- An open settings page or importer closes or falls back cleanly when availability changes.
- Command invocation re-checks availability after the palette was drawn.
- Initial unknown state does not flash a compiled plugin surface into view.

### Architecture guard

Add a focused test or typed registration helper that fails when a manifest-derived, route-bearing
contribution is registered without its loaded owner availability. Avoid a brittle source-text census
when ownership metadata can enforce the rule structurally.

## Docs owed

- `docs/plugins/activation.md`: normalized runtime and loaded availability states.
- `docs/contribution-kinds.md`: availability behavior for every loaded kind.
- `docs/ui-design.md`: Settings explanations and fallback behavior.
- `docs/command-palette-and-shortcuts.md`: unavailable loaded commands.
- `docs/state-ownership.md`: active-node projection over fleet state.
- `docs/testing.md`: registry coverage and node-switch matrix.

## Done when

- No capability check equates “not disabled” with “active.”
- No loaded contribution gate relies on `row.running` without the phase 1 active identity.
- Settings pages, project importers, and task footer slots use the same availability rule as panes and
  topbar entries.
- Pending restart preserves an actually active old runtime and withholds a fresh unstarted one.
- A node switch updates data scope, selected registrations, and availability as one coherent change.

## Verify before building

- Confirm `pluginEnabledOnNode()` still checks only `row.name` and `row.running`.
- Confirm `hasHostCapability({ plugin })` still checks only `disabledNodePlugins()`.
- Confirm failed roster rows can still report `running: true` in `pluginHost/state.ts`.
- Confirm loaded settings registration omits `requires`, project importers have no requirement field,
  and the loaded footer slot omits its plugin requirement.
- Enumerate every call to `pluginEnabledOnNode`, `loadedPluginStateOnNode`,
  `hasHostCapability({ plugin: ... })`, and every manifest-derived registry before changing the common
  selector.
- Confirm task hosts currently belong to the active node before allowing an ambient-node overload.
