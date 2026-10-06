# Phase 03: attributed session messages

Status: proposed, 2026-10-03. Entry: phase 02 accepted with its loaded policy consumer. Next:
[phase 04](./04-model-grants-and-advisor.md).

## Outcome

A loaded plugin queues an attributed note on an interactive Acorn-controlled session. The policy
consumer optionally explains a veto in one later turn. This phase ships a usable consumer with the
messaging seam. Sources: [session messages](../03-session-messages.md) and
[veto explanations](../02-before-permission.md#addition-1-tell-the-model-why).

## Ownership and data flow

Host-qualified extension entry → agents-bound sender → task/session validation → durable admission
and idempotency → `enqueueTurn` and `before-send` → provider input → transcript and lifecycle →
selected-Node cache and shared compact plugin row.

Read `plugins/agents/src/server/sessions/runtime.ts`, the turn repository, delegation reports,
`plugins/agents/src/contract/wire.ts`, and core's extension registry. That registry supplies
`pluginId`; a caller must not provide its own identity or namespace. Callback methods cross the
loaded-worker RPC membrane, including a returned sender's asynchronous `queue` method.

## Implementation

1. Put the typed `agents:session-messenger` point, message, sender, and result in the agents public
   contract. Open the point in agents activation. Reconcile entries at the owner lifecycle seam,
   including late registration and disposal, and bind each sender to the host's entry identity.
   Do not cache the set at initial activation or expose a caller-named sender capability.
2. Validate task/session association before disclosing state. Keep the proposal's coarse refusal
   reasons and add an explicit `unattended-not-supported` result for this phase. Permit only
   interactive, unarchived sessions controlled by Acorn; a terminal-controlled session is refused.
3. Add the `plugin` turn source and host-owned `sentBy` metadata. Keep the visible subject bounded
   and single-line, including control-character validation. Put the plugin's text in an 8 KiB
   context part fenced as untrusted content. Prefix identity from the host and mark the note as
   advice. Do not let a transform of visible text erase stored sender provenance.
4. Enforce 20 accepted plugin messages per plugin per session, with a host-qualified idempotency key.
   Check duplicate keys before cap and hook side effects. Serialize or transact admission so two
   concurrent calls cannot both consume the last slot. Persist the accepted turn and count together
   without holding a SQLite transaction across an asynchronous hook. Retries after restart return
   the original turn. A new key over cap raises at most one durable attention item per scope.
5. Route admission through `enqueueTurn`, preserving file/policy validation, `before-send`, queue
   ordering, and the Node's pump. An idle session starts a turn; a busy one queues it. Map expected
   refusals to results and retain unexpected infrastructure failures as errors. Revoke old senders
   when the contribution or owner runtime retires.
6. Add fixed high-grant disclosure for the named point and draw the plugin row on both hosts.
   Trace any new metadata through storage, HTTP snapshots, broker events, query mapping, export,
   transcript search, and the terminal projection. Preserve saved older turn sources.
7. Extend the policy consumer with a separate messenger contribution and an off-by-default
   explanation switch. Use session ID plus phase 02's request ID as the idempotency key. A refusal
   is explained only after a resolved `request-changed` event and the `agents.requests` blocked
   summary confirm that this plugin's veto took effect. Declare the event and read grants; re-read
   committed blocked rows on startup so a missed notification does not lose an explanation.
   Store delivery work durably and deduplicate it by provider request ID. Never send from inside the
   veto route: a timeout may ignore its late verdict, and another handler may supply the actual veto.
   Queue failure must not undo a veto.
   Refusals in unattended sessions remain effective but have no automatic explanation until phase 05.
   This explanation turn is the fallback for harnesses without a bridge. Where
   [phase 10](./10-harness-bridges.md) installs one, a bridge veto carries its reason to the model
   inside the turn.

Do not make the hook queue notes, grant messaging implicitly with veto, steer a running turn,
cancel/restart to simulate steering, or add held-message delivery. Keep those refusals visible.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Through a real loaded worker,
prove host identity cannot be spoofed, foreign-task lookups are coarse, revoked senders fail, and
returned callbacks preserve asynchronous transport. Cover idle and busy delivery, a vetoed prompt,
Unicode byte bounds, restart duplicates, concurrent cap admission, and one attention item.
Prove an ignored late veto or a veto from another plugin cannot send a false refusal explanation.

Drive the policy consumer in real Claude and Codex sessions. One denied permission produces a
resolved request and one separately attributed explanation turn. Check desktop/terminal display,
Node switching, cancellation, archived sessions, and terminal ownership. An unattended attempt must
return `unattended-not-supported`, not silently spend an unowned turn.

## Documentation and handoff

Update [managed agents](../../../managed-agents.md),
[node extension points](../../../plugins/node-side-extension-points.md),
[plugin authoring](../../../plugin-authoring.md), [security](../../../security.md), and provider checks.
Document limits, idempotency scope, sender revocation, and interactive-only support. Give phase 04
the public contract and policy package revision. Record the exact backing module for atomic admission.

## Verify before building

Recheck `enqueueTurn` and duplicate-turn storage, extension registration lifecycle, generic
worker callback marshalling, unknown-source rendering, and trust projection for a node-side point.
Do not reuse the retired Findings implementation without checking it against the worker carrier.
