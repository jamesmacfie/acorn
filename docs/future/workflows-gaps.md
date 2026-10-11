# Workflow followup work

Date: October 8, 2026. Status: proposed gaps to confirm before implementation.

Use this page to scope a Workflows followup. [Workflows](../workflows.md) owns implemented behavior.
The Node continues execution while a client is closed. Desktop, terminal, and CLI already provide
interaction paths; do not treat desktop presence as an execution prerequisite.

## Navigate large definitions

The graph lacks groups, a minimap, and edge labels. Start with the Workflows editor and the shared
graph contract. Choose a concrete navigation problem before adding all three features.
Preserve the terminal's ordered graph projection and keyboard navigation.

Acceptance: use a definition larger than the viewport to find a dependency, inspect a branch,
and return to a selected step. Verify focus, zoom/pan persistence, and narrow host behavior.
Do not change persisted workflow semantics merely to label a graph.

## Inspect the prompt given to a step

The run pane shows step output. The stored run also holds the prompt; expose it through its existing
owner if the running checkout still lacks a readable prompt view. Keep it read-only and distinct
from a retry prompt override. Respect the same task authorization and export privacy rules as run detail.

Acceptance: inspect the resolved prompt from a completed, failed, and retried step without changing
its run. Verify large text, unavailable historical values, and client Node switches.

## Design retries for uncertain outcomes

Manual retry is implemented. Automatic retry after an unknown external outcome requires an operation
identity and evidence that repeating the action is safe. Inspect contributed step contracts and their
persisted outcome before proposing a retry policy.

Record which operations are idempotent, which can be reconciled, and which require a person's decision.
Keep uncertain writes blocked rather than assuming a lost response means the action failed.

Acceptance: simulate a write that succeeds before its response is lost, restart the Node, and recover
without duplicating the external action. A manual retry must retain its authorization and audit context.

## Add dedicated agent control tools

Implemented October 10, 2026 as the [workflow tools](../agent-tools/workflow-tools.md). Publication,
human gates, and retries stay device actions. `agent_*` tools continue to control managed sessions.

Open acceptance: run the tools from managed Claude and Codex sessions on both hosts through the
isolated agent drivers. Terminal sessions can read definitions but can't draft, start, read, or
cancel runs. That stays deferred.

## Define file-owned trigger consent

Published database workflows can have owner-approved Node schedules. Repository and user definition
files do not activate triggers implicitly. Adding that behavior needs a separate approval contract
for file identity, changed content, revocation, and offline/restart handling.

Acceptance: an unapproved file cannot schedule work. An approved unchanged definition runs under
its stored budget and scope; a content or identity change requires the designed reapproval behavior.
Preserve the implemented schedule owner and runtime rather than adding a second scheduler.

## Verify and hand off

For a selected followup, trace the definition, Node runner, run store, API, client query, and UI.
Record contract changes and migrations before implementation. Add tests for the observable failure,
then run lint, owner and consumer suites, and architecture checks. Verify affected desktop and
terminal interactions through isolated sessions and update the owning reference docs.

## Verify before building

- Confirm the gap in the Workflows editor, Node entrypoint, run routes, and stored definition/run contracts.
- Read start, retry, human-gate, and schedule authority before exposing another control path.
- Keep uncertainty visible in both persisted outcomes and user-facing operation results.
