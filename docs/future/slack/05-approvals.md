# Phase 5: approvals in Slack

Date: November 19, 2026. Status: proposed. Depends on phase 4.

## Goal

When an agent in a session Slack started asks permission, a card in its thread shows what it wants
to do. An owner who ticked **Answer approvals from Slack** answers with **Approve** or **Deny**.
Otherwise the card links to Acorn.

## Starting point

- `agents.requests` lists a task's requests with their title, detail, and payload, read-only
  ([permission policy](../../managed-agents/permission-policy.md)).
- Clients answer through `POST /sessions/:sessionId/requests/:requestId/resolve` in
  `plugins/agents/src/server/routes/managed.ts`, which calls the session runtime's `resolveRequest`
  with an idempotency key.
- A request's kind is `permission`, `question`, `elicitation`, or `workflow_gate`.

## In scope

- `agents.requestAnswer`, a compiled-only capability.
- The approval card, its buttons, and what a click does.
- The security pages this changes.

## Out of scope

Answering questions and elicitations from Slack. "Always allow". Requests from sessions the plugin
didn't start, such as a delegated child's.

## Steps

1. Provide `agents.requestAnswer` from the agents plugin:
   `answer({ taskId, sessionId, requestId, decision, idempotencyKey })`, where `decision` is `allow` or
   `deny`. It maps `allow` to the request's allow-once option and `deny` to its reject-once option,
   and calls the same `resolveRequest` the route does. It answers `{ ok: false, reason }` when any of
   these is true:
   - The session isn't in the task.
   - The caller plugin didn't start the session.
   - The request isn't pending.
   - The request has no once-only option.

   It writes an audit row naming the plugin. It isn't in the loaded grant list.
2. On a `request-changed` event for a pending `permission` request in a Slack session, read it with
   `agents.requests` and post a card in the thread. The card holds the title and the command or
   detail, with known key values removed, in a code block. With approvals on, add **Approve** and
   **Deny**, keyed by the request. Without, add **Answer in Acorn** with the task's address. Show ✋.
3. For any other request kind, post "James, the agent has a question for you in Acorn" with the
   address, and show ✋.
4. On a click, check that the clicker is the owner's Slack user, that approvals are on, and that the
   request is still pending. Then call `answer` with the Slack action's ID as the idempotency key, and
   replace the card with "Approved by James, 3:14 PM", without buttons.
5. When a click fails a check, act by which check failed:
   - Someone other than the owner clicked: they get an ephemeral "Only James can answer this."
   - The request was answered in Acorn first: the card reads "Answered in Acorn".
   - The request expired: the card reads "Expired".
6. In [control plane security](../../security/control-plane.md#the-account-service), add that a breach
   of the hosted service can send prompts to a Node that linked Slack, and approve requests on one
   whose owner turned on approvals from Slack. In
   [remote access § Rules no phase may break](../remote-access/README.md#rules-no-phase-may-break),
   note that exception.

## Verify before building

- What a resolution looks like for each harness's permission request, and whether every harness offers
  an allow-once and a reject-once option.
- Whether a harness that times out a request reports `expired` through `request-changed`, so the card
  can update.

## Tests

- `answer`: each refusal, a repeated idempotency key, and the audit row.
- The card with approvals on and off, with a key value in the command.
- Clicks: the owner, someone else, after an answer in Acorn, after expiry, and two quick clicks.

## Checkpoint

In `pnpm dev:agent` with the stand-in, run a Slack turn that asks to run a command. Approve it from a
stand-in click as the owner, then try as a guest. Turn approvals off and check the card links to
Acorn. Record the date and the result here.
