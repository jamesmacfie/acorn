# Sessions

A managed session is one structured conversation with a harness, owned by the agents plugin. This page
covers who may control a session over HTTP, what a session holds, how its rows reach clients, and how
it gets a title. The runtime is in `plugins/agents/src/server/sessions/`.

## HTTP control authority

The paired desktop, terminal client, and headless CLI act with device authority. These actions need a
device principal: create a session, import a transcript, change configuration, delete, create or edit
a turn, implement a plan, fork, compact, generate a title, hand off to a terminal, resume, verify an
imported resume, and resolve a request. Service and task credentials get `403` before the runtime
runs. A task credential can't answer its own permission, question, or elicitation request for a
person.

Task credentials keep task-scoped session reads, event replay, search, export, wait, attachment and
artifact reads, and cancellation. An unknown or foreign ID gets `404`. The `/runs` source is
Node-wide and accepts device and service callers, and task callers use the filtered core run list.
Managed delegation and workflows call guarded capabilities and the runtime directly. None of these
HTTP rules replace tool permissions, signed ceilings, or delegation admission.

The host resolves turn attendance. Turn HTTP bodies cannot set `attendance` or `posture`, and
`effectivePolicy` cannot set `attendance`, `initialAttendance`, `posture`, `followUpOf`, or
`continuationOf`. Workflow execution and plugin follow-up admission pass their origin through
host-only contracts. A caller's session configuration cannot override `initialAttendance`.

## Standing memory

Session admission reads Memory's optional `agents.standingContext.v1` capability and stores the
result as `config.standingContext`. The drivers send that snapshot again on resume, and a
configuration patch can't replace it. Claude gets it through `systemPrompt.append`, Codex through
developer instructions, and a contributed ACP harness through the first prompt.
[Notes and memory](../notes-and-memory.md#context-integration) has the contents and caps.

The snapshot never changes, so the system prompt and its prompt cache survive. Before each dispatched
turn, Agents calls the capability's optional `current(taskId)` and compares its index entries with the
last ones the session was told: `config.standingContextTold`, or `config.standingContext` before the
first change. When entries were added or removed, one context part with `contextId: 'memory'`, source
`context.memory`, and the label **Memory changes** rides ahead of the turn. It lists the new lines under
"Added or updated" and the old ones under "No longer in the index", so an edited description shows
both. Once the turn has run, Agents writes `standingContextTold` and records one transcript line, such
as "Memory changed since the last turn: 2 added, 1 removed." A failed turn writes nothing, so the next
turn carries the same part. A configuration patch can't set `standingContextTold`, and a new session
starts without one. `current` returns `null` when the person switches the setting off, so no part or
line appears. Switched on again, the next part covers everything the session missed.

## Session model

A session belongs to one task and one provider profile. It holds turns, normalized events,
permission and question requests, attachments, artifacts, usage snapshots, and lifecycle state. Each
event has a durable sequence. HTTP pages are the replay authority, and the WebSocket is the live
tail. A state change and its event records commit together. Once a turn has committed events, a
restart doesn't resubmit it: reconciliation marks the work interrupted for you to inspect.

Reconciliation runs after the Node starts listening, and it gives the event loop a turn between steps
and every 50 sessions, so reads answer while it runs. A session it hasn't reached yet reads as working
until its new row arrives. Every write to the session routes waits for it to finish, so a prompt sent
at launch can't reach a session that reconciliation is about to stop.

On the tail, each event goes out as an `agent:event` frame. The session row follows as an
`agent:session` frame only when the event changed something a client keeps, about one event in 30.
`sessionFrames.ts` compares the row with the last one broadcast and ignores `lastEventSeq`,
`updatedAt`, each subagent's last-heard time, and `config`. A `session_metadata` event always sends
the row, because it's the event that writes `config`. Rewriting the roster on every event woke every
reader about 25 times a second. The pane's read mark needs the live sequence, so it reads
`managedAgentStore.lastEventSeq(session)` from the event frames.

`kind` is `interactive`, `workflow`, `delegated`, or `imported`. A workflow session's `config` carries
`workflowRunId` and `workflowStepId`, which three places read:

- The pane header draws a "Workflow: <name> · <step>" chip that opens the run pane at that node
  ([the run pane](../workflows/routes-and-ui.md#the-run-pane)). The names come from the workflows
  plugin's `WORKFLOW_CONTROL.runForSession`, so with workflows off there's no chip.
- The sidebar row draws the workflow glyph beside the provider mark.
- The Agent Center row draws a **Run** chip from the two IDs
  (`plugins/agents/src/client/center/workflowRun.ts`).

The run pane also uses the IDs to find a running step's session, before the step row records its
`agentSessionId`. A configuration replacement keeps `workflowRunId`, `workflowStepId`,
`delegationSpawnId`, the `customAgent` snapshot, `initialAttendance`, `toolCeiling`, and `mcpServers`, and can't add,
change, or remove them. Dedicated MCP selection can change the server list after it checks Settings.
A fork carries its source's identity and authority snapshots. `kind: 'workflow'` and the workflow
config marker both exclude a session from managed delegation.

## Roster reads

A workspace-scoped list or search first resolves task IDs through
`CoreServices.tasks.idsForWorkspace()`, then narrows the plugin's own tables to them. An empty answer
narrows to nothing. Falling back to unfiltered would leak another workspace's sessions. The
cross-session tools do the same with `CoreServices.tasks.inProject()` for the caller's project
([cross-session reads](./cross-session-reads.md#who-can-read-what)).

Roster pages order by `updatedAt DESC, id DESC`. A reader that sends `cursorFormat=tuple-v1` gets a
`v1:<updatedAt>:<id>` cursor and seeks on both values, so pages continue after the anchor row is
deleted. Without the flag, the Node returns numeric cursors, which repeat or skip rows at tied
timestamps. The Node validates the cursor before it reads storage. Event pages keep their own
sequence cursor.

Pages read live rows, not one snapshot across requests. For unchanged rows, tuple pages visit each
match once. An edit between pages can move a row across the cursor, so refresh the roster to see
edits.

A list or search row carries `listRow: true` and leaves out what only an open session reads: the
slash commands and skills the provider advertised, the standing context, and every config option
value but the chosen one. That keeps a 50-session page under 100 KB, where whole rows run to megabytes.
`sessionListRow` in `plugins/agents/src/shared/sessionList.ts` makes the row. The session's own read,
`GET /sessions/:id`, and its `agent:session` socket frames carry the full row. When a list row is the
newer of two, the client keeps the detail the full row brought (`newestManagedSession`). Settings and
the inline diff card read each provider's choices from the providers answer, which the Node fills from
the newest session that advertised them.

## Titles

A session starts as `New agent session`. Its first accepted turn replaces that with a label from the
first non-empty text part, or the first attachment's filename, so naming doesn't block the turn. For
a first interactive text prompt of five words or more, the runtime then asks the same profile for a
shorter title in the background. That run has tools off, works in an empty temporary folder, sees
only the text left by the `before-send` hook, and stops at 30 seconds. Workflow, delegation,
automation, import, attachment-only, short, repeated, and later turns don't get a generated title.

The generated title replaces only the exact fallback, so a rename wins whenever it lands. A restart
doesn't regenerate a title. **Regenerate title** reads the first durable text prompt, asks the
profile again, and compares against the title current when it started, so a rename during the run
still wins. A failure leaves the title and adds nothing to the transcript. The runtime runs one title
call per session. Deleting a session aborts and joins that call first, and shutdown joins every one
before the database closes.

## Run summaries

Choose **Summarize run…** from the session menu or the command palette's **Agent session** group.
Add optional context, choose a backend and model with the sparkle picker, and press **Generate Markdown**.
The dialog expands during generation and shows read-only Markdown with **Copy Markdown** and
**Generate again**. The model choice shares the device's Generate preference.

`POST /v1/p/agents/sessions/:sessionId/summarize` requires a device credential. It accepts `backendId`,
optional `modelId`, and `context` of up to 10,000 characters. The Node captures the durable session
after flushing buffered events, then generates through `CoreServices.models`. It returns `markdown`,
`truncated`, and `throughSeq`, the last event sequence in the capture. Generation adds no turn and
changes no session state. The provider deadline is three minutes. Closing the dialog aborts the
client request; runtime shutdown also aborts generation.

The prompt includes turn inputs and statuses, assistant messages, tool names and statuses, plans,
file changes, and errors. It excludes raw tool output and attachment contents. Above 120,000
transcript characters, it keeps the first 30,000 and last 90,000, marks the omitted middle, and tells
the model to disclose that limit. The dialog also reports truncation. A running agent can continue
while the summary describes the captured point in its history.

## Where the code is

`runtime.ts` coordinates session commands with the provider engine, `store.ts` owns the session
tables, `sessionTitleGeneration.ts` owns titles, `sessionDefaultsCommands.ts` applies saved options,
`transcriptCommands.ts` imports, verifies, and exports transcripts, and `sessionWait.ts` checks frames
against durable wait facts. Wire types are in `plugins/agents/src/contract/wire.ts`.
