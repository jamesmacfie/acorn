# Running child workflows

This page covers what a run reports, where a file definition comes from, the tasks child workflows
run in, and how clients refresh a run. [Workflow execution](./execution.md) covers the runner.

## What a run reports

A run raises a `workflow.run` span and each of its steps a `workflow.step` span, both through
`ctx.telemetry`, both owned by this plugin, and all of them in one trace, so a slow step is found
from the run rather than from a list of unrelated spans
([telemetry.md](../telemetry.md) § Ambient attribution). The run span carries the run id, the trigger
and the step count; a step span carries the run id and the step id. Nothing carries a prompt, a
result or a handoff note.

The run span opens where the row is written in `start` and closes in `finishRun`, so it measures
what the owner would call the run's duration. A step's span brackets its own status changes rather
than the `execute` call, because a step settles at a dozen places in `execute` and two of them never
run it at all. A step waiting at a gate keeps its span open, which is right: waiting for a person is
part of how long the step took.

A run still going when the process exits reports no span. Nothing measured how long it took, and a
span invented on the next boot would say otherwise.

## Where a file comes from

Workflow files load from the repo checkout or worktree and layer over `~/.acorn/workflows` the same
way `config.toml` layers repo before user, so a repo-defined id wins over a user one. Database rows
sit under both, as § Database definitions describes. A step can
reference another workflow by id. The reference expands inline, one level of nesting, and a chain
that revisits an id is rejected as a cycle rather than followed into a hang. A malformed file
surfaces as an error row instead of being skipped silently. A sub-workflow's steps are prefixed with
its id, and so are the `after` IDs inside it, so an expanded block keeps its own shape
inside the outer graph.

## Child workflow tasks

`workflow` starts one saved workflow in a child task. `workflow-map` with `childWorkflow` reads an array from a structured
predecessor and starts one child task for each item. Before a root run starts, the Node resolves every
database, repository, and user reference in the task's project scope. It validates the supplied or
defaulted child inputs, applies repository trust, and freezes the resolved graph with the run. An edit
to a referenced definition therefore affects a later root run, not one already in progress.

Each dispatch is recorded before it creates a task or starts a run. The record holds a stable caller
key and payload fingerprint, reserved task and run IDs, explicit root and parent lineage, and its
progress from reservation to terminal state. A retry or restart resumes that record. Repeating the
same request returns the same task and run; reusing its key with different content fails. The graph
permits four child-workflow levels below the root and rejects recursive references before admission.
`maxDescendants` defaults to 100 and accepts values from 1 through 500. Every nested child counts
toward that root limit. An oversized roster reserves and dispatches nothing. A later nested admission
can reach the same limit; that step stops at a visible safety rail while admitted siblings settle.

A child-workflow step waits without taking an agent execution slot. A mapped step keeps source order,
uses the configured JSON Pointer as the stable item key, and records each child's task ID, run ID,
status, bounded result, failure, and provider usage. An empty array succeeds. When results are mixed,
the parent waits for every admitted child and persists `completed-with-failures`. That step's typed
output remains available to downstream summaries and conditions. A successful summary does not hide
unresolved child failures in the root outcome. A child gate puts the parent in `gated`; approval
still happens in the child run, and independent siblings continue.

Four agent turns can execute concurrently on the Node. A root can lower its limit with
`maxConcurrency`, from 1 through 4. Waiting parents, gates, and data reads consume no agent slot.
The semaphore skips saturated roots without holding Node slots for their queued work.

Cancellation stops new admissions, cancels descendant runs and managed sessions, and settles the
root only after admitted children settle. A failure in another branch applies the same cleanup
before the root becomes failed. Child tasks stay active, and their worktrees remain as ordinary task
history. Retrying a dispatch step reuses the saved child roster and does not create replacement
tasks. Tool ceilings, provider-turn limits, cost, token limits, and the absolute deadline are
intersected down the tree. Usage is admitted once against the root and every ancestor's subtree
budget, and remains charged across retries. An explicit failed-child retry reopens its ancestor
dispatch path and reuses the task, run, roster, and frozen graph. Successful siblings are not rerun.
The original absolute deadline still applies. A restart keeps unknown-usage turn reservations counted.

The editor's **Ask AI for a list, then run each** shortcut inserts a structured agent plan and a For each
step as one undoable draft edit. Configure its item agent in the inspector, or select **Child workflow**
and bind the saved workflow’s inputs. The
plan declares stable item IDs and accepts an empty array. Removed execution kinds receive an upgrade
diagnostic; they do not execute. Ordinary graph convergence uses `after` edges.

This replay protection is limited to one root run. Starting a fresh root can process the same
business item again; cross-run business deduplication is deliberately not part of workflow dispatch.


## Agent sessions for each item

For each can run an agent directly with `agent` instead of `childWorkflow`. Each item gets a
separate managed agent session in the parent task’s folder and branch. It creates no child task or
worktree. Sessions run sequentially in source order. The prompt receives the complete current item
as a **Current item** context part, alongside the parent task context. It uses plain text rather
than item template expressions.

The agent configuration accepts `prompt`, `profileId`, `model`, `configOptions`, an optional
structural result `schema`, and `onFailure`. Harness, model, reasoning effort, and other advertised
options use the same controls as an ordinary agent step. Only harnesses with managed sessions are
accepted. The Agents plugin must be enabled; this target fails if session execution is unavailable.

`onFailure` defaults to `continue`, which runs the remaining items and reports partial failures.
`stop` retains the remaining items as cancelled, without starting their sessions. Cancellation stops
the active session and queued items. Files already edited stay in the parent folder.

Each item uses a frozen, terminal one-agent run internally so dispatch reservations, usage budgets,
record history, cancellation, and retry retain one lifecycle owner. These runs appear through item
history rather than as separate entries in the task’s workflow list. The ordered `children` output
includes each item’s status, `agentSessionId`, `result`, error, and declared outputs. Item history
has **Open session**, **Open item run**, and **Retry attempt** actions. Retrying a failed attempt
reuses its session and frozen item; successful items remain done. Retry and **Run again** reject an
item while another item session is active in the task.

After a restart, an item whose agent was running becomes failed with an interruption message.
Queued items are cancelled. Review the session and working tree before retrying the interrupted
item or using **Run again** on an unstarted item. Recovery never automatically sends another turn
to an interrupted session.

## Client run refreshes and live output

A run pane captures the Node from its QueryClient. Each run-list and selected-step read has one
active snapshot and a dirty follow-up flag. An invalidation during the follow-up schedules another
read. Commands wait for a snapshot taken after the command. Step-status frames update the displayed
row without fetching and survive a snapshot that started before the frame.

The selected run owns live events, command tails, and status edges. Selecting another run retires
those dictionaries. Unsent gate form fields retain the pane model lifetime across selections. The host retains one task model per pane and retires it with the task or Node shell. Returning reads
the durable step results, including full
canonical command output. The command tail holds the exact last 4,000 characters of stdout and
stderr together. Stream chunks do not also occupy the generic event ring. Other event types,
including managed-agent and unknown events, retain the 200-event window. The detail view reports how
many earlier events left that window. These display limits do not shorten durable results or events
sent to other consumers.
