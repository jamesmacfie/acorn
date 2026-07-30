# Workflows contracts, events and security

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-WF`

## Queries and commands

| Contract | Kind | Risk/idempotency |
| --- | --- | --- |
| `acorn/workflows.definitions.list@2` | query | read |
| `acorn/workflows.definition.get@2` | query | read |
| `acorn/workflows.definitions.rescan@2` | command | read-effect, optional idempotency |
| `acorn/workflows.runs.start@2` | command | execute, idempotency required |
| `acorn/workflows.runs.list|get@2` | query | read |
| `acorn/workflows.steps.list|get@2` | query | read |
| `acorn/workflows.gates.resolve@2` | command | execute, idempotency required |
| `acorn/workflows.runs.cancel@2` | command | execute, idempotency required |
| `acorn/workflows.steps.kill@2` | command | execute, idempotency required |
| `acorn/workflows.triggers.enable|disable@2` | command | execute/policy, idempotency required |
| `acorn/workflows.triggers.evaluate@2` | owner diagnostic command | execute, no public poll loop |
| `acorn/workflows.handoff.get@2` | query | sensitive read |

`CUR-WF-086` Queries return resource envelopes, snapshot sequence and opaque pagination. Runs are
task-scoped; get/step/gate commands rederive owning task/Node and never trust ancestry supplied by
the Client.

`CUR-WF-087` Start input is task URI, definition URI/revision, optional posture override that may
only narrow autonomy, and idempotency key. A Client cannot submit or alter steps, prompts, tools,
budgets, dependencies or trigger.

`CUR-WF-088` Gate input includes run/step/gate URI and expected revisions plus `approve|reject`.
Only a current pending gate accepts one decision; stale/double/different-key resolutions return the
original result or `conflict` without advancing twice.

`CUR-WF-089` Cancel/kill acknowledge `accepted` only after the durable cancelling/operation
checkpoint. Terminal outcome arrives through query/event and is not implied by HTTP completion.

`CUR-WF-090` Errors include `definition_not_found`, `definition_changed`, `definition_invalid`,
`config_trust_required`, `dependency_unavailable`, `permission_required`, `budget_invalid`,
`run_terminal`, `gate_not_pending`, `operation_unknown`, `safety_rail`, `quota_exceeded`,
`cancelled`, `deadline_exceeded` and standard authorization/concurrency errors.

`CUR-WF-091` V1 task/run workflow routes and all `/api/v1/plugins/workflows` endpoints are removed.
The V2 contracts replace them without accepting V1 tokens, arbitrary definition bodies or Client
trigger polling.

## Product events and progress streams

Workflows publishes:

| Event | Commit represented |
| --- | --- |
| `acorn.workflows.definition.changed.v2` | validated/invalid source revision recorded |
| `acorn.workflows.run.started.v2` | run and top-level checkpoint committed |
| `acorn.workflows.run.status-changed.v2` | run entered gated/cancelling/terminal state |
| `acorn.workflows.step.status-changed.v2` | step checkpoint changed |
| `acorn.workflows.gate.requested.v2` | durable pending gate exists |
| `acorn.workflows.gate.resolved.v2` | one gate decision committed |
| `acorn.workflows.handoff.committed.v2` | handoff metadata committed |
| `acorn.workflows.trigger.evaluated.v2` | trigger cursor/dedup outcome committed |

`CUR-WF-092` Event payloads contain URIs, revisions, status, safe reason class, sequence and
correlation. They omit prompts, inputs, outputs, schema bodies, handoff text, provider events,
terminal output, secrets, absolute paths and raw error/stderr.

`CUR-WF-093` `run.status-changed` is the single durable terminal fact; notification mappings derive
from it idempotently. A progress frame, provider callback or Client state cannot substitute.

`CUR-WF-094` Provider streaming uses a bounded run/step stream channel with sequence, credit,
cancellation and redaction. The runner may persist safe progress summaries but stream loss never
requires replaying an external operation.

`CUR-WF-095` Duplicate events are deduplicated. A replay gap fetches authorized definitions,
active/recent runs, steps, gates and attention snapshot at one sequence, replaces affected
projections atomically and resubscribes.

## Dependency contracts

`CUR-WF-096` Agents exports `session-execute@2` accepting task, prompt/context resource refs,
profile capability, model, schema digest, tool/budget ceilings, run/step operation IDs and
cancellation. It returns typed terminal outcome, structured output, usage and session relation.

`CUR-WF-097` Terminal exports `run-targets@2` query/start/status under exact task/target and a typed
session-open intent for raw resume. No terminal output or PTY handle crosses.

`CUR-WF-098` Policy providers export deterministic `policy.evaluate@2` with named policy, task and
resource revisions. The V1 `checks-green` mapping belongs to GitHub's checks policy provider and
fails closed when no PR/check snapshot is authoritative.

`CUR-WF-099` Core exports idempotent child-task create/cancel relation operations. Workflows
supplies title/branch seed as validated data; core owns branch normalization/dedup, task persistence,
worktree creation and authorization.

`CUR-WF-100` Context providers export immutable bounded snapshots. Workflows' own handoff section,
Notes and other selected sections are assembled by the core context broker under the original
run's grant; Workflows does not call a private loopback API.

`CUR-WF-101` Memory review and Notes display are optional post-checkpoint calls. Failure records a
retryable auxiliary operation and never rolls back a terminal run or grants context access.

`CUR-WF-102` Third-party step-kind, policy and trigger providers register versioned exported
capabilities plus validators and schemas through manifests. Workflows never imports their handlers
or accepts runtime callbacks.

## Security and authority

`CUR-WF-103` Workflow definitions, repository config, prompts, schemas, structured outputs,
provider responses and dependency events are untrusted input. Every boundary is strict-schema
validated, size-limited and correlated before state transition.

`CUR-WF-104` Config trust authorizes exact reviewed bytes, not every effect. Effective grants and
step ceilings still authorize each file, Agent, Terminal, task, provider, network or secret action.

`CUR-WF-105` Autonomous posture cannot bypass tool approval, secret/network policy, repository
trust, budget, provider limits or system destructive confirmation. It changes only declared
human-gate behavior within the approved workflow.

`CUR-WF-106` Tool and budget ceilings only narrow across workflow, step, child, Agent and MCP/tool
projection. Unknown risk, unmetered required budget or a widening child definition fails closed.

`CUR-WF-107` Caller delegation includes start actor or trigger grant, run, step, task, definition
revision, effective ceilings and expiration. A provider cannot use its broader installation grant
for the Workflow caller.

`CUR-WF-108` Prompt template output is tagged untrusted context. It cannot become a tool command,
capability identifier, schema, profile, model, branch target, URL or executable argument through
interpolation.

`CUR-WF-109` Human and policy gates are runner-enforced persisted state. Agent text claiming
approval, green checks or owner intent has no effect.

`CUR-WF-110` Trigger execution requires exact resource filter, dedup cursor, finite schedule,
background grant and budgets. A malicious provider event cannot broaden task scope or create
unbounded runs.

`CUR-WF-111` The WASI runner has no ambient files, processes, network, secrets, environment or
clock beyond broker imports. It cannot open core or another plugin database.

`CUR-WF-112` Sensitive database fields/backups use application encryption. Product events, audit,
health and telemetry use safe metadata only. Full-disk encryption remains required for ordinary
Node storage.

## Sagas and recovery

`CUR-WF-113` Every external operation records requested/accepted/committed/failed/unknown with
provider operation ID and compensation class. There are no transactions spanning Workflows,
Agents, Terminal, core tasks, GitHub, Notes or Memory.

`CUR-WF-114` Safe automatic retry requires same immutable input, idempotency key and provider proof
that commit did not occur or returns the original outcome. Unknown process/provider outcome creates
recovery attention and no duplicate.

`CUR-WF-115` Fan-out compensation may cancel newly created child tasks and Agent work but MUST NOT
delete their worktrees/branches or external commits automatically. Owner cleanup is explicit.

`CUR-WF-116` Run cancellation races with completion through compare-and-set checkpoints. A
provider result committed before cancellation is retained; cancellation controls subsequent
advancement and records the actual terminal outcome.

## Acceptance

`CUR-WF-117` State-machine tests cover every run/step/gate transition, branch/skip, fan-out/join,
CI safety rail, cancellation race, provider outcome class and restart boundary.

`CUR-WF-118` Security tests cover malicious TOML/schema/template/output, config-trust bypass,
permission/tool/budget widening, trigger floods, cross-task/Node IDs, confused deputy, secret/output
leakage and WASI escape.

`CUR-WF-119` Contract tests validate every query/command/event/provider schema, idempotency,
optimistic revision, pagination, event replay, progress backpressure and `/api/v1` refusal.

`CUR-WF-120` Dependency tests remove or downgrade Agents, Terminal, GitHub policy, Notes, Memory and
profiles independently and verify only affected definitions/steps degrade.

`CUR-WF-121` Audit captures definition trust, start/trigger, grants, dependency calls, gate actor,
cancel/kill, safety rail, update and recovery without sensitive content.

`CUR-WF-122` Multi-Node tests prove runs, trigger dedup, events, gates and mutations remain on one
owning Node and no cross-Node transaction or fallback execution occurs.

`CUR-WF-123` Workflows is contract-complete only when every V1 registry, bridge, route, WebSocket
frame, client import, table field, step kind, policy, trigger and lifecycle outcome maps to a
declared V2 contract or explicit removal here.
