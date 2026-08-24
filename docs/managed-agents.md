# Managed agents

The agents plugin manages structured Claude and Codex sessions. It stores a durable normalized event
ledger and exposes the same session through the Agent Center, task Agent pane, HTTP routes, and live
WebSocket streams.

## Session model

A session belongs to one task and provider profile. It contains turns, normalized events, permission
and question requests, attachments, artifacts, usage snapshots, and lifecycle state. Each session
event has a durable sequence. HTTP pagination is the replay authority, and the WebSocket is the live
tail.

Session state changes and their event records are committed together. Once a turn has committed any
events, a restart never silently resubmits it. Reconciliation marks interrupted work and leaves an
explicit state for the owner to inspect.

A workspace-scoped list or search resolves the task ids first, through
`CoreServices.tasks.idsForWorkspace()`, then narrows this plugin's own tables to those ids. An empty
result narrows the answer to nothing rather than falling back to unfiltered, because unfiltered is
how a workspace-scoped read leaks another workspace's sessions into the caller's view.

## Harnesses

A harness is one agent acorn can manage. A driver adapts its protocol into the common session and
event model. A profile, meaning how to launch the CLI, resume it, and run it headless, is registered
into a core registry and used by terminal, agents, and workflows. A profile may be available for
interactive terminal use without a managed driver behind it, and `aider` is that case.

There are two driver tiers, permanently.

**Tier 1 is the generic ACP driver, and a harness is data.** One driver
(`plugins/agents/src/main/drivers/acpDriver.ts`), built from a launch spec: a command or a
package-relative adapter entry, arguments, an environment passthrough list, and a small block of
declared quirks. Everything downstream is shared, including the normalizer, the durable event ledger,
the transcript, and permission plumbing. This is the default path for a new agent and the only path a
loaded plugin can reach.

**Tier 2 is a native driver, first-party only, for what ACP cannot say.** Codex is the reason it
exists. Its app-server gives acorn `thread/fork`, `thread/compact/start`, `thread/archive`,
`thread/delete`, and per-turn model, effort, and permission settings, and ACP expresses none of them.
A native driver is written when a vendor protocol carries product value the generic driver cannot,
and it lives in plugins/agents with the rest of the first-party code. The registry has two doors and
the names are the point: `register(spec)` takes data, `registerNative(id, factory)` takes code.

Claude runs on tier 1 and Codex on tier 2, which makes the two of them the worked example of each.

**plugins/agents stays first-party.** It owns the stream and the surfaces, and a harness contribution
is a descriptor delivered to it rather than a fork of it. The contributing plugin describes the
spawn, and plugins/agents owns the child process, the session, and every byte of the transcript. That
is also why a data-only harness plugin needs no `exec` grant: it never spawns anything.

**The delivery seam.** A manifest's `harnesses` entries reach the node host like schedules and task
checks do. The composition root carries them on the loaded-plugin binding, and
`node-core/server/plugin/host.ts` resolves each adapter entry inside the contributing package, turns
each probe route into a call, and hands the result to `ctx.harnesses`. That facet forwards to the
`agents.harnessRegistry` capability plugins/agents publishes, resolved at delivery time and never
cached, so agents disabled means the same silent nothing every unmatched contribution gets, and
re-enabling redelivers. A harness package with no node bundle still gets a real plugin row, so it is
listed in Settings → Plugins and the owner can turn it off.

A harness names a program acorn will run, so it is disclosed under **Enforced** in the trust prompt,
honestly: the host spawns the declared command with the declared arguments and nothing else. The
whole spawn plus the environment passthrough is the grant key, so a version that swaps the binary,
changes its arguments, or widens the globs reads as newly requested.

**Ids are persisted, not displayed.** A harness id is stored as a session row's `providerId`, a
profile id as its `profileId`, and a workflow step's `profile`. Renaming one is a compatibility break
across every stored row. Built-in ids (`claude`, `codex`, `claude-code`) are grandfathered as bare
names, and a loaded plugin's harness id is namespaced by the host into `<pluginId>:<harnessId>`.

For the authoring contract, see harnesses in [plugin authoring](./plugin-authoring.md).

Each profile used to be its own workspace package, which read as an extension seam and was not one.
Everything that encodes provider knowledge, meaning drivers, normalizers, usage probes, and pricing,
was already inside plugins/agents, so a new profiles package bought a menu entry whose agent could
not run. The driver registry was the seam that had never been opened. The packages were not, and they
were folded back in.

**What ACP offers the client side is declined.** The driver answers no to `fs`, `terminal`, and
`mcpServers` at `initialize`. Each is worth adopting on its own merits and none of them blocks, or is
blocked by, harness contributions. `fs` would make the agent ask acorn to read and write files, which
is one audit point and the precondition for the agent and the worktree living on different machines.
`terminal` would put agent-run commands through acorn's process lifecycle and into the task's
terminal surfaces. `mcpServers` would replace per-CLI config-file registration with per-session MCP
carrying the task-scoped internal token.

The Node probes harness availability and usage on bounded intervals. Usage and pricing details are
displayed in the Agent pane; pricing overrides are local preferences and provider prompts/responses
are not stored by the model-provider plugin. Plan usage is per harness: the built-in CLI probes and a
contributed harness's `probes.usage` route feed one registry, and a harness with no collector shows no
usage section.

## Subagents

Both managed harnesses can delegate to a subagent, and a subagent is **not** a session. It cannot be
addressed, sent a turn, forked, or handed to a terminal, so making it a session row would be a lie in
every table that reads one. It is a projection instead: each session's row carries a `subagents`
roster, folded from that session's own `subagent` events by `recordEvent`, in the same transaction as
the event insert. The runtime already broadcasts a session row after every event it records, and agent
frames are pushed to every client rather than subscribed to per id, so the task sidebar's indented
sub-rows appear and settle live for every session in the task, not only the open one, and nothing extra
is fetched. The roster keeps every in-flight entry plus the last 20 settled ones; the full history stays
in the event ledger, which is what the transcript reads.

A subagent's own progress never touches its session's runtime state. Turn boundaries own that, and a
child that settles after its parent's turn completed — which Codex allows — would otherwise drag the
session back out of ready.

The two harnesses report a subagent very differently, and the roster shows what each actually sent
rather than a fixed set of columns with gaps in it.

| | Claude Code | Codex |
| --- | --- | --- |
| What a subagent is | a tool call, `Agent` (formerly `Task`) | a full app-server thread on the same connection |
| Registration | `_meta.claudeCode.toolName` | a parent-side `subAgentActivity` item |
| Roster key | the spawning tool call id | the child thread id |
| Live inner tool calls | yes, tagged `_meta.claudeCode.parentToolUseId` | yes, on the child thread |
| Live inner prose | no, the CLI does not forward it | yes |
| Live file changes | yes, the diff on the tool call | yes, the child's own patch updates |
| Live usage | no | the child's own `thread/tokenUsage/updated` |
| At completion | `_meta.claudeCode.toolResponse`: agent id, type, model, tokens, tool uses, duration | nothing extra |
| Terminal state | completed | idle, and still resumable |

Reading Claude's `_meta.claudeCode` namespace in the shared ACP normalizer is deliberate rather than a
harness quirk: another harness's namespace is simply absent, so the branch costs nothing, and a quirk
joins `HarnessQuirks` when a *second* harness needs one.

Codex needs real routing, and it is the highest-blast-radius code in that driver, because a child's
`turn/completed` on the parent path ends the parent's turn and a child's status flips the parent's
runtime state mid-turn. `drivers/codexChildRouting.ts` owns it, keyed on the root thread id the driver
learns from `thread/start`: anything naming another thread is that subagent's, registered on first
sight. That is stricter than passing an unrecognised thread through, and it is what makes the observed
ordering harmless — a child's traffic arrives *before* the item that names it. Routing asks which
thread a notification arrived on; naming asks what the item's `agentThreadId` says. Conflating the two
is how another implementation hung a session forever, because the wire reports `subAgentActivity` about
the root itself, from a child thread. An unknown method from a child goes to the parent, so a Codex
release that adds a notification degrades to "the parent sees it" rather than to silent loss.

Both routing tables are pinned against real captures in
`plugins/agents/src/main/drivers/testFixtures/`, not hand-written shapes: an extension field can only
be tested against what the harness actually sent.

## Client surfaces

- Agent Center aggregates sessions, search, provider health, attention, transcript import, and launch.
- The Agent pane shows the current transcript, composer, queue, context, requests, artifacts, and a
  same-task roster.
- A tool call is one card, no matter how many updates a provider sends for it. The event ledger still
  stores a row per update, which is what replay and any later timing question read; the transcript
  folds those rows by turn and tool id, so a command shows one panel whose status and output change in
  place. Output sits behind a disclosure toggle that is open while the call is running, and a call with
  neither output nor a path renders as a flat row instead, so no card opens onto nothing. A provider
  reports a status only when it changes, so an update carrying nothing but output leaves the last
  reported status alone.
- Usage folds the same way, one line per turn. A turn's last usage update can arrive after the turn is
  marked complete and so carries no turn id; it updates the line it belongs to rather than starting
  another. That is how a cost joins a line that started with only a context count.
- A subagent shows up twice: as one card in its parent's transcript, holding everything that subagent
  did, and as one indented row under its session in the task Agent sidebar. The card is seeded expanded
  while the subagent is working and collapsed if it had already settled when the card was first drawn,
  then stays where the reader puts it. Reactive expansion would instead slam the card shut the moment
  the subagent finished, which is when somebody is most likely to be reading it.
- A subagent's run renders through exactly the same cards as its parent's: tool calls, prose, reasoning
  and file changes all go through one `AgentEventCard`, so a contributed tool renderer works inside a
  subagent's run without knowing it is in one. A tool call belongs to whichever stream opened it, and
  every later update folds there wherever it arrives from, because a provider need not repeat the
  attribution on each one. Claude's adapter in particular tags a subagent's `tool_call` and its final
  `tool_call_update` and leaves the one in between untagged.
- What reaches a subagent's stream is narrower than its parent's, and it differs by harness rather than
  by choice: a Codex child sends prose, reasoning, tool calls and diffs, and its own status and token
  usage become the row rather than cards; a Claude subagent sends tool calls and diffs only, since the
  CLI does not forward a subagent's prose. A Codex child's plan is dropped, because `plan` carries no
  attribution and a child's plan is not the session's.
- Selecting a sub-row, or the card's own **Open**, moves the whole message window onto that subagent's
  run: the transcript renders the card's children as its top level and a header names the subagent, with
  the way back to the session's own stream. A complex child run does not fit in a box inside its
  parent's stream. The projection already builds the tree, so this is a choice of root rather than a
  second transcript, and the scroll memory keys on the view rather than the session so stepping in and
  out does not restore one list's offset onto another. Picking the session row in the sidebar comes back
  out. The composer is hidden while a subagent's run is showing: it only ever addresses the session, so
  leaving it there would read as a way to reply to the subagent, which neither harness offers. The draft
  is held per session outside the component, so stepping in and back does not lose typed text.
- Changing a provider config option — the model, the reasoning level, the permission profile — writes
  a row into the transcript, so reading back a session shows where the switch happened rather than
  leaving every later turn to be read under whatever the setting is now.
- Terminal handoff transfers an exclusive input-controller lease to a raw provider TUI. A managed
  session and a raw terminal cannot write the same provider session simultaneously.
- Notifications and the attention inbox represent requests that need the owner. Dismissing purely
  informational UI is client-local.

A session's lifetime is bounded by its task's. Sessions belonging to a task that is no longer active,
whether archived, cancelled, or hard-deleted with its project, are retired. They leave the live list
every glance surface reads (Agent Center, the Fleet stat, the attention inbox, the `sessions`
dashboard collection) and appear in the archived list instead. This is resolved when the list is read
rather than cascaded onto the session's own `archivedAt`, because removing a project deletes its
tasks outright and no cascade would visit those rows. A read that names a task id is exempt, because
the task pane is looking at that task.

## Context, files, and attachments

Context is assembled by the Node from registered task sections and sent as an immutable snapshot.
Attachments are validated, task-scoped, stored through the shared blob cache, and referenced by
session records. Artifacts are authenticated no-store downloads; provider paths and worktree paths
are revalidated against the owning task.

## Operations and failure

Only one turn dispatches per session. Workspace and provider ceilings bound concurrency.
The dispatcher is edge-triggered: it scans the queue when a turn is enqueued, when a provider starts,
and when a turn settles. A scan that starts nothing rescans when a call arrived while it was running,
because that call's turn cannot be in the snapshot the scan is working from, and the reconcile pass
runs one scan at boot. Without both, a turn queued at the wrong moment waits for an unrelated session
to finish a turn before anything looks at it again.
Cancellation, timeout, provider disconnect, and restart are explicit states. A live stream can be
lost without killing the provider process, and the client reattaches from the session sequence or
terminal replay tail.

A session reference the agent has forgotten is recoverable, not fatal. Agents keep their own session
stores and prune them, and Claude Code keys its store by working directory, so a checkout that moved
leaves the reference on the row pointing at nothing. When `session/load` comes back with the
protocol's resource-not-found code, the ACP driver starts a fresh provider session instead, warns in
the transcript that the agent cannot see the history above it, and lets the `session_metadata`
projection replace the dead reference. Rethrowing instead would fail the start on every attempt while
the queued turn waited for a dispatch that could never happen.

A provider's stderr goes to the node's log as a byte count, not to the transcript. The content is
withheld from both because it can carry credentials, and a count the reader cannot act on does not
belong in their conversation.

Shutdown runs in the order that cannot resurrect what it just stopped: cancel every pending
provider-reconnect timer first, since a live one would call `ensureSession` and repopulate a session
the shutdown is trying to end, then stop each live provider child, then flush the durable event
buffer's per-session timers, then stop the webhook delivery pump. All of it runs before the plugin's
SQLite file closes, because any of those steps can still write a final row. The plugin's `dispose()`
(`plugins/agents/src/node/index.ts`) runs this sequence and then clears its own capability bridges
explicitly, rather than relying on teardown order, so a second boot in the same process (as
`apps/node/src/service/runtime.test.ts` exercises) never serves a request through the first boot's
closed database handle.

Each session mints its own scoped internal token rather than sharing one environment record. See
credential handling in [the security doc](./security.md). The list of secrets to redact out of
provider messages and transcripts is therefore collected as sessions start rather than computed once.

## Source map

The main implementation is in `plugins/agents/src/node`, `src/main`, `src/server/routes`, and
`src/client`. `plugins/agents/src/main/index.ts` and the terminal plugin supply the process and
profile boundaries.
