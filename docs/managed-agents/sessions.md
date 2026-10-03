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

## Standing memory

Session admission reads Memory's optional `agents.standingContext.v1` capability and stores the
result as `config.standingContext`. The drivers send that snapshot again on resume, and a
configuration patch can't replace it. Claude gets it through `systemPrompt.append`, Codex through
developer instructions, and a contributed ACP harness through the first prompt.
[Notes and memory](../notes-and-memory.md#context-integration) has the contents and caps.

## Session model

A session belongs to one task and one provider profile. It holds turns, normalized events,
permission and question requests, attachments, artifacts, usage snapshots, and lifecycle state. Each
event has a durable sequence. HTTP pages are the replay authority, and the WebSocket is the live
tail. A state change and its event records commit together. Once a turn has committed events, a
restart doesn't resubmit it: reconciliation marks the work interrupted for you to inspect.

On the tail, each event goes out as an `agent:event` frame. The session row follows as an
`agent:session` frame only when the event changed something a client keeps, about one event in 30.
`runtimeEngine.ts` compares the row with the last one broadcast and ignores `lastEventSeq`,
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
`delegationSpawnId`, the `customAgent` snapshot, `toolCeiling`, and `mcpServers`, and can't add,
change, or remove them. Dedicated MCP selection can change the server list after it checks Settings.
A fork carries its source's identity and authority snapshots. `kind: 'workflow'` and the workflow
config marker both exclude a session from managed delegation.

## Roster reads

A workspace-scoped list or search first resolves task IDs through
`CoreServices.tasks.idsForWorkspace()`, then narrows the plugin's own tables to them. An empty answer
narrows to nothing. Falling back to unfiltered would leak another workspace's sessions.

Roster pages order by `updatedAt DESC, id DESC`. A reader that sends `cursorFormat=tuple-v1` gets a
`v1:<updatedAt>:<id>` cursor and seeks on both values, so pages continue after the anchor row is
deleted. Without the flag, the Node returns numeric cursors, which repeat or skip rows at tied
timestamps. The Node validates the cursor before it reads storage. Event pages keep their own
sequence cursor.

Pages read live rows, not one snapshot across requests. For unchanged rows, tuple pages visit each
match once. An edit between pages can move a row across the cursor, so refresh the roster to see
edits.

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

## Where the code is

`runtime.ts` coordinates session commands with the provider engine, `sessionTitleGeneration.ts` owns
titles, `sessionDefaultsCommands.ts` applies saved options, `transcriptCommands.ts` imports, verifies,
and exports transcripts, and `sessionWait.ts` checks frames against durable wait facts. Wire types are
in `plugins/agents/src/contract/wire.ts`.
