# Multi-plugin collaboration example

**Status:** Normative example<br>
**Requirement prefix:** `EX-COLLAB`

This example specifies an owner command that turns a Linear issue into a task/worktree, starts a
Claude agent, and later links the resulting GitHub pull request. It demonstrates synchronous
capabilities, durable events, delegation, idempotency, and compensation without imports, shared SQL,
or cross-plugin transactions.

## Participants

| Participant | Responsibility |
| --- | --- |
| Core Node | Workspace/task/worktree resources, command receipts, capability broker, event outbox |
| `acorn/linear` | Resolve issue, produce normalized issue snapshot, own Linear task link |
| `acorn/terminal` | System profile/session launch over core process/PTY primitives |
| `acorn/agents` | Create managed session, queue first turn, own attention and artifacts |
| `acorn/profile-claude` | Declare Claude executable/headless/stream behavior |
| `acorn/github` | Detect/publish PR projection and own GitHub task link |
| Orchestrator | Declarative/WASI plugin owning the saga state in its isolated database |

## Declared dependencies

The orchestrator manifest declares compatible versions of:

- `acorn.linear.issue.resolve.v1`;
- `core.task.create.v1` and `core.worktree.create.v1`;
- `acorn.agents.session.create.v1` and `turn.enqueue.v1`;
- optional `acorn.github.task-link.v1`;
- `acorn.agents.session-state-changed.v1`; and
- `acorn.github.pull-detected.v1`.

It requests authority to create a task/worktree in selected workspaces, create/prompt an agent in
the resulting task, read the selected Linear issue, and create the two task links. It receives no
provider credential, terminal input, generic process, filesystem, or GitHub mutation authority.

`EX-COLLAB-001` Installation MUST fail if a required capability has no compatible provider.
Absence of optional GitHub linking leaves the core Linear-to-agent behavior available.

## Command

`example.issue-to-agent.start.v1` input is:

| Field | Constraint |
| --- | --- |
| `workspace` | canonical workspace URI on the command’s Node |
| `linearIssue` | canonical Linear issue URI on the same Node |
| `repository` | repository URI belonging to the workspace |
| `profile` | compatible agent profile coordinate |
| `branchHint` | optional 1–120 safe branch characters |
| `promptTemplate` | signed template ID, not arbitrary executable text |
| `idempotencyKey` | 16–128 opaque characters |
| `expectedWorkspaceVersion` | current resource revision |

The command deadline is five minutes for orchestration. Agent execution is not part of the command
deadline; success means the first turn is durably queued.

## Saga state

The orchestrator stores:

```text
requested
  -> issue-resolved
  -> task-created
  -> worktree-created
  -> agent-created
  -> turn-queued
  -> active
  -> pr-linked (optional)
  -> completed
```

Failure before `turn-queued` enters `compensating`. Failure after the agent begins enters
`manual-intervention` unless all effects remain safely reversible.

Every step row contains saga UUIDv7, command idempotency key, input digest, target resource URIs,
step command ID, step idempotency key, expected version, outcome digest, event cursor, attempt
count, last safe error, and committed timestamp.

`EX-COLLAB-002` The orchestrator MUST commit a step outcome and consumed event ID atomically in its
own plugin database before advancing. It MUST retrieve an existing outcome before retrying a
mutating step.

## Execution sequence

1. Core authenticates the paired Client, validates full owner authority, resolves the orchestrator
   grant, and stores the command receipt.
2. The orchestrator calls Linear issue resolve. The broker propagates the device caller and
   intersects grants.
3. The orchestrator asks core to create a task with issue title/link provenance.
4. It asks core to create the worktree. Core rechecks repository-config trust and path policy.
5. It asks Agents to create a session using the selected profile.
6. It asks Agents to enqueue a bounded prompt assembled from the normalized issue fields.
7. Agents commits the turn and emits its system event through the Node outbox.
8. The orchestrator marks the saga active and returns task/session URIs to the Client.
9. If GitHub later publishes a matching pull-detected event, the orchestrator validates current
   saga/task state and calls the optional task-link capability.
10. The orchestrator emits `example.issue-to-agent.completed.v1` after its final commit.

`EX-COLLAB-003` The prompt contains only the allowlisted issue title, identifier, description,
project, labels, and URL. Linear comments or attachments require separately declared fields and
limits.

`EX-COLLAB-004` Receiving an Agents or GitHub event does not authorize the resulting call. The
broker rechecks the current grant, dependency, target Node, and resource scope.

## Compensation

| Completed effect | Compensation |
| --- | --- |
| Linear resolve | None; read-only |
| Task created, no worktree | Archive task if resource version is unchanged |
| Worktree created, no agent | Remove clean worktree then archive task |
| Agent created, no queued turn | Delete empty session, remove clean worktree, archive task |
| Turn queued/agent active | No automatic deletion; enter manual intervention |
| PR link created | Remove only the orchestrator-owned link if requested by owner |

`EX-COLLAB-005` A dirty worktree, changed task version, active session, provider mutation, or failed
compensation MUST stop automatic cleanup and present completed/uncompensated effects to the owner.

## Events and recovery

The orchestrator publishes `started`, `step-completed`, `blocked`, `completed`, and `failed` events
in its namespace. Step events contain saga/step/status/resource URIs and safe error code only.
Issue body, prompt, terminal output, source paths, and provider responses are excluded.

After Node restart, the orchestrator reads incomplete saga rows, retrieves stored command outcomes,
queries authoritative resource snapshots, and resumes from the first uncommitted step.

If the subscription cursor has expired, the orchestrator requests authorized snapshots for its
active task/session/link resources before resubscribing. It does not infer absence from a replay
gap.

`EX-COLLAB-006` A provider plugin being disabled or quarantined changes a required step to
`blocked-dependency`; it does not cause repeated calls or erase saga state.

## Client behavior

Electron renders the operation with the standard wizard/progress/timeline components. It can
navigate to the task, Linear issue, agent session, or PR using canonical resource URIs. If a renderer
or optional plugin is absent, it retains the normalized status and external-link fallback.

## Conformance scenarios

- Repeat the start command with the same key and input: the same saga/task/session result returns.
- Repeat with the same key and different repository: `idempotency-conflict`.
- Revoke agent-create permission between worktree and agent steps: compensation runs safely.
- Crash after Agent commit but before orchestrator commit: result retrieval prevents duplicate
  session creation.
- Deliver the same pull-detected event twice: one task link exists.
- Disable GitHub: active saga remains usable and reports optional integration unavailable.
- Make the worktree dirty before compensation: manual intervention preserves it.
- Attempt to pass a resource URI from another Node: validation rejects before any effect.
- Give the callee broader permissions than the caller: the intersection prevents widening.
