# Unattended turn policy

Completion note, October 8, 2026: The agents store resolves and persists attendance at turn
acceptance, alongside the provider policy snapshot. This includes direct goal enqueue, plan
implementation, workflow continuations, usage-limit retries, and admitted plugin follow-ups. The
host passes workflow posture through the internal execution capability. HTTP and tool bodies do
not supply attendance; protected session configuration cannot replace the host bootstrap snapshot.
Unknown host posture and persisted attendance fail. Legacy turns are backfilled before dispatch or
idempotent acceptance, using the saved session snapshot or the original attended/supervised default.
Goals remain restricted to interactive sessions.

Autonomous permissions reject once, and questions/forms cancel with a recorded policy reason.
Requests are recorded already resolved, without pending attention or waiting on a person. Parked
request callbacks also cover provider startup before a handle exists. Autonomous plugin hook asks
deny immediately. Supervised requests retain their existing human path. A final message starting
with `BLOCKED:` fails managed workflow execution without continuation or review.

Decisions and deviations: Claude and Codex have session-level system/developer instruction channels,
so host admission saves `config.initialAttendance`, and a workflow session keeps that posture.
Claude retains its original appended prompt on resume; Codex modes can supply their own instructions.
The runtime therefore also prepends attendance instructions to every unattended turn, including
contributed ACP harnesses, legacy resumes, and follow-ups. A saved workflow session reused without an
explicit posture retains its saved policy. Headless profiles have no managed request channel and
retain their existing behavior. The desktop retry action removes host policy fields before HTTP
admission. Prompt text and request settlement are lazy modules; the remaining acceptance, recovery,
and event routing increased the Node static graph to 3,173,645 bytes, with a 4,000-byte ceiling increase.

Verification: Locked dependencies installed in this worktree on Node 26.8.1. Focused agents tests
covered attendance persistence/recovery, goals, requests, startup, hook asks, workflow results,
follow-ups, usage-limit continuation, plan handoff, HTTP admission, configuration authority, harness
channels, and desktop retry. Focused workflow runner tests covered both posture values and blocked
step failure. Affected agents, workflows, Node, desktop, published types, and architecture typechecks;
targeted oxlint; architecture boundaries, public contracts, documentation paths/citations; and the
Node service build/budget passed. Existing unrelated oxlint warnings remain. No root test or lint ran.

Real-app coverage: `dev:agent -- --session phase5-autonomous --fixture unattended-policy` ran a fake
managed harness through the actual runtime and `createSessionExecute` before opening the desktop.
It verified rejection/cancellation of a permission, question, and form, three resolved saved requests,
and one blocked turn without continuation. The task Agent pane snapshot and inspected screenshot
show all three policy cards, the blocked reply, and no answer/approval controls. The app was stopped.
This verifies runtime settlement and rendering from saved data, plus restart reads; it does not claim
a live commercial-harness question or a running workflow graph in the desktop. Permission controls
were unchanged. The workflow graph and driver protocols have separate focused tests.

Later phases: Extend the goal judge to unattended sessions only if explicitly scoped; it should map
`BLOCKED:` to a user-input blocker. Supervised deadlines and headless interaction policy remain
outside this phase. Keep these future phase documents until coordinator cleanup.

Status: completed October 8, 2026. Part of the [DeerFlow review](./README.md).

## Problem and outcome

Acorn runs agent turns that nobody watches: workflow steps, delegated children, and scheduled
workflow runs. Each place that cares about this decides for itself:

- Claude's unattended turn-ending instruction applies to the `workflow` and `delegated` session kinds
  (`UNATTENDED_KINDS` in `plugins/agents/src/server/drivers/claudeHarness.ts`). Codex and contributed
  harnesses get nothing.
- A workflow's `posture` of `gated` or `autonomous` (`plugins/workflows/src/shared/workflowContracts.ts`)
  decides how human gates behave, and stays inside the workflows plugin.
- A permission request, question, or form from an unattended agent waits for a person, whatever the
  posture says. A delegated child's request sends its owner an informational report.

Resolve one value per turn, called _attendance_, and make every consumer read it. Under an
autonomous posture, the agent never waits on a person. It makes small reversible assumptions and
lists them, or it stops with a blocked result that names the decision it needs.

## What DeerFlow does

DeerFlow resolves a `RunInteractionPolicy` once per run, with the modes `interactive`, `scheduled`,
`webhook`, and `autonomous`. That one value decides which tools the agent sees, whether it may ask
for clarification, whether a network approval prompt can open, and what the system prompt says.
Unattended runs must use the context they have, make minimal reversible assumptions, list the
material ones, or return a structured `BLOCKED` result for risky or irreversible work. They never
wait for a synchronous answer. An unknown mode is a configuration error, never a fall back to
interactive. Subagents always deny pending network requests. Public callers can't set the mode. See
`references/deer-flow/backend/docs/RUN_INTERACTION_POLICY.md`.

## Scope

In scope:

- A host-resolved `attendance` of `attended`, `supervised`, or `autonomous` on every turn.
- The prompt text for each value, on every harness.
- Request handling under `autonomous`.
- A blocked result that workflow steps recognize.

Out of scope:

- Approving anything automatically. Acorn never answers a permission request with an allow. The
  harness's permission mode decides what prompts at all.
- Plugin follow-up turns in unattended operations. The
  [oh-my-pi unattended follow-ups](https://github.com/jamesmacfie/acorn/blob/e67db6f50/docs/future/pi/05-unattended-follow-ups.md) phase owns that.
- A setting for deadlines on supervised requests. Supervised turns keep waiting, as they do today.

## Design

### Resolving attendance

The agents plugin resolves attendance when it accepts a turn and stores it on the turn's effective
policy, so recovery and every consumer read the same value:

| Turn | Attendance |
| --- | --- |
| A person's turn in an interactive or imported session | `attended` |
| A goal continuation from [session goals](./02-session-goals.md) | `attended`, because a person set the goal and is in the session |
| A delegated child's turn | `supervised` |
| A workflow step under a `gated` posture | `supervised` |
| A workflow step under an `autonomous` posture | `autonomous` |

The workflows plugin passes posture through the session execute request
(`plugins/agents/src/server/sessions/sessionExecute.ts`). Attendance is never read from a tool input
or an HTTP body. An unknown value is a programming error that fails the turn, never a fall back to
`attended`.

### Prompt text

Replace the session-kind check in `claudeHarness.ts` with an attendance check. Keep Anthropic's
turn-ending text for `supervised` and `autonomous`. Add one paragraph for `autonomous`: don't wait
for a person, make reversible assumptions and list them in the final message, and for risky or
irreversible work without authority, end with a line that starts `BLOCKED:` and names the decision.

Send the same text to Codex as developer instructions and to a contributed ACP harness in the first
prompt, the channels standing memory already uses ([standing memory](../../managed-agents/sessions.md#standing-memory)).

### Requests under autonomous

When an `autonomous` turn raises a request, the runtime resolves it at once, records why, and never
raises an attention row:

- A question or form is cancelled, with a fixed message that the run is unattended and the agent
  should proceed by the policy. `plugins/agents/src/server/drivers/formElicitation.ts` already maps
  a cancel for each harness.
- A permission request is rejected once, with the same message.

`attended` and `supervised` requests behave as they do today.

### A blocked result

Teach the workflow step's early-turn check to read a final message that starts `BLOCKED:`. It fails
the step with that line as the reason and doesn't send a continuation turn, the way a refusal is
handled ([a turn that ends early](../../workflows/agent-steps.md#a-turn-that-ends-early)). A delegated
child's blocked line already reaches its owner in the report.

### The goal judge

When [session goals](./02-session-goals.md) extend to unattended sessions, the judge reads
attendance. Under `autonomous`, a stated low-risk assumption doesn't fail the goal by itself, and a
`BLOCKED:` line maps to the `needs_user_input` blocker. This is DeerFlow's rule.

## Limits and risks

- Rejecting a permission under `autonomous` can leave the agent unable to work. That is the honest
  outcome, and the step's error says which permission was refused. Fix it by changing the step's
  permission mode, not by approving automatically.
- The `BLOCKED:` line is a convention the model can miss. The step's continuation turns still apply.

## Verification

- A resolver test for each row of the table and for an unknown value.
- Driver tests that each harness receives the right text for each value.
- Runtime tests that an `autonomous` question, form, and permission request resolve without an
  attention row, and that `supervised` ones still wait.
- A workflow test that a `BLOCKED:` final message fails the step without a continuation.
- In the real app, run an autonomous workflow whose agent step asks a question, and confirm the run
  continues or blocks instead of waiting.

## Docs to update

[Harnesses](../../managed-agents/harnesses.md), [managed delegation](../../managed-agents/delegation.md),
[agent steps](../../workflows/agent-steps.md), and [workflow execution](../../workflows/execution.md).

## Verify before building

- How a workflow agent step behaves today when its session raises a request: whether it waits until
  the step timeout or fails sooner.
- Where the effective policy is built, and whether workflows can pass posture without a contract
  version change.
- That every harness driver can cancel a question and reject a permission without a person.
