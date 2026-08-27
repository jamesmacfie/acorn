# Phase 4: a node drives its own work

Part of [phased-review-steps](./README.md). Sources: findings 2 through 6, 8, 9, and 11 of
[the extensibility review](../../reviews/2026-08-27-extensibility-adversarial.md), plus the four
standing defects in [events/delivery.md](../events/delivery.md).

The organizing fact, from the review: acorn has given two answers to "who drives work when no
window is open", and the client-side answer owned the seams the future needs. A provisioned cloud
node with no client attached must not be an idle VM, so every mechanism that assumes a visible
desktop window is a hole in the headless story. The items here are independent of each other and
can interleave with phase 3.

## Work items

### 4.1 The trigger clock: landed, verify and finish

Extensibility review, finding 2. The workflow trigger sweep was clocked by a client poller that
skipped ticks while `document.hidden`. The working tree already contains the swap:
`plugins/workflows/src/client/triggerPoller.ts` is deleted and `triggerSchedule.ts` added, and
the client-side `pollers` registry became `schedules` in the consistency batch.

Verify the finish line the review defines, because a renamed client schedule is not the same as a
node-driven sweep: the sweep must run via `ctx.schedules` on the **node**, so a headless node
with no client connected fires a trigger and starts a run. If the current state is still a
client-clocked schedule, move the sweep node-side (the evaluate-returns-matches contract does not
change; it is a clock swap) and decide the fate of
`POST /v2/p/workflows/workflows/triggers/poll`: keep it as an explicit "check now" for a person
who is looking, or delete it. Acceptance for this item is the review's: a headless node fires a
trigger with no client attached.

### 4.2 Decouple runNodeAction from the scheduler

Extensibility review, finding 3. `runNodeAction`
(`packages/node-core/src/server/nodeActions/registry.ts`) is the only generic "make a plugin do
something with no client attached" primitive, and its sole caller and its documentation are the
scheduler's. Every future trigger (an event, a monitor threshold, a webhook, a run finishing) is
a different caller of the same actions.

- Reword `ctx.nodeActions` to describe work a plugin will do when something asks, not schedule
  targets.
- Give `runNodeAction` a second caller so the coupling cannot re-form. The natural first one is
  the trigger sweep from 4.1 or an event subscription from 4.7; do not invent a caller just to
  have one.
- Keep the risk tier on the consent record; two callers is when it starts paying (a person armed
  this on a timer versus an event armed it automatically).

### 4.3 Node-side extension points

Extensibility review, finding 4. The node's only plugin-to-plugin seam is single-provider
capabilities; the client has a real many-to-many seam in `extensionPointRegistry`. The
consequence exists already: `WorkflowContributionRegistry` is a private hand-rolled
many-provider registry, and [orchestration.md](../orchestration.md) wants `registerStepKind`
opened so the HTTP plugin can contribute a step.

Build the node-side twin of the client's extension points, matching its rules: the host mints
`<ownerId>:<pointId>`, contributions are ordered, duplicate ids from one plugin are refused,
everything disposes on unload. Then:

- Port `WorkflowContributionRegistry` onto it, replacing rather than sitting beside it, so the
  mechanism count stays flat.
- Expose `registerStepKind` through it and let the HTTP plugin contribute the `http` step
  (orchestration.md item 8), where the scheme-after-interpolation check and body cap already
  live. That step is the seam's proving consumer.

Do this before granting any one-off registry access; the review's argument is that one-off grants
are how five private registries with slightly different lifecycles happen.

### 4.4 A run registry, not a run table

Extensibility review, finding 5. Three systems model "a thing that started, took time, cost
money, and ended" in three SQLite files, and nothing can list them together. The lazy version the
review argues for: a registry shaped like `ctx.collections`, where a plugin declares the route
that lists its runs and the host merges. That yields a unified run list, a fleet-wide run count
on the node card (the `nodeStatRegistry` half already exists), and an agent tool's answer to
"what is running", with no migration.

Write down the trigger for ever building the core table, so it is recognized rather than
re-argued: when something outside the owning plugin must cancel a run or charge it against a
shared budget. Until then, no table. Related, record where the eventual cross-plugin resource
governor belongs (finding 11): beside the run registry, modeled on `ProviderRequestScheduler`'s
two-level shape, and not before the registry exists.

### 4.5 Generalize client capability gating

Extensibility review, finding 8. `HostCapabilities` (renamed from `Capabilities` in the
consistency batch, `packages/client-core/src/hostCapabilities.ts`) is still a closed two-key
union, and the `terminal` key hardcodes one plugin's name. A contribution cannot declare "needs
the docker plugin" or "needs the workflows plugin", and cannot require two things.

- Generalize to `requires: { plugin: <id> }` backed by `disabledNodePlugins()`, which already
  answers the question for any plugin id. Keep `desktop` as a boolean; it is a different
  question.
- Audit the 20 `requires: 'desktop'` sites. Each one is a surface a cloud or web client will not
  have; per [cloud-guardrails.md](./cloud-guardrails.md), each keeps the gate only with a reason
  recorded. The extensibility review suggests this audit belongs with the control-plane work;
  doing it here keeps phase 5 smaller.

### 4.6 Plugin-declared audit actions

Extensibility review, finding 9. `AuditAction` is a closed union of 15 host verbs, and nothing a
plugin does is on the trail, which for an agent-driven product means the interesting events (a
run cost money, a workflow pushed a branch) are invisible to the one surface built for review.
Let a plugin declare its audit actions in its manifest the way it declares schedules and
harnesses; the host qualifies each with the plugin id; the settings surface can still enumerate
the whole vocabulary because it came from parsed manifests. The closed-set argument survives
intact, which is the same trade the harness registry already makes.

This also feeds phase 5: `node.enrolled` and `node.detached` join the core vocabulary there, and
the cloud plugin will want its own qualified actions.

### 4.7 Events delivery: the defects and the first event

The events folder owns the catalogue and the subscription design; what belongs in this phase is
the delivery floor those designs assume, which is also four standing defects by the codebase's
own rules ([events/delivery.md](../events/delivery.md)):

1. A second client keeps a stale task list until reconnect (no broadcast from task CRUD).
2. `plugins:changed` fires on reload only; install, update, uninstall, enable/disable are silent.
3. A remote editor save never pings `ctx.events.status`, so other clients' trees go stale.
4. Connection state changes (four writers flip `needs-auth`) broadcast nothing.

Work: fix defects 2 and 3 outright (five call sites, no design), settle the
`SUBSCRIBABLE_CHANNELS` naming split before the first addition makes it unsettleable, then ship
**task changed** end to end (node emit, frame allowlist entry, client re-emit), which closes
defect 1 and exercises every layer. Defect 4's "connection changed" event follows the same path
once task changed proves it. The rest of the catalogue stays with the events folder.

The cloud relevance is direct: multi-client staleness is an edge case with one desktop and one
node, and the normal case once nodes are remote and clients plural.

### 4.8 Record the transport limit

Extensibility review, finding 6. The events admission rule reads as pure design principle when
part of it is a transport limit: `wsBroadcast` sends to every non-confined socket with no
subscription or backpressure, so machine-scale streams (container health, cloud run tails) cannot
ride it, and the stream path is reserved for compiled plugins. Add the limit to
[events/README.md](../events/README.md) beside the admission rule, so a future monitoring
proposal starts from "the socket cannot carry this" rather than re-deriving it. No code.

## Acceptance

- A node booted headless (no desktop, no client socket) fires a due workflow trigger and starts
  the run; the run is visible when a client later connects.
- `runNodeAction` has two callers and its context documentation no longer mentions schedules as
  the only trigger.
- `WorkflowContributionRegistry` is deleted; the HTTP plugin contributes an `http` step through
  the node extension-point seam and a repo-authored workflow uses it behind the existing trust
  snapshot.
- The unified run list renders rows from at least workflows and agents without either plugin
  importing the other.
- A contribution can require an arbitrary plugin id; the `requires: 'desktop'` audit is recorded
  with a kept-or-changed decision per site.
- A plugin manifest declares an audit action and the settings surface enumerates it, qualified.
- Two clients connected to one node see a task create, archive, and plugin install without a
  manual refetch; the events README records the transport limit.

## Verify before building

- Confirm where the trigger sweep is clocked after phase 0 lands: node `ctx.schedules`, client
  schedule, or both. Read `plugins/workflows/src/client/triggerSchedule.ts` and the workflows
  node half before assuming 4.1 is open or done.
- Re-read `events/delivery.md`'s defect list against the tree; defect fixes land opportunistically
  and the five call sites it names may have moved.
- Check whether anything besides the composition root consumes `WORKFLOWS_RUNNER` before porting
  the registry.
- Re-count `requires: 'desktop'` sites; the consistency review moved that number once already
  (14 to 20).
