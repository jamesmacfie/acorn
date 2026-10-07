# Phase 04: model grants and interactive advisor

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 03 accepted.
Next: [phase 05](./05-unattended-follow-ups.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-04-model-grants-and-advisor`, at the commit titled "Phase 04: Model
grants and interactive advisor". [Plugin model grants](../../../integrations/model-providers.md#plugin-model-grants)
and [review input](../../../managed-agents/session-events.md#review-input) are the owning contracts.

- **Grant tables.** Core migration `0004_plugin_model_grants` adds `plugin_model_grants`, keyed by
  owner ID and plugin ID with backend, model, and daily output-token allowance, and
  `plugin_model_calls`, one row per call. Both are in `modelProviders/grantSchema.ts`, with the boot
  step `chargeInterruptedModelCalls` that `makeBindings` runs after `ensureBoundIdentity`.
- **Owner-bound facet.** `scopeCore` gives a loaded plugin `core.models.forPlugin(pluginId)`, so
  `models` left the one-to-one facet table. With no `backendId`, `modelProviders/grants.ts` checks
  that `userId` is `identity.active()`, refuses a differing `modelId`, validates the input, reserves,
  calls, and settles. With a `backendId`, it calls as before and records an `explicit` row. Built-ins
  and core callers keep the raw service and `GenerateTextRequest`, which must name a backend.
- **Errors.** `provider_not_configured` (400) and `provider_budget_exhausted` (429) joined
  `PROVIDER_ERROR_CODES`. Their message points at the plugin's page in **Settings > Plugins**.
- **Settings.** `GET`, `PUT`, and `DELETE /v1/core/plugins/:id/model-grant`, device-only by the
  existing mount and unmappable from a frame (`scopes.ts`). The Node checks the backend against
  `models.available()` and the model against its catalog, and answers 404 for a plugin without
  `models`. `PluginModelGrantState` is in `@acorn/protocol/modelProviders.ts`. `ModelGrantSection`
  on the plugin's **Overview** tab reads it through the active Node's query cache, key
  `['plugin-model-grant', 'v1', id]`, refetched every 15 seconds. It reuses `ModelBackendPicker`.
- **Reader.** `agents.reviewInput.v1` in `plugins/agents/src/contract/lifecycle.ts`, provided in
  `node/index.ts`, read by `AgentLifecycle.reviewInput`, shaped by `server/sessions/reviewInput.ts`.
  It's in the published capability catalogue, the surface pin, and the plugin-disable snapshot.
- **Advisor.** [`docs/future/pi/packages/advisor/`](../packages/advisor/README.md), version 0.1.0,
  no build step. Install it by folder and restart the Node.

**Decisions and deviations.**

- **The allowance unit is output tokens.** A connection call reserves `maxOutputTokens` and is
  charged what it reports, or the full reservation when it reports nothing. An agent CLI call is
  charged a fixed 4,000, stated in settings as an estimate. Reported usage is kept separately.
- **Released only for pre-generation refusals:** `provider_not_connected`, `provider_needs_auth`,
  `provider_bad_config`, and `provider_secret_unreadable`. A removed backend is one. A timeout, an
  unavailable provider, and a cancellation stay charged, because the provider may have spent.
- **Admission is one synchronous SQLite transaction**, which can't interleave on the Node's single
  writer. The provider call runs after it commits.
- **A grant change applies to the next call.** An admitted call keeps its backend, its reservation,
  and the day it was admitted on, across midnight.
- **Restart.** Boot charges open reservations in full as `interrupted`. In the real-host restart, the
  CLI call was killed first and settled charged as an ambiguous failure. Either way it isn't released.
- **The grant runtime and the reader's shaping load lazily.** The service graph grew 16 KB with them
  static. Lazy loading cut it to 3,130,976 B, and the ceiling rose 8 KB to 3,131,500 B for the tables,
  the boot charge, the three routes, and the reader query.
- **The reader returns `{ available, reason }`, not the old `availability` field.** `not-found`
  covers another task's turn, so a reader learns nothing it may not see. Stop reasons stay in
  `agents.turns`, which the advisor reads. Context parts count against the 16 KiB user-text bound.
  Each part is cut at the head.
- **The advisor's settings page is a hand-written tree** from the scaffold's tree client, so the
  package keeps no build step. It sets the mode and lists the last 20 notes. The grant is drawn by
  the host, not the plugin.
- **Mid-work means `max_tokens` or `max_turn_requests`.** Every other stop reason, including a
  question to the person, is a finished answer, so a concern is recorded and not sent.
- **One verdict per review.** The note cap of four per review in the design isn't needed.
- **The advisor's diff is `git diff HEAD`**, so untracked files are left out.

**Verification.**

- `pnpm lint` passes. `pnpm db:check` passes. `@acorn/arch-tests`: 86 passed, with the surface pin
  regenerated for the one added member. `apps/node` `pnpm build` passes the service budget.
- `grants.test.ts`, 7 cases: no grant, a spoofed owner, no owner, and another plugin's facet all fail
  with no provider call and no row. Five concurrent calls against 1,000 tokens admit three. Missing
  usage, an ambiguous failure, and a CLI's report don't replenish. A removed backend releases. A
  reservation left open at boot is charged, and a call keeps its day across midnight. An
  explicit-backend call runs unchanged and is recorded apart.
- `reload.test.ts` installs a folder package with a real loaded worker, under Node 26.8.1. With no
  grant it gets `provider_not_configured`, and with a spoofed owner `provider_bad_config`, both with no
  provider call. Its granted call is filed under the package. Its abort reaches the provider call and
  the reservation stays charged. A review result with UTF-8 text and provenance arrives intact.
- `lifecycle.test.ts`: the reader returns person and context provenance and the folded final
  message, leaves out a file path and reasoning, answers `not-found` for another task, another
  session, or an unknown turn, and `not-completed` before completion. The byte bounds hold without
  splitting a character.
- The advisor's `node --test`: 9 passed, covering off by default, a repeated event, plugin and
  delegated turns, a malformed answer, a missing grant, a repeat and an escalation, the cooldown and a
  finished-answer concern, the checks after generation, a cancel during generation, and a restart.
- `pnpm test` under Node 26.8.1 failed only where expected. `@acorn/node-core`: 1,596 passed, and
  the 3 failures are `storage/backup.test.ts`, whose 12 tests pass on Node 24.11. The first run also
  caught two node-core fakes that still treated `models` as a one-to-one facet. They were fixed, and
  `permissions.test.ts` gained a case proving the facet is bound to the plugin. `@acorn/client-core`:
  2,454 passed, with the known `scopes.test.ts` (`workspaceProjectOrderRoute`) and `cssHygiene`
  box-shadow failures. `@acorn/plugin-agents`: 1,132 passed. `@acorn/protocol`: 294. `@acorn/node`:
  273. `@acorn/tui`: 676. `acorn-plugin-types`: 5. `@acorn/plugin-workflows`: 568. Every other
  package passed.

Real host, `pnpm dev:agent -- --session pi-phase-04`, Claude Code through ACP, Opus 5.5:

- The trust prompt listed "Generate text with your model providers and installed agent CLIs" and
  "Send notes to your agent sessions", the second marked high (`screenshot-1791331817005.png`).
- The plugin page said **Not set up**. The grant was saved through the UI as Claude Code, Haiku, and
  20,000 tokens. The Node refused `connection:nope` and the model `gpt-9` with a reason, and answered
  404 for `acorn-permission-policy`, which wasn't installed there.
- In a throwaway repository, `add` was changed to `a - b` in the task's working tree, then the agent
  was asked to add `divide`. The advisor sent a blocker quoting the change. The transcript shows a
  turn labelled **From acorn-advisor**, and the agent answered it, establishing that the change came
  before its edit (`screenshot-1791332007259.png`). The plugin turn wasn't reviewed.
- The plugin page showed **4,000 of 20,000 output tokens over 1 call**, with 1,321 reported tokens
  kept apart. **Recent notes** listed the blocker as **Sent to the agent**.
- With the grant removed through the UI, a turn's review failed with `provider_not_configured`, and
  usage stayed at one call. With reviews off, a turn queued no job. A Node restart replayed nothing.
  A restart during a review left its job `interrupted` and its call charged.
- After a restage, the wrapped scope note and the meter show on the plugin page
  (`screenshot-1791332357602.png`). Screenshots are in the session's ignored
  `.acorn/agent-dev/pi-phase-04/screenshots/`.
- The terminal client, `pnpm dev:tui:agent -- --session pi-phase-04-tui --fixture tui-navigation`,
  at the default size and 120 by 40, lists **Settings > Plugins > Installed** and says it opens in the
  desktop app. That's where the grant is set.

**Limitations.**

- **Only agent CLIs were backends.** This machine has no model-provider key, so the connection path's
  reported-usage charge was proven in tests, not on the real host.
- **No terminal transcript run of the note.** The terminal fixture runs its own Node without the
  advisor. The note draws through the same `AgentEventCard` as phase 03's.
- **Node switching and offline weren't exercised.** The session had one Node. The section is hidden
  when the header names a Node other than the active one, as **What it adds** is.
- **Codex wasn't run.** Its account is at its usage limit until 2026-10-10.
- **The trust prompt doesn't mark the generate line high.** That's the existing `models` line, not a
  change in this phase.

**Flagged for separate cleanup.** A write to a loaded plugin's route that carries an `Idempotency-Key`
header answers 500 with a `TypeError`. The same `PUT /v1/p/acorn-advisor/settings` without the
header answers 200. The settings tree's bridge doesn't send the header, so the advisor isn't
affected. It looks like the idempotency middleware's handling of a worker response.

**For phase 05.** The advisor package is 0.1.0 at this phase's commit. Its `turnChanged` skips any
source but `interactive`, and `review.js`'s `decide` is where unattended delivery rules go. The grant
schema is `plugin_model_grants` and `plugin_model_calls` as above, with no schema revision since.
`SessionMessages#sessionRefusal` still answers `unattended-not-supported` for workflow and delegated
sessions.

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
[data layer](../../../data-layer.md), [model grant authoring](../../../plugin-authoring/permissions.md#permissions),
[managed agents](../../../managed-agents.md), [plugin map](../../../plugin-map.md), and provider checks.
Document the review-reader limits, conservative accounting, broad grant limitation, and interactive
scope. Supply the advisor package and grant schema revisions to phase 05.

## Verify before building

Inspect model facade ownership, migration placement, current identity semantics, provider usage
reporting, byte-bound transcript extraction, event subscription delivery, and generation cancellation
through the worker. Check the public declaration generator/export map whenever request types change.
