# Phase 02: permission veto and policy plugin

Status: proposed, 2026-10-03. Entry: phase 01 disposition recorded. Next:
[phase 03](./03-session-messages.md).

## Outcome

A loaded policy plugin refuses a harness permission request before Acorn shows it as pending.
Both clients show a resolved request naming the blocking plugin and reason. The plugin tightens
approval without acquiring the power to approve. Source design:
[Mods permission hook](../../mods.md#the-design-agentsbefore-permission), with
[Pi additions](../02-before-permission.md).

## Ownership and data flow

Harness parks permission request → ACP/Codex normalizer extracts driver-only subject → agents
runtime runs owner-declared hook → driver rejects once → materializer emits safe wire event →
agents store writes an already-resolved request → lifecycle and client query projection → shared card.

Read the normalizers and drivers, `plugins/agents/src/server/drivers/types.ts`,
`plugins/agents/src/server/sessions/runtimeEngine.ts`, `providerEventMaterializer.ts`,
`sessionRepository.ts`, and `lifecycle.ts`. Read the card at
`plugins/agents/src/client/sessions/AgentRequestCard.tsx`, core's hook registry, and the loaded route
carrier. Raw subject extraction belongs to the driver; policy and session state belong to agents.

## Implementation

1. Add a driver-only permission subject with kind, command, and paths. Use the Mods mapping and
   bound provider-owned values. Name the hook-facing subject fields as one public type in agents'
   contract, with `toolCallId` (`''` when unknown), because
   [phase 10](./10-harness-bridges.md)'s `agents:before-tool` reuses it. Unknown fields become empty values; do not reconstruct commands from
   display titles. Strip the subject before wire serialization, SQLite, and telemetry.
2. Declare `agents:before-permission` beside `before-send`. Retain the Mods fields and add
   `requestId`, the canonical provider request ID scoped to the session. It enables the phase 03
   consumer's idempotency key. Use `observe` and `veto`, install order, a 5,000 ms per-handler timeout,
   and `onTimeout: 'allow'`. Trust copy must distinguish observing commands from stopping them.
3. Intercept permission events before the provider event queue. Capture the live session generation
   and originating turn before awaiting hooks. Recheck ownership and cancellation before answering
   or recording. Verify a request arriving during driver startup can reach its parked resolver;
   do not assume `live.handle` is already assigned.
4. On veto, choose the first `reject_once` option. Use driver cancellation only when that option is
   absent. Never choose lasting rejection or approval. Coordinate driver reply and durable record
   so synchronous provider completion cannot race the request into a false pending state. Preserve
   the original turn ID even if the turn completes while the hook waits.
5. Add optional `blocked: { by, reason }` to the normalized request event and its persisted resolved
   projection. Host-stamp identity and bound reason text. Inspect resolution failures: a failed
   driver reply must produce an honest interrupted/expired outcome, not a claim of successful veto.
   No blocked row may transiently become pending, notify, or wake a delegated parent.
   Add an optional bounded blocked summary to `agents.requests` for committed resolved rows,
   containing blocking plugin ID, reason, and canonical provider request ID. Keep raw resolution
   private. The resolved `request-changed` event plus this read lets a consumer verify that its veto
   took effect before sending an explanation; a handler returning a verdict is not that proof.
6. Render the resolved refusal in the shared card on both hosts. Keep older ordinary resolved rows
   readable and avoid cache-key churn. Check that newly introduced metadata is preserved by event
   bounding and storage mapping.
7. Build the standalone loaded policy plugin. Refuse recognized force-push commands and recognized
   destructive commands outside `root`. State its supported command forms. Exercise the manifest
   route carrier and trust prompt, rather than proving only a compiled `ctx.hooks.handle` function.
   Leave explanation delivery for phase 03.

The rules are examples, not shell containment. No rule language, command rewriting, stream hook,
auto-allow mode, or generic middleware enters this phase.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove:

- Missing subject fields, ACP kinds, Codex commands, edits, and permissions map without invented data.
- Veto selects reject-once; absence of that option follows the documented cancellation behavior.
- Timeout or handler failure reaches human approval and never approves the command.
- Parallel provider traffic continues during a slow hook; stale callbacks cannot affect a replacement
  live generation or attribute the request to a later turn.
- A blocked request never publishes pending attention or wakes its delegated parent.
- Driver failure, Node stop, and old persisted rows retain honest state.
- A real loaded policy package blocks and displays a request on Claude and Codex, plus DeepSeek and
  `omp` when available. Unsupported raw input is recorded as a policy coverage limitation.

## Documentation and handoff

Update the hook table in [node extension points](../../../plugins/node-side-extension-points.md),
[managed agents](../../../managed-agents.md), [security](../../../security.md), and
[provider checks](../../../testing/agents-and-providers.md). Explain that timeout means human review,
and that already-allowed tools and bypass modes do not reach this hook. Retain the comparison in
Mods and link its delivered contract to the owning docs. Supply the policy package to phase 03.

## Verify before building

Recheck parked-request ordering in both drivers, event bounding, resolved-row lifecycle publication,
loaded hook routing, host reason limits, and DeepSeek's actual shell input. Inspect existing approval
metadata before adding the subject so the change preserves all shipped approval forms.
