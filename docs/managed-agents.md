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
- A provider draws as its own mark wherever it is named: the onboarding cards, the New picker, each
  block in Settings -> Agent defaults, and the session icon in Agent Center. The name comes off the
  descriptor's `glyph`, so a contributed harness gets the same treatment by pointing that field at a
  mark it registers. The two built-in ones are `brand:agents/claude` and `brand:agents/codex`, drawn
  by `ProviderGlyph.tsx` and coloured from the mark (docs/ui-design.md section Brand colour). The
  colour is mixed toward the theme's foreground rather than used raw, because a brand hex is authored
  against white and OpenAI's purple is unreadable on a dark pane.
- The Agent pane shows the current transcript, composer, queue, context, requests, artifacts, and a
  same-task roster.
- Starting an interactive session acknowledges the durable row before waiting for the provider CLI.
  The pane selects that row immediately, draws a **Connecting…** state above the composer, and keeps
  the draft editable while Send and provider configuration remain disabled. `ready` is published only
  after the provider handshake, session metadata, and saved new-session defaults have all settled, so
  the first turn cannot race the model or reasoning settings it is meant to use. Workflow creation
  keeps its ready-on-return contract because its caller has no draft UI to occupy the wait.
- A tool call is one card, no matter how many updates a provider sends for it. The event ledger still
  stores a row per update, which is what replay and any later timing question read; the transcript
  folds those rows by turn and tool id, so a command shows one panel whose status and output change in
  place. A call's parameters and output sit behind a disclosure toggle, and a call with nothing to show
  for either renders as a flat row instead, so no card opens onto nothing. A provider reports a status
  only when it changes, so an update carrying nothing but output leaves the last reported status alone.
- Whether that toggle starts open is the reader's setting, **Tool call display** in Settings -> Agent
  defaults: start collapsed, start expanded, or carry the reader's last toggle forward. It is a device
  preference (`agent_tool_fold`), so it sits on that page beside settings the node keeps. The default is
  collapsed, which means a running command's output no longer scrolls into view unattended.
  `AgentToolCallCard` resolves the setting once and passes `defaultOpen` and `onOpenChange` to whichever
  renderer draws the call, so a contributed renderer honours the setting and trains the carry-forward
  mode without reading the preference itself.
- A card seeds that state at mount and then leaves it alone. Read reactively it would shut the card the
  moment its call finished, which is when somebody is most likely to be reading it.
- The setting, and not the call's reported status, is what decides this. Status was what used to make
  the answer differ by harness with nothing in the product saying so: Codex reports a started call as
  `running`, while the ACP path reports `pending` and then `completed` and never `running` at all, so
  one provider's cards opened themselves and the other's never did. For the same reason the ACP path
  maps a call's `rawInput` into the card as pretty-printed JSON. Output only lands on the completion
  update there, since Acorn declines ACP's terminal capability, so without the parameters a running
  Claude call had nothing to disclose and could not honour the setting until it was over.
- A plan update is a complete snapshot. Every snapshot remains in the durable ledger, while the
  transcript folds snapshots from one turn into the card the first one opened; a new turn starts a new
  card. Each step has one structured status marker and renders its text through the transcript Markdown
  policy, in a status-and-text grid that keeps wrapped lines inside the card.
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
- The composer draws `@file`, `/command` and `$skill` each in its own theme colour
  (`--mention-file`, `--mention-command`, `--mention-skill`). A textarea cannot colour part of
  its own value, so a `<pre>` mirrors the draft over it and the textarea's own text is transparent;
  the two share every property that decides where a glyph lands, and above 20,000 characters the
  mirror is dropped and the textarea paints itself. A command or skill is coloured only when the
  session advertises that name, so `9/11` stays prose and a misspelled `/reviw` stays visibly plain.
  File mentions come from the same walk that builds the turn's file parts, so what is coloured is what
  is sent.
- Typing any of the three sigils opens the same dropdown: `@` lists worktree files, `/` the commands
  and `$` the skills the session advertises. Rows are `PickerRow`, the row the context picker draws,
  so a name sits over its description rather than sharing a line with it. The list scrolls once it
  passes 280px, and the arrow keys scroll it themselves rather than calling `scrollIntoView`, which
  would be free to scroll the transcript behind the composer as well. Only `@` waits on a fetch, so a
  command list that arrived with the session is never held behind the worktree walk. The `＋` picker
  still inserts the same tokens for anyone who would rather browse than type.
- Hovering a coloured command or skill shows its description, through the app's `data-tip` tooltip.
  The mirror is inert except for those spans, which take the pointer and hand the caret straight back
  to the textarea on mousedown, so clicking a token still puts the cursor where it was clicked.
- ⌘⇧↩, or the expand button in the corner of the box, lays the composer over the detail column at full
  height, which is the same chord the shell uses to maximise a pane and the nearest meaning it has
  while the caret is in a textarea. It is not a registered keybinding, because a task-scoped binding
  never fires from inside a typing target and a rebindable row that did nothing would be a lie. The
  transcript is covered rather than collapsed, so it keeps its scroll position, and the state is
  session-only and per composer.
- Changing a provider config option — the model, the reasoning level, the permission profile — writes
  a row into the transcript, so reading back a session shows where the switch happened rather than
  leaving every later turn to be read under whatever the setting is now. The switch also becomes the
  default the next session starts on, described under New-session defaults below.
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

Archiving is the only way the UI retires a session. Both the pane header's menu and the three-dot
menu on each row in the task's session list offer rename, archive, and, while the agent is running,
stop; archive asks first. The delete route still exists for a caller that means it, but it is no
longer a menu item one click away from a transcript that cannot be recovered.

## New-session defaults

A new session starts on the settings the owner last used, not on the provider's own choice. Switch
Codex to a higher reasoning effort in one session and the next Codex session starts there.

Nothing in this is per-provider. A provider already advertises its options as `AgentConfigOption[]`
when a session starts, so a default is a value keyed by the provider id and the option id it came
from. A harness added later is defaultable the moment it advertises anything, and a new kind of
option, a fast mode say, needs no change on the acorn side to be remembered.

One `prefs` row (`agents:session-defaults:v1`) holds three fields. `followLastSession`, on by
default, decides which of the other two applies. `last` is written by the runtime whenever a session's
option changes, and `pinned` is written by the owner under Settings > Agent defaults. Neither writer
sends the other's field, and the write merges server-side, so the Settings page cannot flatten a
switch made while it was open.

Both halves hang off `ManagedAgentRuntime`, which is where every path that opens a session and every
path that changes one already meets:

- Applied in `createSession`, after the driver has reported `session_metadata`. That is the first
  moment there is an advertised option list to validate a stored value against. A value the provider
  no longer offers is dropped rather than sent, so a model retired between two sessions cannot wedge
  every later start, and a provider that refuses the switch gets a warning row in the transcript
  rather than failing the session the owner just opened.
- Remembered in `patchSession`, which is the one method a config change goes through whether the
  composer sent it or an automation did. Only the options that actually changed are stored, so a
  provider default the owner never touched stays a provider default.

Interactive sessions only, and not a fork. A workflow step names the model it wants in its own policy,
and a fork continues the session it came from at the settings that session was running.

Settings reads the option list to draw pickers off the newest session that advertised one, because a
provider reports its models and reasoning levels only once a session is running. A provider you have
not run inside the 50 most recent sessions shows no pickers until you run it again. Each pick is the
save, as everywhere else under Settings: there is no save button, and a write that fails says so and
refetches the stored row.

The same page carries one setting that is not a session default and does not travel with the node:
**Tool call display**, under a Transcript heading, which is a device preference about how a transcript
draws its tool cards (section Client surfaces). It is there because that is where somebody looks for
it, not because it shares a store with anything above it.

## Context, files, and attachments

Context is assembled by the Node from registered task sections and sent as an immutable snapshot.
Attachments are validated, task-scoped, stored through the shared blob cache, and referenced by
session records. Artifacts are authenticated no-store downloads; provider paths and worktree paths
are revalidated against the owning task.

## Operations and failure

Only one turn dispatches per session. Workspace and provider ceilings bound concurrency, and the owner
sets both under Settings > Agent concurrency. The provider ceiling is counted against one agent CLI
across the whole node, which is what holds a single provider account to a few turns at once. The
workspace ceiling is counted across all providers in one workspace. Both live in one `prefs` row
(`agents:concurrency:v1`), read per scan rather than captured, so a raise applies to the scan the write
triggers. Absent or unreadable, the built-in 2 and 3 stand.

The dispatcher is edge-triggered: it scans the queue when a turn is enqueued, when a provider starts,
and when a turn settles. A scan that starts nothing rescans when a call arrived while it was running,
because that call's turn cannot be in the snapshot the scan is working from, and the reconcile pass
runs one scan at boot. Without both, a turn queued at the wrong moment waits for an unrelated session
to finish a turn before anything looks at it again.
Cancellation, timeout, provider disconnect, and restart are explicit states. A live stream can be
lost without killing the provider process, and the client reattaches from the session sequence or
terminal replay tail.

Interactive creation is accepted once its session row is durable, not once its provider process is
ready. A startup failure therefore settles that visible row as `failed` and records the error in its
event ledger; it is not reported as a late failure of a create request whose resource already exists.
The runtime tracks the detached initialization through shutdown so it cannot outlive the plugin
database.

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
