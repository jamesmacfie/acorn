# Managed-session orchestration

The agents plugin contributes five execute-tier tools that let an agent delegate to another managed
session. They work through `ManagedAgentRuntime`, and don't create workflow runs or change workflow
definitions. [Managed delegation](../managed-agents/delegation.md) covers the ledger and reports.

## Managed-session orchestration

| Tool | Input | Result |
| --- | --- | --- |
| `agent_spawn` | `title`, `prompt`, and optional `profileId` or `agent`, `isolation`, `baseBranch`, `resultSchema`, `configOptions`, and `toolCeiling` | Spawn, task, session, and first-turn IDs, depth, provisioning state, and a cursor |
| `agent_prompt` | `sessionId`, `prompt`, and optional `resultSchema` and `configOptions` | Turn ID, queue state and position, session state, and a cursor |
| `agent_wait` | `sessionId`, `afterSeq`, one of `ready`, `attention`, `turn_completed`, or `stopped`, and `timeoutMs` | Whether it matched or timed out, with state, attention, and the latest sequence |
| `agent_read` | `sessionId`, `afterSeq`, and `limit` | A bounded page of folded assistant messages, diagnostics, errors, and validated structured output |
| `agent_cancel` | `sessionId` and an optional `turnId` | The cancelled turn and the session state |

An agent learns these tools only from their descriptions and the `describe()` text on each field in
`plugins/agents/src/shared/delegationSchemas.ts`, which the MCP schema carries. When a rule here
changes, change that text too.

## Choose the child's harness and model

Settings > Agents > Harnesses and defaults > **Spawned agents** sets defaults
([spawned agents](../managed-agents/defaults.md#spawned-agents)). **Inherit from parent** copies the
parent's harness and its live model and reasoning at spawn time. **Use explicit defaults** picks a
harness and model and effort. An omitted explicit harness means the parent's.

The call can override the harness with `profileId` and the model and effort with `configOptions`. For
example, `{ profileId: 'codex', configOptions: { model: '<model id>', reasoning: 'high' } }` sets all
three. Option IDs belong to the provider. Precedence runs from the call, to the custom agent, to the
spawn defaults. Inheritance copies model and reasoning only, and not across harnesses. A terminal
drawer parent has no live model, so it passes only its harness. The ledger records the resolved
settings, so recovery keeps them. An unsupported value puts a warning in the child's transcript.

`agent` names a [custom agent](../managed-agents/custom-agents.md) by name or ID. The agent picks the
harness, so naming a different `profileId` beside it is refused. Its options override the spawn
defaults, the call's `configOptions` apply on top, and its tool ceiling narrows between the caller's
and the call's.

## Isolation and addressing

`agent_spawn` defaults to shared-task isolation and starts the first turn before it returns. Worktree
isolation creates a selectable child task. `baseBranch` starts it from a local branch's last commit,
and shared isolation rejects it. The caller can prompt, wait for, read, or cancel only a direct child
in the spawn ledger. A missing, foreign, sibling, ancestor, descendant, or cross-task ID returns
`not_found`.

## Gates

These tools set `requiresSession`, so the registry hides them unless authentication supplies a signed
task and session claim. A transport `x-acorn-session-id` header doesn't satisfy that. The MCP proxy
gives each logical call one `x-acorn-tool-call-id` and keeps it across a retry. Spawn, prompt, and
cancel scope that ID to the signed owner and operation, so a retry can't create a second resource.

You must enable the execute tier or the individual tools. The server intersects a child's requested
ceiling with the parent's signed ceiling and stores the result. A workflow-owned session can't see
`agent_spawn`, because descendants aren't charged to workflow budgets. Depth is capped at two, each
root can have 12 live descendants, and the runtime's concurrency limits still apply.

## Results

When a turn declares `resultSchema`, the agents plugin adds the result contract to the prompt and
validates the returned JSON. `agent_read` reports a diagnostic instead of returning malformed output.
Reads page the event sequence, fold assistant deltas, leave out tool and attachment payloads, cap each
text item at 16 KiB, and cap a response at 64 KiB. A wait lasts at most 30 seconds, and a timeout
doesn't cancel the child.

A managed owner doesn't have to stay in its turn to wait. When a child's turn settles, the plugin
queues a `delegation_report` turn on the owner, and withdraws it if the owner reads the result first
([reports back to the owner](../managed-agents/delegation.md#reports-back-to-the-owner)). A paused
child request sends the owner an informational report. A person resolves it in the child session,
because these tools don't approve or answer requests.
