# Phase 1: the renderer

Status: not started. Waits on phase 0.

## Goal

The renderer emits the same five record kinds, batches them, and posts them to the node. A user
action is one trace that spans the renderer and the node: the command or page-change span is the
root, and every request it sends carries `traceparent` so the node's `http.request` span is its
child. A slow page change, a slow pane region, a slow plugin frame, and a chatty bridge are each one
query away, with the owner on every record. Settings has the switch. The renderer's console sites
log through the logger.

## Why this phase, and why now

Half of what Sentry would show is renderer time, and the node cannot see it. The renderer is also
where the owner of a contribution is least recorded today: a pane, a source, a slot, a ref panel, and
a settings page carry no plugin id on their record, only in the closure that registered them.

## Scope

In:

- `packages/client-core/src/infra/telemetry/` (new): the emitter with the same verbs as the node's,
  the interaction-trace holder, a 1,000-record offline queue, the batch poster.
- `POST /v2/core/telemetry` (new route) in `packages/node-core/src/server/routes/telemetry.ts` (new),
  behind `requireUser` and `requireDevice`, body parsed with `telemetryBatchSchema`, 1 MiB cap,
  `runtime` re-stamped from the principal. A row in `packages/protocol/src/api.ts` and the route
  registry golden regenerated.
- `apiClient.ts` `send()`: `traceparent` and `x-request-id` headers; an `api.request` span; a flag so
  the batch post itself is not spanned.
- `fleet.ts` `clientFor`: a `QueryCache` and a `MutationCache` with `onError`.
- `executeCommand`: a `command` span that opens an interaction trace.
- `activateTaskSignals` and `setSelectedSource`: a `nav.change` span ended on the second
  `requestAnimationFrame` after the switch, the boot-mark pattern.
- `drawLayout`: a `pane.region` span per region from creation to the child's `onMount`.
  `paneModel`: a `pane.model` span.
- `PluginFrame.tsx`: `frame.boot`. `broker.ts`: the `bridge.message` histogram and `bridge.overbudget`
  event. `treeState.ts`: `tree.apply`. `pluginChannel.ts`: `plugin.frame`.
- `ContributionBoundary.tsx`: an error record with the owner.
- `Registry` gains `ownerOf(id)` and `register(entry, owner?)`. `chromeRegister.ts`,
  `frames/register.ts`, and `makeContext` pass the owner.
- `window` `error` and `unhandledrejection` handlers in `apps/desktop/src/client/index.tsx`.
- A Settings → General row for `telemetry.enabled`, reading and writing the node pref.
- The 64 console sites in `packages/client-core/src` and `apps/desktop/src`.

Out: the terminal client and the helper (phase 3), even though both are client-core; the frame SDK
verb and the compiled export (phase 4).

## Design detail

**One trace per interaction.** A module-level `currentTrace` is set when a `command` or `nav.change`
span starts and cleared when it ends. `send()` reads it. Work that continues after the span ends gets
no parent, which is a known imprecision and is written down rather than fixed with an async-context
polyfill the renderer does not have.

**A page change is a signal write, not a navigation.** Routes mount a no-op component and
`App.tsx` draws from `selectedSource()` and `activeTaskId()`, so there is no router event. The span
starts in `activateTaskSignals` or the `setSelectedSource` wrapper and ends on the second
`requestAnimationFrame`, which is when the first frame with the new content has painted. Pane regions
that suspend are measured separately by `pane.region`.

**The owner side-map, not a field on every type.** Eight contribution types lack a plugin id.
Adding a field to each would change every registration site. `Registry` keeps `owners: Map<id,
owner>` filled by the three registration passes that know the owner, and `ownerOf(id)` answers for
the seams. Compiled plugins are stamped by `makeContext`, which already knows the plugin name.

**The route takes a device, not a task.** A task-scoped internal token must not be able to inject
records that a sink will send off the machine. `requireDevice` is the existing gate.

**The batch post is not spanned.** A span per batch would be a batch per span. `send()` takes an
internal option the poster alone sets.

## Code touched

- `packages/client-core/src/infra/telemetry/emitter.ts` (new), `queue.ts` (new), `post.ts` (new),
  with tests.
- `packages/node-core/src/server/routes/telemetry.ts` (new); `packages/node-core/src/server/index.ts`
  mounts it; `packages/protocol/src/api.ts`; `apps/node/test/integration/routeRegistry.snapshot.json`.
- `packages/client-core/src/infra/node/apiClient.ts`, `fleet.ts`, `wsClient.ts`.
- `packages/client-core/src/host/registries/commands/commands.ts`,
  `packages/client-core/src/features/tasks/activate.ts`, `tasks.ts`.
- `packages/client-core/src/host/registries/panes/panes.ts`, `paneModels.ts`.
- `packages/client-core/src/host/frames/PluginFrame.tsx`, `broker.ts`;
  `packages/client-core/src/host/tree/treeState.ts`; `packages/client-core/src/host/plugins/pluginChannel.ts`.
- `packages/client-core/src/kit/components/content/ContributionBoundary.tsx`.
- `packages/client-core/src/kit/lib/registry.ts`; `packages/client-core/src/host/chrome/chromeRegister.ts`;
  `packages/client-core/src/host/frames/register.ts`;
  `packages/client-core/src/host/registries/extensionPoints/plugin.ts`.
- `apps/desktop/src/client/index.tsx`; a Settings row in `packages/client-core/src/features/settings/`.
- The console sites.

## Tests

- Emitter: disabled is a no-op; the queue drops oldest at 1,000; a batch posts at 500 or five
  seconds; the post carries no `traceparent`.
- `apiClient.test.ts`: `traceparent` present while an interaction is open, absent after; the format
  is W3C; `x-request-id` equals the client's id.
- `commands.test.ts`: a `command` span with `owner` from `ownerId`, status from the outcome.
- A jsdom host test in `packages/client-core`'s `hosts` project: a `nav.change` span ends after two
  animation frames; a `pane.region` span for a region that suspends ends when its child mounts.
- `registry.test.ts`: `ownerOf` answers after `register(entry, owner)` and is undefined for core.
- Route test: a device principal posts a batch and the sink sees it with `runtime` re-stamped; a
  task-scoped token gets 404; a 2 MiB body is refused.
- The route registry golden regenerated and reviewed.

## Docs owed

Per [docs-migration.md](./docs-migration.md): `docs/telemetry.md` (new in phase 0) gains a renderer section;
`docs/frontend.md` a new section; `docs/api-reference.md` the route; `docs/state-ownership.md` the
Settings row.

## Doors left open

1. Against [03-seams.md](./03-seams.md): the emitter's verbs match the node's, so the terminal client
   and the helper in phase 3 reuse the emitter and change only the poster.
2. Against [04-plugin-dx.md](./04-plugin-dx.md): the bridge already has a rate window, so phase 4's
   `telemetry` verb inherits it.
3. `ownerOf` on `Registry` is the seam a future "slow plugins" Settings page reads.

## Done when

- Running a command in the desktop app produces, at a test sink on the node, a `command` span and an
  `http.request` span sharing a trace id, with the request span's parent equal to the command span.
- Opening a task produces a `nav.change` span and one `pane.region` span per visible region, each
  with the pane's owner.
- A plugin frame that never handshakes produces an error record naming the plugin within ten seconds.
- The Settings row flips the pref and the node sees it within five seconds.
- `rg "console\." packages/client-core/src apps/desktop/src` finds only the logger.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- `apiClient.ts` has one private `send()` that every helper funnels through and a `raise()` that
  builds every `ApiError`; the transport spreads request headers unchanged
  (`packages/custody/src/broker/nodeBroker.ts`).
- `fleet.ts` `clientFor` constructs `new QueryClient` with no `QueryCache` or `MutationCache`.
- `App.tsx` draws from `selectedSource()` and `activeTaskId()`, and routes mount a no-op component.
- `panes.ts` `drawLayout` wraps each region in its own `Suspense`.
- `Registry` in `kit/lib/registry.ts` is the base of `paneRegistry`, `sourceRegistry`, and the slot,
  ref-panel, settings, attention, node-stat, and project-surface registries.
- `requireDevice` exists in `packages/node-core/src/server/middleware/` and refuses a task-scoped
  principal.
