# Agent-driven orchestration

Implementation plan, revised 2026-09-11. Not scheduled.

This file describes the work that remains for an agent running inside an acorn task to delegate work
to other acorn-managed agents. The calling agent must be able to start a child, send another prompt,
wait for progress, read a bounded result, and stop the child. The owner must be able to watch the same
sessions in the app.

The reference behavior is herdr's small conversational vocabulary. The goal is the interaction model,
not its process model or command-line interface.

## Completion criteria

The work is complete when all of these statements hold:

- A task-scoped agent can start a managed child session without calling a device-only route.
- Shared delegation uses the caller's task and checkout. Worktree delegation creates a child task
  through `CoreServices.tasks.createChild()`.
- Only the session that created a child can prompt, wait for, read, or cancel that child.
- A delegated child can delegate again within fixed depth and live-child limits.
- The Node derives caller identity from the signed internal token. A request header or tool argument
  cannot claim another session.
- Spawn and prompt operations are idempotent across the MCP proxy's one automatic transport retry.
- Tool permissions and every server-owned tool ceiling can narrow delegation. A child cannot widen the
  permissions that reached its parent.
- Shared children appear under their parent in the Agent pane. Worktree children remain visible as
  child tasks and lead to their own Agent pane.
- Restarting the Node preserves ownership, queued turns, readable output, and recoverable provisioning
  state.

## Architecture to build on

Do not rebuild the execution engine. The following behavior has shipped and belongs to its owning
document:

- [Agent tools](../agent-tools.md) owns the Node registry, Zod schemas, risk tiers, permission
  preferences, task-scoped MCP projection, and `ToolContext`.
- [Managed agents](../managed-agents.md) owns session and turn persistence, the event ledger, provider
  drivers, queueing, concurrency, attention, cancellation, and the Agent pane.
- [Workflows](../workflows.md) owns declared graphs, frozen run definitions, workflow budgets, gates,
  step isolation, the editor, and the run pane.
- [Authentication](../authentication.md) owns task-scoped internal tokens and the distinction between a
  device principal and a child process.
- [Workspaces and tasks](../workspaces-and-tasks.md) owns child tasks, branches, and lazy worktree
  creation.

The useful code seams are:

| Concern | Owning code | Behavior to reuse |
| --- | --- | --- |
| Tool registration | `packages/node-core/src/server/agentTools/registry.ts` | `AgentToolContribution`, execute-tier permissions, availability, and `ToolContext`. |
| MCP transport | `packages/node-core/src/mcp/server.ts` and `mcp/api.ts` | Live tool manifests and the task-confined loopback call. |
| Signed caller | `packages/node-core/src/server/auth/internalTokens.ts` | The token already carries `taskId` and an optional `sessionId`. |
| Managed execution | `plugins/agents/src/server/sessions/runtime.ts` | Session creation, durable turns, wait, cancellation, and restart reconciliation. |
| Session storage | `plugins/agents/src/node/schema.ts` and `server/sessions/store.ts` | Session lineage, event paging, idempotent operations, and turn idempotency. |
| Worktree child | `packages/node-core/src/server/core/tasks.ts` | `createChild()` and lazy checkout resolution. |
| Task lineage | `packages/protocol/src/api.ts` | `Task.parentId` is stored and sent to clients. |

`agent_sessions.parent_session_id` and `parent_turn_id` are useful display lineage, but they are not a
complete authority model. A calling session can be a terminal session rather than a managed agent
session, and a worktree child belongs to another task. Delegation therefore needs a durable relation
of its own.

## What remains

No registered tool starts or controls a managed session. The managed HTTP routes expose the required
operations, but task authorization deliberately prevents a parent task from addressing a child task.
`ToolContext.sessionId` also comes from `x-acorn-session-id`, although the verified internal principal
already contains the signed session claim. That header is suitable for transport metadata, not for an
authorization decision.

The task rail receives `Task.parentId` but still renders a flat list. The Agent pane receives session
lineage fields but does not read them. Provider-native subagents are transcript projections and cannot
be addressed through the managed-session runtime, so they do not satisfy this plan.

## Ownership and boundaries

The Agents plugin owns agent-driven orchestration. Register the tools from that plugin and close their
handlers over `ManagedAgentRuntime` and the plugin database. Do not add session operations to core, and
do not make one plugin call another plugin's HTTP routes.

Keep `AgentToolContribution.scope` equal to `task`. Cross-task access is a narrow exception implemented
inside the Agents handlers after they verify a spawn row. Do not weaken `mayActOnTask()`, add a
cross-task MCP scope, or mint a service token into a child process.

Keep workflows declarative. An agent-driven tree is a group of managed sessions, not a workflow with
steps appended after start. `WorkflowRunner` must continue to freeze `defJson` and expand its graph at
start. Dynamic workflow steps would split validation, restart, editing, and trust behavior into two
execution modes.

Managed sessions already appear in the merged run list, retain turns and events across restarts, and
use the provider and workspace concurrency limits. Those are the durability properties this feature
needs.

## Caller identity

An orchestration tool requires both `taskId` and `sessionId` from the verified internal principal.
Terminal and managed-agent processes already receive an internal token minted with both claims.

Change the agent-tool route so `ToolContext.sessionId` comes from `c.get('principal').sessionId`.
Ignore `x-acorn-session-id` for authorization. Keep the header only where compatibility requires it
for non-authoritative attribution, then remove it when all callers read the signed claim.

A task token without a session claim may use ordinary task tools but must not see orchestration tools
in `tools/list`. A mismatched or missing owner must return `not_found`, so callers cannot probe session
or task ids.

Make the tool ceiling server-owned in the same phase. Add the effective ceiling to the signed internal
claims, expose it on the verified principal and `ToolContext`, and enforce that value in the agent-tool
route. A workflow headless process passes its step ceiling when it asks the composition root to mint
the token. A managed session reads the ceiling from its persisted config when the runtime mints its
token. An ordinary terminal has no additional ceiling. Keep `ACORN_TOOL_CEILING` only as transitional
transport metadata, and do not use it for enforcement after the signed claim is available.

The MCP proxy also needs a call id that survives its retry of a failed loopback request. Generate the
id once per `tools/call`, send it as transport metadata, and add it to `ToolContext`. Scope every stored
idempotency key by the signed owner session and the tool name.

## Spawn ledger

Add `agent_spawns` to the Agents plugin database. It is the authority relation and the recovery record,
not a second copy of session runtime state.

| Column | Purpose |
| --- | --- |
| `id` | Stable spawn id, allocated before any child resource. |
| `root_task_id` | Task of the first caller in the delegation tree. |
| `root_session_id` | Signed session id of the first caller. |
| `owner_task_id` | Task from the caller's signed token. |
| `owner_session_id` | Session from the caller's signed token. |
| `parent_spawn_id` | Spawn row whose child made this call, or null for a root spawn. |
| `child_task_id` | Owner task for shared isolation, or the created child task for worktree isolation. |
| `child_session_id` | Managed session created for the child. Null only while provisioning. |
| `child_turn_id` | Initial turn created by `agent_spawn`. Null only while provisioning. |
| `depth` | One for a root spawn, then parent depth plus one. |
| `isolation` | `shared` or `worktree`. |
| `provisioning_state` | `creating`, `provisioned`, or `failed`. Do not mirror the child session's runtime state. |
| `idempotency_key` | The owner-scoped MCP call id. |
| `error` | Bounded provisioning failure detail. |
| `created_at`, `updated_at` | Recovery and retention timestamps. |

Index `owner_session_id`, `child_session_id`, and
`(root_task_id, root_session_id, provisioning_state)`. Make
`(owner_task_id, owner_session_id, idempotency_key)` unique.

Use the row as follows:

1. Resolve the caller from the signed principal.
2. Find whether the caller session is itself the child of a spawn. If it is, inherit the root and set
   the new depth from that row. Otherwise, create a depth-one root.
3. Enforce limits and insert the `creating` row before starting external work.
4. Create the child task when isolation is `worktree`.
5. Create the managed session and its first turn with idempotency keys derived from the spawn id.
6. Write the child ids and mark provisioning `provisioned`.
7. On failure, keep the row, record the error, and return the same result for the same call id.

The child session is the authority for turn and runtime status after provisioning. Join to it when
counting live children. Do not copy `ready`, `working`, `waiting`, or terminal states into the spawn
row.

When the caller is a managed session, also set the child's `parentSessionId` and active
`parentTurnId`. For a terminal caller, leave those fields null and use the spawn row for ownership and
display metadata.

## Tool surface

Register five execute-tier tools from `plugins/agents`. Execute tools are disabled by default through
the shared permission policy.

| Tool | Input | Result |
| --- | --- | --- |
| `agent_spawn` | `title`, `prompt`, `profileId?`, `isolation?`, `resultSchema?`, `configOptions?` | Spawn, task, session, and initial turn ids; depth; provisioning state; and the first event cursor. |
| `agent_prompt` | `sessionId`, `prompt`, `resultSchema?`, `configOptions?` | The durable turn id, queue state, and event cursor. |
| `agent_wait` | `sessionId`, `afterSeq?`, `until?`, `timeoutMs?` | Runtime state, attention, last sequence, whether the condition matched, and whether the call timed out. |
| `agent_read` | `sessionId`, `afterSeq?`, `limit?` | Bounded assistant messages, diagnostics, errors, validated structured output, and the next cursor. |
| `agent_cancel` | `sessionId`, `turnId?` | The cancelled turn id and resulting session state. |

`agent_spawn` starts the first turn and returns without waiting for it. Keep prompt, wait, and read as
separate operations. This makes every blocking call explicit and keeps tool responses under the MCP
client timeout.

Cap `timeoutMs` at 30 seconds, matching `ManagedAgentRuntime.wait()`. Return a normal timed-out result
with the latest cursor. The calling agent may wait again.

Default isolation to `shared`. If `profileId` is absent, inherit the calling managed session's profile
or the calling terminal's profile when it has a managed driver. Otherwise, require a supported managed
profile. Do not silently fall back from one provider to another.

If a prompt declares `resultSchema`, append the result contract through one Agents-owned helper. Move
the extraction logic out of workflow-only `sessionExecute.ts`, validate the parsed value against the
declared schema, and use the same helper for workflows and delegation. Parsing JSON without validating
the schema is not sufficient.

`agent_read` must not return an unbounded snapshot. Page from `agent_events`, fold streaming assistant
deltas, include terminal turn failures, and omit verbose tool payloads and attachment bytes. The event
sequence is the cursor shared by read and wait.

Do not add `agent_send_keys`. Managed sessions accept turns, while terminal keystrokes remain owned by
the Terminal plugin.

## Authorization rules

For `agent_prompt`, `agent_wait`, `agent_read`, and `agent_cancel`, require a spawn row whose
`owner_task_id` and `owner_session_id` match the signed caller and whose `child_session_id` matches the
argument. Direct ownership is intentional. A root orchestrator controls the children it created, not
every descendant or sibling in the tree.

For `agent_spawn`, enforce these starting limits in one database transaction:

- Maximum delegation depth: two.
- Maximum live delegated sessions per root: 12.
- One active turn per child session, which the managed runtime already enforces.
- Workspace and provider concurrency limits, which the managed dispatcher already enforces.

The live limit bounds parallel expansion, not lifetime history. Keep settled spawn rows for audit and
ownership until the child session is deleted. Add retention only with the session-retention policy that
owns the child.

Count every `creating` row against the live limit. Once a child session exists, count it until its
runtime state is terminal. Reserving the slot in the same transaction as the depth check prevents two
parallel calls from both observing the last free slot.

The child inherits the parent's signed tool ceiling, and a requested child ceiling may only narrow it.
Persist the intersection in the child session config so the runtime can mint the child's token from
server-owned state. Do not accept a wider ceiling from an environment variable, request header, or
tool argument.

Do not expose `agent_spawn` to a managed session whose config names a `workflowRunId` until workflow
usage accounting includes delegated descendants. Without that integration, a workflow step could
spend outside the run's token, cost, turn, and wall-time budgets. This restriction preserves the
workflow budget contract while the agent-driven path ships independently.

Agent-driven trees do not create `workflow_runs` or `workflow_steps`. If aggregate token or cost budgets
become a requirement for ordinary delegation, add a root policy to the Agents-owned spawn ledger and
sum the persisted turn usage. Do not make `WorkflowRunner` accept a mutable graph for that purpose.

## Worktree isolation

Implement shared isolation first. Worktree isolation crosses the Agents plugin database and core's
task database, so it needs recoverable provisioning rather than an optimistic sequence of inserts.

Allocate the spawn id and intended child task id before calling core. Extend the trusted
`CoreServices.tasks.createChild()` seam to accept that stable id or an idempotency key. A replay must
return the same child when its parent and seed match, and refuse a conflicting use of the id. This lets
startup reconciliation distinguish these states:

- No child task exists. Retry child creation.
- The child task exists but no managed session exists. Create the session and initial turn.
- The session exists but the spawn row lacks its ids. Repair the row from the spawn-derived
  idempotency records.
- Provisioning failed permanently. Keep the child task and surface the failure. Do not delete a
  checkout that might contain work.

Use `createChild()` so branch deduplication, `parentId`, task notifications, and lazy worktree setup
remain core behavior. The managed runtime resolves the child's checkout when the child session starts.

Cancelling a worktree child stops its active turn. It does not archive the child task or remove its
worktree.

## Visibility

Shared children are managed sessions on the same task, so the Agent pane already receives their live
rows and events. Update its roster model to use delegated lineage:

- Nest a delegated managed session under its managed parent.
- Label a child owned by a terminal session as delegated without inventing a managed parent row.
- Show depth, runtime state, attention, and isolation from bounded projection data.
- Keep provider-native subagents under their provider session. They remain a different, non-addressable
  type.

For worktree isolation, render task lineage from core's `Task.parentId`. A child task must remain a
normal selectable task with its own panes. Grouping or indentation belongs in the core task-list
fallback because `parentId` is core data. The `core:task` annotation point may add workflow or agent
status markers, but it must not become the source of task hierarchy.

Do not add an agent-driven run to the Workflows pane. Declared workflow runs stay there. Managed
sessions and their delegation tree stay in the Agent pane and the merged Runs list.

## Failure behavior

- A missing, foreign, sibling, or deleted child id returns `not_found`.
- A child waiting for permission or an answer returns `attention` from `agent_wait`. The owner resolves
  the request through the Agent pane. The orchestrator cannot approve its own child.
- A prompt sent while the session cannot accept another turn returns a classified conflict.
- Provider startup failure leaves the session and spawn row readable.
- A wait timeout does not cancel the turn.
- Cancelling a turn preserves its events and structured-result diagnostics.
- Restart reconciliation repairs `creating` spawn rows before accepting another call with the same
  idempotency key.

## Implementation sequence

### Phase 1: Trusted caller context

- Source `ToolContext.sessionId` from the verified principal.
- Add a per-call id that survives the MCP proxy's loopback retry.
- Make orchestration tools unavailable without a signed session claim.
- Carry a server-owned effective tool ceiling in the tool context.
- Test a forged `x-acorn-session-id`, a missing session claim, another task, and a narrowed ceiling.

### Phase 2: Shared spawn and ownership

- Add the `agent_spawns` migration and store operations.
- Add an Agents-owned delegation service over `ManagedAgentRuntime`.
- Add the `delegated` session kind and `delegation` turn source to protocol and schemas.
- Implement idempotent `agent_spawn` with `isolation = "shared"`.
- Implement bounded `agent_read`.
- Enforce direct ownership, depth two, and 12 live descendants per root under concurrent calls.

At the end of this phase, one agent can delegate read-and-report work and collect the result.

### Phase 3: Conversation and control

- Implement `agent_prompt`, `agent_wait`, and `agent_cancel`.
- Share result-contract extraction and validation between workflow execution and delegation.
- Return stable cursors and classified timeout, attention, conflict, and terminal states.
- Test restart, transport retry, duplicate calls, pagination, cancellation, and malformed structured
  output.

### Phase 4: Session visibility

- Project spawn metadata with the Agent pane's session list.
- Nest managed children and label terminal-owned children.
- Add navigation from a child to its parent when the parent is managed.
- Keep provider-native subagent rendering unchanged.

### Phase 5: Worktree children

- Make `createChild()` replayable with a stable child id or idempotency key.
- Add recoverable worktree provisioning and startup reconciliation.
- Implement `isolation = "worktree"`.
- Render `Task.parentId` in the core task list and keep each child selectable.
- Test branch collisions, restart at each provisioning boundary, cancellation, and preservation of a
  dirty child worktree.

### Phase 6: Documentation and acceptance

- Update `docs/agent-tools.md`, `docs/managed-agents.md`, `docs/authentication.md`,
  `docs/workspaces-and-tasks.md`, `docs/api-reference.md`, `docs/mcp.md`, and `docs/security.md`.
- Keep `docs/workflows.md` explicit that these tools drive managed sessions, not workflow runs.
- Run the manual acceptance flow with Claude Code and Codex, from both a managed parent and a terminal
  parent.
- Delete this file or reduce it to unresolved work after the shipped behavior moves to the owning
  documents.

## Test matrix

Automated coverage must include:

- Shared spawn, prompt, wait, read, and cancel for both managed providers.
- A terminal caller and a managed-session caller.
- Direct-child access and denial for a sibling, grandchild, unrelated session, and another task.
- Atomic depth and live-count enforcement under parallel spawn calls.
- Execute-tier disabled, per-tool disabled, and inherited tool ceiling narrowed.
- MCP loopback retry without duplicate task, session, or turn creation.
- Node restart during spawn provisioning and during an active or queued turn.
- Read pagination, response bounds, assistant-delta folding, and structured-schema failure.
- Attention returned without allowing the parent agent to resolve the child's request.
- Worktree branch collision, lazy checkout creation, task nesting, and dirty-worktree preservation.
- Agent-pane nesting without changing provider-native subagent rows.

Before handoff, run `pnpm lint`, the Agents plugin tests, the node-core MCP and agent-tool route tests,
the core task-service tests, and the client tests for the Agent pane and task rail.

## Verify before building

The named paths are architecture hints, not promises. Before implementation:

1. Re-read the owning documents listed under [Architecture to build on](#architecture-to-build-on).
2. Confirm that internal tokens still carry a session claim and that tool context still has no trusted
   call id or effective ceiling.
3. Confirm the managed runtime's create, enqueue, wait, cancel, event-page, and reconciliation
   contracts.
4. Confirm that no agent orchestration tools or equivalent spawn ledger have landed.
5. Confirm how the Agent pane and task-list fallback consume session and task lineage.
6. Revisit the limits only if the managed runtime's concurrency or retention policy has changed.
