# Phase 04: model grants and interactive advisor

Status: proposed, 2026-10-03. Entry: phase 03 accepted. Next:
[phase 05](./05-unattended-follow-ups.md).

## Outcome

The owner configures a model and daily allowance for a loaded advisor. The advisor reviews completed
interactive turns and sends a bounded note when warranted. This phase delivers the model seam and
its consumer together. Sources: [model calls](../04-unattended-model-calls.md) and
[advisor](../05-advisor.md). Unattended delivery is phase 05.

## Ownership and data flow

Paired device settings → authenticated core route → Node-held plugin model grant and accounting →
host-bound model facade → credential-backed provider or contained harness generation.

Completed turn lifecycle → advisor's durable job → agents' bounded review reader and task git
projection → host-selected generation → advisor emission guard → phase 03 messenger → agent turn.
Generation usage returns to core accounting and the settings cache; review notes remain in the
advisor's database. No prompt, diff, response, or credential enters telemetry.

Read these starting points:

- `packages/node-core/src/server/core/models.ts`, `modelProviders/types.ts`, and provider runtimes.
- `packages/node-core/src/server/plugins/permissions.ts`, `isolation.ts`, and `hostCallModes.ts`.
- `packages/plugin-types/src/contracts/coreMisc.ts` and model request wire/export ownership.
- `plugins/agents/src/contract/lifecycle.ts`, agents repositories, and `plugins/agents/src/node/index.ts`.
- `packages/client-core/src/features/settings/plugins/PluginPage.tsx`, core preference ownership,
  migrations, and model-provider settings/query conventions.

`scopeCore` binds plugin identity but exposes the models facet directly in the inspected code.
Generation must gain an owner-bound wrapper; an optional caller-supplied `pluginId` is insufficient.

## Implementation

1. Add core-owned plugin model grant and daily accounting records, with migrations and no reset.
   Key grants by Node-local owner identity and plugin ID. Store backend, selected model, and
   daily allowance. Resolve the active identity for loaded calls and fail if it is absent or
   inconsistent. Do not introduce team ownership by guessing from a global active login.
2. Add device-only settings reads/writes and shared host UI for plugins holding `models` permission.
   Validate backend ownership and model selection on the Node. Reflect missing connections,
   exhausted allowances, remaining capacity, and unconfigured state through the selected-Node cache.
   Plugins cannot rewrite their host-held grant through namespace preferences or their own routes.
3. Preserve calls that explicitly name a backend. Add an omitted-backend path only through the
   host-bound plugin facade; core's unrelated callers still require an explicit selection. Resolve
   the stored grant on every call, enforce its model, and reject unconfigured or exhausted grants
   before invoking a provider. Return `provider_not_configured` or `provider_budget_exhausted` with
   actionable settings copy. Never fall back to `available()[0]`.
4. Make capped admission atomic. Reserve the requested `maxOutputTokens` before a connection call,
   refuse a reservation beyond the remaining day, and reconcile actual output usage after success.
   Missing usage consumes the full reservation. A harness call consumes one fixed estimated unit
   stated in settings, matching the proposal's call-count approximation. Harness generation may
   return usage but ignores its requested output-token bound; retain reported usage separately and
   never describe the estimate as an enforced token ceiling. Persist outstanding
   reservations; after a crash, charge them conservatively rather than releasing possibly-spent work.
   Do not hold a database transaction over network execution.
5. Assign a call to the Node-local calendar day at admission. Retain that bucket across midnight.
   A timeout or ambiguous provider failure keeps its reservation charged; a failure proved to occur
   before dispatch may release it. Record cancellation semantics and how concurrent calls, grant
   changes, and restarts affect reservations. Usage accounting never claims an exact monetary limit.
   Record explicit-backend calls separately without changing their behavior. Clearly state that the
   managed allowance caps omitted-backend calls, not all spending permitted by the broad models grant.
6. Introduce a bounded `agents.reviewInput.v1` reader in agents' public contract. Findings and its
   reader were removed. Accept task, session, and turn IDs, verify their relationship, and return
   unavailable for ineligible or inaccessible turns. Return only completed-turn user text and final
   assistant text, with truncation indicators and provenance for non-person context. Start with a
   16 KiB aggregate user-text limit and a 32 KiB final-text limit. No raw ledger, tool output, hidden
   reasoning, filesystem path, or cross-plugin database handle is returned.
7. Build the standalone advisor with phase 03's messenger and a settings tree. Grant the reader,
   `agents.turns` for stop reasons, `agents.sessions`, completed-turn events, and the required
   models/tasks/git facets. Resolve identity through the host path. Apply owner opt-in, default off,
   and only interactive support in this phase. Bound the git diff to 32 KiB with an explicit
   truncation marker. It is a task working-tree snapshot, not proof of edits by one agent.
8. Implement a durable review job keyed by session and completed turn. Re-read turn state on events;
   events are notifications, not durable delivery. Do not replay all historical turns or retry an
   ambiguously dispatched model call after restart. Record interrupted jobs and resume only work
   known not to have spent. Bound concurrent jobs and cancel them on disable, archive, and shutdown.
9. Follow the advisor design: skip plugin/delegation-report turns; prefer `none`; validate severity
   and byte bounds; suppress repeats and apply cooldown. Record nits and finished-answer concerns
   without waking the agent. Queue a blocker or a qualifying mid-work concern through the messenger.
   Check the latest turn/cancellation and task state again after generation, not only before it.
   Never restart a stopped session on a late result. Fence all reviewed content as data.

Publish the grant and reader only with the installed, exercised advisor. Keep the advisor outside
the compiled roster. Missing grants or reader availability disable its action with a recorded reason.
No full-conversation side turn, autonomous model-family selection, stream generation, or credential
spending from a task-principal agent tool enters this phase.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Core/worker evidence must cover:

- Host-bound identity, a spoofed owner, a missing grant, and a removed backend fail without spending.
- Concurrent reservations cannot exceed available units; accounting survives restart and midnight.
- Missing usage, ambiguous failure, and harness estimates cannot silently replenish an allowance.
- Explicit-backend callers preserve behavior; the settings warning accurately states the cap's scope.
- Review IDs cannot read another task or unfinished turn; bounds and provenance survive worker RPC.
- Cancellation and timeout behavior remain effective across the loaded transport.

Advisor evidence must cover a repeated event, restart, malformed result, duplicate concern, cooldown,
cancel during generation, and note-generated turns. Run a seeded bad change in a real interactive
session: a blocker is attributed, the agent responds, and usage appears on the correct Node's
settings page. Inspect desktop and terminal settings/transcript surfaces and an offline/Node-switch
case. Prove a disabled or unconfigured advisor makes no paid call.

## Documentation and handoff

Update [integrations](../../../integrations.md), [state ownership](../../../state-ownership.md),
[data layer](../../../data-layer.md), [model grant authoring](../../../plugin-authoring/the-manifest.md#permissions),
[managed agents](../../../managed-agents.md), [plugin map](../../../plugin-map.md), and provider checks.
Document the review-reader limits, conservative accounting, broad grant limitation, and interactive
scope. Supply the advisor package and grant schema revisions to phase 05.

## Verify before building

Inspect model facade ownership, migration placement, current identity semantics, provider usage
reporting, byte-bound transcript extraction, event subscription delivery, and generation cancellation
through the worker. Check the public declaration generator/export map whenever request types change.
