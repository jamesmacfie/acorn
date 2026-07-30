# Workflows Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-WF`

## Contributions

| Contribution | Identity | Behavior |
| --- | --- | --- |
| Settings page | `acorn/workflows.settings.workflows` | read-only definition inspector and trigger controls |
| Palette command source | `acorn/workflows.command.start` | `Workflow: <name>` rows |
| Task activity slot | `acorn.task.activity` / `acorn/workflows.activity` | runs, steps, gates and controls |
| Attention provider | `acorn/workflows.attention` | gates, safety rails, failures/recovery |
| Notice kinds | `acorn/workflows.notice.*` | gate, done, failed, safety rail |
| Context section | `acorn/workflows.context.handoff` | explicit run-scoped handoff snapshot |
| Navigation intents | `acorn/workflows.intent.*` | exact run/step/gate/definition targets |

`CUR-WF-057` Every Client surface is owned by the Workflows package. The Electron shell composes its
namespaced contribution into the named `acorn.task.activity` slot beside Agent and Terminal
activity, but those plugins receive only the declared semantic contribution and navigation intents.

## Settings and definitions

`CUR-WF-058` Settings retains label “Workflows”, general group, order 50 and a read-only view of
definitions applicable to the active node-qualified task. It no longer requires a local Terminal
or Electron-owned runtime.

`CUR-WF-059` Each definition row displays name, source `repo|owner`, posture, trigger state,
revision/digest short form, dependency readiness and ordered step summary. Non-agent kinds appear
as `<name> (<kind>)`.

`CUR-WF-060` Invalid files are never silently omitted. “Problems” groups safe source label,
definition ID, validation code, message and navigation to the repository file through a typed
Editor intent when available.

`CUR-WF-061` “Rescan” requests a Node definition refresh, displays progress/result and cannot start
a workflow. A disconnected Node shows the last snapshot as stale with no misleading rescan
success.

`CUR-WF-062` Trigger controls show enabled state, cadence/source, last evaluation/start/error,
effective authority/budgets and background execution. Enabling autonomous/background behavior
launches the host permission wizard.

## Command palette and start

`CUR-WF-063` For an active authorized task, the host palette lists `Workflow: <name>` with
`<N> steps`, source/posture hint and disabled reason for invalid trust, dependency, budget or
permission state. Definition errors remain visible non-invocable rows.

`CUR-WF-064` Selecting a row sends definition URI/revision, task URI and idempotency key. It does
not send the definition body. A changed definition produces a review/retry state rather than
starting different bytes.

`CUR-WF-065` Manual start requiring repository-config trust opens the core trust review and resumes
only the same pending start after exact-hash approval. Dismissal leaves no run.

`CUR-WF-066` Start success navigates or raises a nonmodal status for the accepted run. Duplicate
activation with the same idempotency key selects the existing run rather than creating another.

## Task activity and run detail

`CUR-WF-067` The task activity section preserves V1 placement under “Terminals & workflows” when
the Agents task sidebar is present. Without Agents it appears in the host task activity surface
with identical Workflows content.

`CUR-WF-068` Runs are newest first and show workflow name, posture, trigger, status glyph/text,
elapsed time, budget/usage summary and Node identity. Selecting a run shows its frozen definition
revision and ordered top-level/child steps.

`CUR-WF-069` Steps show name, kind, task relation, profile/model, status, iteration, cost/usage,
safe error, structured-output summary and child lineage. Live Agent content remains in Agents and
is opened through its typed session intent.

`CUR-WF-070` A waiting human gate renders host-owned Approve and Reject buttons, policy/context
summary, requested authority, run/step revision and created time. One response disables both
buttons pending the idempotent result.

`CUR-WF-071` Cancel run and kill step are explicit destructive controls with scope/result
confirmation. Controls are disabled for terminal/stale state and never infer success from an event.

`CUR-WF-072` A resumable Agent relation offers “Open Agent”. A raw-profile relation offers a typed
Terminal handoff when Terminal and profile resume capability exist. Workflows never displays or
constructs a raw resume command string.

`CUR-WF-073` Fan-out shows each child task and child step with typed task navigation. Cancelling a
run explains that created child tasks remain unless the cancellation policy marks them cancelled;
it never promises worktree deletion.

## Notifications and attention

`CUR-WF-074` Gate, failed, safety-rail and recovery-required states create durable Fleet attention
with node/task/run/step target. Completion creates a deduplicated notice according to owner
preference; cancellation is activity but no toast by default.

`CUR-WF-075` Notice payloads use stable dedup keys and generic host rendering. OS notification text
contains no prompt, output, branch, repository-private content or error body.

`CUR-WF-076` Selecting a notice/attention item navigates to the exact owning Node, task, run and
step/gate. If the Node is offline, the cached run view opens stale and the mutation controls remain
disabled.

`CUR-WF-077` Live step progress uses the shared stream/view-session protocol and is non-authoritative.
Durable status changes arrive through product events and snapshots. Progress loss does not change
run outcome.

## Context, accessibility and fallback

`CUR-WF-078` The context picker exposes an explicit Workflow handoff option containing source run,
revision, captured time, sensitivity and token/byte budget. Only the selected run's handoff is
included; terminal runs default to excluded.

`CUR-WF-079` Lists, status, progress, gates, errors and controls expose semantic roles, text
alternatives, keyboard operation, focus return and polite announcements. State is never
communicated by glyph/color alone.

`CUR-WF-080` Narrow/mobile Clients render a single-column read-only run timeline, attention and
gate controls when supported. They may omit live Agent/Terminal handoff but cannot approve a gate
without full host security UI.

`CUR-WF-081` Missing renderer, dependency, permission, Node connection, definition, task,
configuration trust or operation history each produces a distinct fallback with supported recovery.

`CUR-WF-082` Multi-Node lists never merge runs by raw ID/name. Every row retains Node identity;
federated sorting uses updated time plus Node URI/run URI tie-breakers and reports partial failure.

`CUR-WF-083` Client cache stores bounded definition/run/step projections and event cursor by Node.
It never stores prompts, full structured output, handoffs, provider transcript or permission
payload outside the authorized view session.

`CUR-WF-084` Client disable/update closes live progress streams after preserving navigation state.
The Node runner continues according to policy, and reactivation snapshots authoritative state.

`CUR-WF-085` UI acceptance MUST cover definitions/problems, palette start, trust resume, all
run/step states, gates, cancel/kill, fan-out, Agent/Terminal optional links, attention/notices,
offline/replay, multi-Node, accessibility and mobile fallback.
