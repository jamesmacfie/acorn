# Workflow routes and UI

This page covers the run pane on a task, the frames it listens to, and how other surfaces point at a
run. The client is in `plugins/workflows/src/client/`.

## Routes and UI

Node routes are under `/v1/p/workflows/`, and core task run-target routes are under
`/v1/core/tasks/:id/run/*`. Both clients draw the Workflows rail source and its editor
([authoring](./authoring.md)), the run pane, a Settings page listing what a task's checkout would load,
three palette rows, gate controls, and attention items ([starting runs](./starting-runs.md)). Workflow
notices use `/v1/events`, and durable run history is paged from the plugin database.

## The run pane

A task with at least one run has a **Workflows** pane
(`plugins/workflows/src/client/runs/paneContribution.ts`). It is `list-detail`: the task's runs
newest first, then the selected run's steps, and one step's detail beside them. The pane is hidden on
a task that has never run a workflow, so the pane strip does not grow a button for every task; which
tasks those are is one node-wide read the plugin keeps in memory (`runs/runStore.ts`).
Every client-side start marks its task as soon as the node confirms a run ID. Opening a confirmed run
from the recent-run list or a schedule does the same before navigating, so the pane is available while
the node-wide read catches up. A read started before the confirmation cannot clear that hint.
Every way into a run (a recent-run row, a schedule's **Open run**, and **Run…** in the editor or the
start dialog) goes through `openWorkflowRun` in `runs/runStore.ts`, which activates the task with the
Workflows pane showing before it navigates: the shell draws what the rail source says, not the address.

**List | Graph** in the Runs header picks how the steps are drawn: as the list, or as the same
picture the editor authors on, coloured by status. The choice is remembered per device. The run's
graph has no ports and nothing to drag: a run froze its definition when it started, so an edge here
is a record.

The step list is the editor's list, and names each step by its name; the id is only the key. Both call `graphOrder` in
`plugins/workflows/src/client/editor/graphOrder.ts`, over the definition the run froze when it started, so
the indentation in the run cannot disagree with the indentation in the editor. Only a fork indents:
a branch target, or a node that waits on more than one step. A node that waits on
more than one step carries the same `⇐ n` mark. A dispatched child is a row under the step that
spawned it.

The detail depends on the kind and the status:

| Kind | While running | When done | Controls |
| --- | --- | --- | --- |
| agent kinds | the conversation: transcript, queue and composer | the same conversation, and the structured value under a disclosure | Show in Agent pane; Stop step |
| `terminal:command` | the streamed tail | exit code, duration, the whole output under a disclosure | Stop step |
| `terminal:run-target` | "Starting…" | the URL | Open terminal |
| `database:*` | "Reading…" | a table of the rows and the SQL behind it | none |
| `http:request` | "Sending…" | the status, the headers under a disclosure, the body | none |
| `gate-human` | "Waiting for you", or the form filled with its proposal, each changed field marked **Edited** with **Reset** | approved, or the state it reached; with a form, the approved values with edits marked | Approve; Reject |
| any, `failed` or `safety-rail` | | the error | Retry; Edit prompt and retry, for an agent kind |

Every control sits in the step's header bar, except a gate's **Approve** and **Reject**, which sit
under what they approve. **Reject** fails the run, so it asks "Reject?" first. Statuses read as words
(**Needs you**, **Stopped at a limit**) from `statusLabel` in `runs/runDisplay.ts`, and a contributed
kind is named from the node's catalog. The footer is the run's status, cost, and tokens, with
**Cancel run** while the run is live.

A step whose harness session was captured but that never became a managed session offers **Open in
terminal**, which resumes it. A step given its own
task links to it. Every control is drawn only when its transition is legal and disabled while one is
in flight, so a stale button is a race rather than a bug.

A single child-workflow node shows its child summary. A workflow-map node instead shows compact
progress and a virtual record table, fetched in pages of at most 100 rather than one card per child.
Filtering and selection survive event refreshes. Selecting a row loads its frozen input, provenance,
bounded outputs, and paged attempts on demand. Its task and run links retain the root run and record
return route; a missing or archived task leaves the record history readable. Selecting a child run
shows explicit parent and root links. Root-run footers report aggregate tree usage; child-run footers
report only that run, so the same provider turn is not counted twice. The cancel confirmation says it
cancels the run tree, and retry explains that it reuses the exact existing attempt.
The admission ledger supplies run totals in both the task run list and these footers. Step costs remain
visible on individual steps. A run with no admitted usage has no reported total; an admitted turn with
no priced usage still appears as a turn without an invented dollar amount.

**The conversation is here.** An agent node draws the transcript, the queue and the composer that the
Agent pane draws, because reading what a step is saying should not mean leaving the run. It is the
same three components over the same session: plugins/agents publishes them as a client capability
(`plugins/agents/src/contract/conversation.ts`) and this pane renders it, so the two surfaces cannot
drift. A node with the agents plugin switched off answers nothing and the pane keeps the summary it
drew before: the harness, the model, and what the step last said.

A step that ran headless has no session and never will, so the pane says which of the two reasons it
is: that the step has not started, or that it runs outside a managed session and its output is under
**Step details**. Those words are the run pane's, passed to the conversation, because the conversation
knows a session is missing and not why.

The agent shape is a different arrangement, not a different pane. The controls move into the toolbar
and the harness, the structured value and any events a handler emitted fold away, because the
conversation's timeline owns the scroll and takes the height that is left
([pane layouts](../panes/layout.md)). Every other kind keeps the column it had.

Naming the step is what makes it work while the step runs. The row records its `agentSessionId` in the
completion write, so the pane passes the step id as well and the agents client resolves the session
from `config.workflowStepId`, which the node writes when it creates the session. The step row also
takes the id from the first event that names it, which is what the Agent pane's chip reads.

Typing here is allowed and says so. A step waits on its own turn and nothing else, so a turn sent
while the step is working queues behind it and runs once the run has already recorded the step as
done. The composer carries that sentence above it rather than being disabled, because answering an
agent mid-step is a reasonable thing to want and being told what happens is better than being
stopped.

## What the pane listens to

Four frames of its own, and each one costs what it should:

- `workflow:step-changed` moves one node's glyph and reads nothing.
- `workflow:step:event` appends to the selected run's per-node tail, capped at 200 events and the
  last 4,000 characters of output.
- `plugin:workflows:run-changed` re-reads the run and its steps, because a run beginning or ending
  changes rows this client never saw.
- `plugin:workflows:child-changed` re-reads the parent and child summaries after a durable dispatch
  transition.

`plugin:workflows:run-changed` is the public run lifecycle, not merely a start/finish hint. It carries
`{ taskId, runId, status }` after the run's full step roster is readable and after every real durable
transition through `running`, `gated`, `cancelling`, `done`, `failed`, `safety-rail`, or `cancelled`.
One `setRun` mutation funnel compares old and new state, so retries and terminal completion cannot
drift into separate event semantics.

At a terminal run status, Workflows also emits `plugin:workflows:completed` with task and run IDs,
status, and completion time. The event remains public for lifecycle consumers. Handoff notes remain
owned by Notes.

Events remain invalidation hints. The run pane and its task-run index re-read after reconnect, so a
missed child, run, or gate frame cannot leave durable state stale. These resources are mounted inside
the active Node's client partition; identical task and run IDs on another Node do not share state.

Human approvals have the narrower `plugin:workflows:gate-changed` frame. It names task, run, step,
and the current `waiting-gate`, `done`, `failed`, or `cancelled` state only when entering or leaving
the gate. Node-side consumers re-list pending gates through `workflows.gates`; ordinary workflow
steps remain on the owned stream and never become cross-plugin events.

An agent node adds the agents plugin's own subscription, which is a session's event stream at about
25 frames a second ([the transcript store](../managed-agents/transcript-store.md)). That is the
conversation's cost and it is paid by whichever pane is drawing one; the socket is refcounted, so two
panes open on one session share it.

## Getting there from somewhere else

The pane intent `{ kind: 'workflows:show-run', runId, stepId? }` is how everything else points at a
run: a bell row, an inbox row, the rail's recent runs, the agent pane's chip, and the **Run** chip on
a workflow session's row in Agent Center. The deep link
`/t/:taskId?pane=workflows&item=<runId>` is the same thing with an address.
