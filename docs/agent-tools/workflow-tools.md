# Workflow tools

The workflows plugin contributes nine agent tools. With them an agent finds the workflows its task can
use, saves drafts for the owner to review, and starts a workflow the owner approved. Read this page to
change a tool, its limits, or the owner's approval. It's part of [agent tools](../agent-tools.md).

The tools are in `plugins/workflows/src/server/agentTools/`. `activation.ts` registers them and the
approval routes. `tools.ts` holds the names, schemas, and descriptions, the only part loaded at boot.
`services.ts` builds the rest on the first call. The descriptions teach the sequence, so an agent
needs no skill installed. Change them with the behavior.

## Tools

| Tool | Risk | Input | Result |
| --- | --- | --- | --- |
| `workflow_catalog` | read | `cursor` | Step kinds with their fields and output schemas, gate policies, agent profiles, and the format markers |
| `workflows_list` | read | `search`, `cursor` | Each definition's reference, publication state, revision, digest, input and output contracts, `agentDraft`, `invocation` readiness, and problems |
| `workflow_get` | read | `ref`, `revision`, `step` | The draft, a published revision, or a file, with problems, `withheld` fields, and an editor target |
| `workflow_validate` | read | `definition` | Structural and catalog problems. Saves nothing |
| `workflow_draft` | write | `definition`, and `draftId` with `expectedRevision`, or `source` | Draft ID, revision, digest, a semantic diff, problems, `withheld`, and an editor target |
| `workflow_run` | execute | `ref`, `digest`, `inputs` | Run ID, status, effective limits and tools, the session's starts used, a receipt, and a run target |
| `workflow_read` | read | `runId`, `step`, `cursor` | Status, steps, what needs a person, declared outputs, and an `observation` |
| `workflow_wait` | read | `runId`, `after`, `timeoutMs` | The same summary, with why the wait returned |
| `workflow_cancel` | execute | `runId` | The run's status |

The four discovery tools need only the task. The other five need a signed managed session
(`requiresSession`), and a terminal session doesn't see them. Task, project, workspace, and session
come from the credential, never from input. `execute` is off until you turn the tier on, so
`workflow_run` and `workflow_cancel` start hidden ([permissions](../agent-tools.md#permissions)).

`agents.toolCaller` resolves the signed session
([tool callers](../managed-agents/session-control.md#tool-callers)). Workflows reads that, never the
Agents store.

## Scope and paging

A definition reference resolves in the task's project and checkout: rows for the project or its
whole workspace, repository files from the task's checkout, and user files. Another project's row
answers as missing. Input defaults never leave the Node; `hasDefault` says one exists.

Lists page at 50 entries, steps at 100, and every answer at 64 KiB. A definition too large for one
answer returns its outline, and `step` reads one step in full. A value too large or likely secret is
withheld whole and named, never cut short.

## Projections

`projection.ts` decides what an agent reads of a definition. It leaves out the configuration AI
authoring hides: a trigger, a tool allowlist, a run target, and a contributed kind's `headers` and
`auth`. It also leaves out private values: each root input's default, any string under a
credential-like key such as `token` or `password`, and any string the shared secret detector flags.
Harness, model, and options stay visible, because the owner reviews them before publication.
`withheld` lists each path left out, such as `steps[post].with.auth`.

An agent can't author protected fields. `workflow_draft` drops any it sends. It can write its own
private values. A draft based on a source gets back every withheld value the agent didn't replace,
matched by step ID and kind. A new
step gets nothing, so a step that needs owner configuration stays incomplete until the owner adds it.
No redaction marker exists, so none can come back as a value.

## Drafts

`workflow_draft` writes a project-scoped database draft. The row's `agent_origin_json` records the
task, the signed session, the creating and last tool call, and any source with its revision or
digest. The editor shows **Agent draft**, and the workflow list marks the row. Duplication and
publication don't copy the origin.

- Without `draftId`, the call creates a draft. With `source`, the source stays untouched, and the
  diff compares against it.
- With `draftId` and `expectedRevision`, the call replaces a draft this session created. Anyone
  else's draft answers as missing. A stale revision is a conflict that names the current revision.
- Incomplete drafts are kept with their problems. A draft never runs. You publish it in the editor.

Each call is keyed by task, session, and the MCP proxy's call ID. The answer is stored before the
write, and the write stamps the call ID onto the draft in the same statement. A repeat returns the
stored answer, a reused ID with other content conflicts, and a restart finds whether the write
landed from the stamp.

## Invocation authority

Turning on `workflow_run` lets an agent use the verb. An invocation policy says what it may start.
In the editor's overflow menu, **Agent invocation…** opens a review of a published database
definition or a file. It shows every node in the resolved graph and each step's kind, harness, and
model. It also shows the input contract, the fields an input reaches, and whether the workflow skips
gates. You choose which inputs agents set, fixed values for the rest, turn and time limits, an
optional cost limit, and starts per session. The default is five.

`workflow_invocation_policies` keeps one row per project and definition. The graph digest covers
every node, its provenance, and dependency revisions. Names, labels, and the caller's input values
aren't in it. A changed graph needs a new approval. Revoking blocks fresh starts and leaves admitted
runs alone. Approve again and the same row comes back, so a session's spent starts stay spent.

`workflow_run` checks, in order:

1. The caller is a managed session that neither a workflow nor another agent started. A spawned child
   would otherwise bring a fresh start allowance with it.
2. An active policy covers this definition in this project.
3. `digest` matches what the agent read. Every input it sets is one the policy allows.
4. The session has starts left. Finished and cancelled runs count; replays don't.
5. No workflow is active in this checkout, counting tasks that share one folder.
6. The definition resolves in the task's checkout, repository trust holds, and the graph digest
   matches the policy.

The effective budget is the definition's own, narrowed by the policy's limits. The effective tools
are the caller's signed ceiling intersected with the definition's. Nothing in the call widens either.

## Launches and the calling turn

`workflow_agent_launches` stores a receipt before work starts: the caller, the call, the frozen
graph, and the effective authority. Its ID is the run ID it reserves. A repeat returns the admitted
snapshot, even after an edit. Before a waiting launch starts, it checks the approval again. A
revoked or replaced approval fails the launch, and a failed launch doesn't use a start.

The calling agent is mid-turn in the same checkout, so the run waits as `awaiting-caller` until the
caller has no turn running or queued. Agents reports each settled turn through `agents.toolCaller`.
After a restart, waiting receipts are checked once, and the reserved run ID means one run at most.

- An ordinary turn ending or a wait timing out leaves the run going.
- Stopping the turn that launched it cancels the launch. A later cancelled turn of that session
  cancels its running launched runs.
- A caller that never settles never starts its run.

## Reading runs

`workflow_read` and `workflow_wait` reach runs this session launched and the workflow the session
belongs to, with their child runs. Every other ID answers as missing. Outputs are untrusted data, and
summaries carry no prompt, transcript, record body, or provider payload.

`workflow_wait` polls the Node's own rows for up to 30 seconds and holds no execution slot. It returns
at a gate, a pending question in a step's session, a failure, a finish, or a change past `after`. It
never answers a gate or retries a step. `workflow_cancel` reaches only runs this session launched.

## Presentation

`WorkflowToolCard.tsx` draws these calls in the transcript, with **Open workflow** for a draft and
**Open run** for a run. The run pane names the agent that started a run and its limits.

## Audit

The plugin writes `agent-draft-saved`, `agent-invocation-approved`, `agent-invocation-revoked`,
`agent-run-launched`, and `agent-run-cancelled` to the audit trail with caller and resource IDs. No
prompt, input value, or credential goes in.

## Limits

- A terminal agent can read definitions but can't draft, start, read, or cancel runs.
- A workflow step's session can't start a root. Nested work goes through child workflow steps.
- A session another agent spawned can't start a root. The agent you talk to starts it.
- Publication, gate answers, retries, and record reprocessing stay device actions.
- A policy is per project. A workspace-wide row needs one approval per project.

## Why

A root start creates fresh authority and budgets, so it can't wrap the device start. The policy,
receipt, and narrowed admission are what make an agent start bounded. The handoff waits for the
caller's turn because a run count doesn't keep two writers out of one folder.
