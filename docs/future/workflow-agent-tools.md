# Workflow agent tools

Date: October 9, 2026. Status: proposed product requirements; implementation not started.

This PRD defines how agents discover workflows, create recoverable drafts, and invoke approved
definitions from a task conversation. It is the implementation handoff for the agent-tools item in
[Workflow followup work](./workflows-gaps.md). [Workflows](../workflows.md) owns shipped behavior.

## Problem and outcome

An agent can delegate to managed sessions, but it has no dedicated tools for reusable workflows.
The owner must move between chat, the workflow editor, and run inspection to turn a routine into
automation or ask an agent to use it. CLI commands exist, but do not provide an agent-specific
discovery, drafting, or invocation contract.

The outcome is a conversation such as "Save our Dependabot routine as a workflow" or "Use the
approved issue investigation workflow for this ticket." The agent discovers the Node's actual
vocabulary, saves a draft, or starts an approved published definition. The owner reviews drafts in
the workflow editor and watches execution in the run pane. Each operation returns a durable identity.

Success means completing these journeys through ordinary agent tools without inventing step kinds,
writing workflow files through shell commands, or asking the agent to impersonate a device caller.

## Product journeys

1. Create a repeatable routine. The agent reads the catalog, authors a typed definition, validates
   it, and saves a project-scoped draft. Its reply links to the draft and names validation problems.
   The owner reviews, edits, and publishes it through the workflow editor.
2. Use approved automation. The agent finds an applicable published workflow, reads its input and
   output contracts, and invokes it with typed values. The response links to the run immediately.
   The agent can inspect progress or wait briefly for a result or human attention.
3. Refine an agent draft. The agent reads its draft revision, saves a revision-checked replacement,
   and receives a semantic diff. An owner edit racing the save produces a conflict rather than a
   lost edit. Published revisions and active runs retain their frozen definitions.
4. Handle a blocked run. The agent reports the failing step or pending decision with a link to the
   run. A person answers gates and retries failures. The agent can cancel a run it launched.

For the Dependabot journey, a For each agent keeps separate item sessions in the parent worktree.
The tools preserve its sequential execution and item history. They do not introduce per-item
worktrees or a batch execution model. See [child workflows](../workflows/child-runs.md).

## Scope

The first release includes task-scoped discovery, definition inspection, validation, draft creation
and revision, approved invocation, bounded run reads and waits, and cancellation of owned runs.
It supports repository, user, and published database definitions through the same resolution rules.

Draft mutation and invocation require a signed managed-session identity. Read tools accept the
authenticated task context. Terminal-only mutation and invocation are deferred until their caller
ownership and lifecycle have equivalent contracts.

Excluded work includes a durable admission queue, queue ordering, schedules, webhook triggers,
integration actions, custom JavaScript nodes, automatic Git merges, and a replacement workflow engine.
Agents cannot publish, export files, delete definitions, answer gates, retry failures, reprocess
records, or grant invocation permission through these tools.

## Starting point and ownership

The implementation starts from these owners:

| Owner | Responsibility |
| --- | --- |
| `plugins/workflows/src/node/index.ts` | Register tools during plugin initialization and remove them on disposal. |
| `packages/node-core/src/server/agentTools/registry.ts` | Tool schemas, task context, signed session identity, permissions, and dynamic availability. |
| `plugins/workflows/src/server/definitions/` | Layer resolution, drafts, immutable revisions, publication, and catalog projections. |
| `plugins/workflows/src/server/validation/` | Graph, binding, schema, and destination validation. |
| `plugins/workflows/src/server/runs/` | Admission, persisted limits, invocation identity, reads, cancellation, and recovery. |
| `plugins/agents/src/server/delegation/` | Reference for signed caller ownership and replay-safe tool calls. |
| `plugins/workflows/src/client/` | Draft review, invocation permission, run navigation, and desktop and terminal controls. |

Root starts and definition routes are device-only. This is deliberate: a root start creates fresh
authority and budgets, and database definitions are treated as owner-authored executable content.
Adding tools requires explicit agent admission and draft provenance. Do not remove the device guards
or forward a tool call using a privileged owner token.

Reuse feature-owned services beneath the routes. Core owns authentication and tool transport;
Workflows owns definition access, mutation, and execution decisions. Agents supplies a narrow
authenticated session lookup, without exposing its mutable store to Workflows.

## Tool contract

Names below are proposed public names. Register them through the contribution registry so HTTP and
Model Context Protocol share schemas, permissions, availability, and behavior. Descriptions and field
documentation teach the workflow sequence and constraints without requiring an installed skill.

| Tool | Risk | Input and result |
| --- | --- | --- |
| `workflow_catalog` | Read | Returns available step kinds and their forms, schemas, policies, and harness metadata. Page large catalogs. |
| `workflows_list` | Read | Accepts an optional search and cursor. Returns applicable definition references, source, revision or digest, signatures, publication state, and invocation readiness. |
| `workflow_get` | Read | Takes a definition reference and optional draft revision. Returns the scoped authoring projection, schemas, problems, revision identity, and navigation target. |
| `workflow_validate` | Read | Takes a candidate definition. Returns field-located structural and scoped reference problems; creates no resource and runs no step. |
| `workflow_draft` | Write | Creates a draft or replaces an agent-owned draft using its expected revision. Returns the ID, revision, digest, semantic diff, problems, and editor target. |
| `workflow_run` | Execute | Takes a published definition reference, the inspected executable digest, and typed inputs. Returns the run ID, status, effective limits, ownership receipt, and run target. |
| `workflow_read` | Read | Takes a permitted run ID and optional step or cursor. Returns bounded status, step summaries, declared outputs, diagnostics, and navigation targets. |
| `workflow_wait` | Read | Takes a permitted run ID, last observation, and timeout up to 30 seconds. Returns on terminal state, human attention, or timeout. |
| `workflow_cancel` | Execute | Takes an agent-owned run ID. Stops admission and propagates cancellation through the run tree; returns its durable state. |

Task, project, workspace, Node, and caller identity come from authentication. Inputs cannot substitute
those identities. A definition reference uses the shared workflow reference contract. It must resolve
in the caller's task checkout and project, including applicable workspace definitions.

List summaries expose input schemas and whether defaults exist, without exposing private defaults.
Inspect distinguishes draft from published content. A valid draft is still not executable. Catalog
discovery includes runnable roots with child steps; the authoring catalog's child-target filter must
not accidentally exclude them. Missing contributions remain visible as actionable problems.

Use the versioned workflow format, stable step IDs, typed bindings, named outputs, and configured
harness options. Return validation failures without silently changing an unknown kind into an agent
step. The calling agent performs authoring; these tools do not spend a second model's credentials.

## Draft behavior

`workflow_draft` writes only project-scoped database drafts and marks their agent origin. Each draft
records its creator task and signed session, optional source definition and base revision, and the
tool call that created it. The owner can open and edit it through ordinary workflow controls.

A caller can replace a draft it created. Editing another definition creates a separate proposed
draft with its source reference and a semantic diff. It does not overwrite the source's draft or
published pointer. A stale expected revision returns a conflict and the readable winning revision.

Structural input limits apply before saving. Semantically incomplete drafts can be retained with
problems, matching editor behavior. Validation, publication, and invocation remain distinct actions.
The owner reviews the exact revision and dependencies through the publication service. Publication
does not automatically grant agent invocation or create a schedule.

Read projections omit credentials and protected execution configuration using the authoring rules.
For a draft based on a source, preserve protected values by stable step ID and kind on the Node.
Do not accept redaction markers as executable values. Added steps that need owner configuration
remain incomplete until the owner supplies it. Agent-authored text carries untrusted provenance.

## Invocation authority

Enabling `workflow_run` in tool permissions permits use of the operation. A separate owner-approved
invocation policy identifies which published graph it may execute and under which limits. This
approval is needed because the root-start service otherwise constructs fresh execution authority.

The workflow editor provides **Allow agent invocation** for a published database definition or a
resolved file definition in one project. Review shows the resolved graph, executable step kinds,
harness choices, child definitions, input contract, and limits. The policy records an executable
graph digest and selected dependency revisions. Canvas positions and labels do not change that
digest. Executable changes invalidate approval. Repository configuration trust is checked separately.

The owner selects the permitted input parameters and limits. Fixed inputs can be bound by the policy;
caller-supplied inputs must satisfy both the definition schema and policy constraints. Disclosure
must include templated command, URL, or project fields whose inputs can change what the run does.

Policies require finite turn and wall-time limits and a finite number of successful starts per caller
session. The default start allowance is five, with one active tool-launched run per task checkout.
Token and cost ceilings can narrow execution further. Replayed starts consume no additional allowance;
completed and cancelled starts remain charged. Changing a grant cannot reset a session's spent allowance.

Invocation must identify checkout conflicts, including an active caller turn and another workflow
using the same folder. Reuse task checkout admission and report a conflict with the owning activity.
If a launch needs to hand off from its caller, persist that handoff and dispatch only after the
caller turn settles. Acceptance must cover this boundary before shared-checkout invocation ships;
a run count alone does not coordinate filesystem writers.

At admission, intersect the signed caller tool ceiling, tool permissions, invocation policy, and
definition limits. Persist the effective authority, deadline, and budgets before dispatch. A caller
cannot select autonomous posture, change harness settings, or widen limits in the start request.
Explicit owner policy chooses posture; the review states when it bypasses human gates.

Workflow-owned sessions cannot invoke these root-start tools in the first release. Hide
`workflow_run` for them and reject direct calls. Nested execution continues through declared child
workflow steps and their ancestor accounting. Read tools may inspect the caller's own workflow.
`workflow_cancel` refuses cancellation of that enclosing workflow or unrelated runs.

Revoking a policy blocks fresh starts and leaves admitted runs with their frozen authority. The
owner can cancel active runs explicitly. Retrying a failed run remains a device action, so a tool
cannot clear a safety rail or consume a replacement budget behind the owner's decision.

## Run lifecycle and replay

Persist a launch receipt before starting work. It binds the signed caller, task, logical tool-call
ID, definition identity and executable digest, input fingerprint, effective policy, and reserved run
ID. Use the MCP proxy's stable call ID; the agent cannot choose an owner identity or replay key.

A repeated call with the same identity and payload returns the same draft write or run. Different
content under the same call ID conflicts. A replay returns the admitted snapshot even if a definition
was edited afterward. A fresh call rechecks publication, trust, permission, policy, and inputs.

`workflow_run` returns after durable admission, without holding a request open until completion.
The response reports the runner's actual state; successful admission is not successful execution.
The tools introduce no queue position or second scheduler. A lost response after commit is recovered
through the receipt, including a Node restart between reservation and run creation.

Run reads and waits accept only runs launched by that session or the workflow containing the caller.
They do not enumerate other sessions' runs on the same task. Foreign and unknown IDs return the same
not-found result. Child summaries stay within the permitted run tree and follow task-confined read
rules; a child task ID does not grant access to its transcript or provider routes.

An ordinary turn ending or a wait timing out does not cancel the run. Aborting a read or wait ends
that request. An explicit owner stop of the launching session cancels its outstanding tool-launched
runs. Closing a client leaves execution on the Node. Restart uses workflow reconciliation and
retained invocation receipts, without manufacturing a second run.

Wait returns promptly at a gate, question, failure, or safety rail with a navigation target and
reason. It neither answers attention nor retries work. Agents should report the decision needed
and end their turn while a person reviews it. Long polling must not reserve workflow execution slots.

## Presentation, limits, and diagnostics

Tool results contain host-resolved editor and run targets using Acorn's navigation contracts. The
transcript renders **Open workflow** or **Open run** where supported. Desktop and terminal provide
the same review and invocation policy actions; a native dialog is not required. The draft is labelled
as agent-authored and retains its creator and source revision for review.

Use bounded pages with stable cursors, explicit truncation, and a selectable step or output for large
results. Proposed defaults are 50 list entries, 100 step summaries, and 64 KiB per tool response.
Keep validation and executable value limits aligned with the shared workflow and data contracts.
Do not truncate a value and represent it as a complete declared output. Prompts, transcripts, record
bodies, and provider payloads are excluded from summary responses. Authorized detailed output remains
untrusted data. Reuse the shared secret detector for projections, omit values with likely credentials,
and report the affected output as withheld rather than returning a fabricated schema-valid value.
This is a read projection; it does not add a publication approval flow.

Report missing publication, changed approval, required configuration trust, unavailable plugins,
input errors, revision conflicts, and exhausted limits as actionable domain diagnostics. Adapt them
to the common tool error contract. Audit draft writes, policy changes, launches, and cancellation
with caller and resource identities. Logs and telemetry omit prompts, input values, and credentials.

## Persistence and compatibility

Workflows owns draft provenance, invocation policies, and launch receipts in its plugin database.
Reuse immutable revisions, fingerprints, publication journals, and run invocation keys. Any additional
tables need generated migrations and reconciliation for partial cross-plugin operations. Do not
infer agent authorship or owner approval from a definition's name, task, or transport header.

No definition format change or read-time adapter is required. Policies live outside portable
definitions because consent belongs to the Node and project. Import, duplication, and publication
do not copy active invocation permission. A disabled Workflows plugin removes its tools. Earlier
Nodes simply omit them from discovery; clients report availability without a privileged fallback.

## Acceptance

Release requires these observable results:

- A managed Claude session and a managed Codex session discover the real catalog, create a typed
  draft, and open it in the editor. Harness, model, reasoning, goals, and For each settings survive.
- The owner edits and publishes an agent draft. No run starts before publication and invocation
  approval. Agent editing changes neither a published revision nor an already admitted graph.
- Concurrent owner and agent saves return a revision conflict. A lost draft-save response replays
  the same revision, and restarting the Node retains creator and source provenance.
- An enabled caller invokes an approved graph with valid typed inputs. The run pane shows the caller,
  effective limits, outputs, and lineage. Disabled execute permission or an absent grant blocks it.
- Changed executable content or dependencies requires renewed approval. Changed repository trust
  blocks a start. A replay still identifies the previously admitted run and charges its allowance once.
- Repeated transport calls and a restart between launch reservation and run creation produce one
  run. Reusing a call ID with changed inputs conflicts. Recoverable uncertainty stays visible.
- A workflow-owned session cannot start a fresh root, grant permission, publish, answer a gate,
  retry, or reprocess records through tool discovery or a direct call. Signed ceilings can only narrow.
- Foreign tasks, projects, drafts, and session-owned runs are inaccessible. Spoofed session headers
  fail. Cancellation reaches only the caller's launched run and its descendants.
- A gate or question wakes a wait promptly. Timeout and turn completion leave the run alive;
  explicit session stop cancels it. Both hosts navigate to the person-owned decision.
- Large catalogs, step lists, and outputs page or report bounds without losing required values.
  Secrets and protected configuration are absent from authoring projections and summaries.
- Five distinct successful launches exhaust the default session allowance, including after restart
  or grant replacement. Replay adds no charge. A second active launch against the same task checkout
  is refused with a link to the active run.
- An active caller or unrelated workflow cannot race a shared-checkout launch into filesystem writes.
  A retained caller handoff survives restart, and a caller that never settles cannot start the work.

Verify tool registry filtering, real Node routes, MCP schemas and call-ID replay, database reopen,
workflow admission and budgets, and desktop and terminal review through the isolated agent drivers.
Use tests for these boundary behaviors rather than mirroring helper implementations. Run lint,
Workflows and affected Node, Agents, MCP, client, and CLI suites, plus architecture checks.

Update [agent tools](../agent-tools.md), [MCP](../mcp.md), [workflow routes](../api-reference/workflow-routes.md),
[definitions](../workflows/definitions.md), [execution](../workflows/execution.md), and the workflow
security contract when the feature ships. The HTTP device guards and CLI semantics retain their
own owners; any intentional contract change must be documented there.

## Delivery order and rationale

First deliver scoped catalog and inspection projections, then recoverable agent drafts and owner
review. Deliver invocation policy, durable launch identity, and narrowed admission together before
exposing start. Finish bounded reads, waits, cancellation, and both-host acceptance.

The root-start restriction is the main implementation risk. Do not ship invocation by wrapping the
privileged start capability and planning to add accounting later. If owner review or admission cannot
be completed in a phase, ship discovery and drafting while leaving invocation unavailable.

The agent tools use the same graph and services as the editor. This keeps a workflow created in chat
editable by a person, preserves plugin validation, and gives execution one durable lifecycle owner.
