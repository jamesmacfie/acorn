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

A session names what started it. `kind` is `interactive`, `workflow`, `delegated`, or `imported`, and
a workflow session's `config` carries `workflowRunId` and `workflowStepId`. Both are read, in three places: the
pane's header draws a chip, "Workflow: <name> · <step>", that opens the run pane at that node
([workflows.md](./workflows.md) § The run pane); the sidebar row for such a session carries the
workflow glyph beside its provider mark; and the row in Agent Center carries a **Run** chip that opens
the run the same way. The header's names come from the workflows plugin's
`WORKFLOW_CONTROL.runForSession`, so a node with workflows disabled simply draws no chip. Agent
Center's chip needs no names and so needs no request: the two ids are on the row already
(`plugins/agents/src/client/center/workflowRun.ts`).

The ids are also how the run pane finds a session for a step that is still running, since the step row
records `agentSessionId` only later. Nothing there is a second copy of the truth: the config is
written once, when the node creates the session, and every later write to a session's config spreads
what was there.

A workspace-scoped list or search resolves the task ids first, through
`CoreServices.tasks.idsForWorkspace()`, then narrows this plugin's own tables to those ids. An empty
result narrows the answer to nothing rather than falling back to unfiltered, because unfiltered is
how a workspace-scoped read leaks another workspace's sessions into the caller's view.

A new session starts as `New agent session`. Its first accepted turn immediately replaces that with a
deterministic label from the first non-empty text part, or the first attachment filename, so naming
never blocks the turn. For a first interactive text prompt of at least five words, the runtime then
asks the same session profile for a shorter title in the background. That one-shot run has tools
disabled, executes in an empty temporary directory, receives only the effective text left by the
`before-send` hook, and is bounded to 30 seconds. Workflow, delegation, automation, import,
attachment-only, short, repeated, and later turns do not generate a title.

The generated write compares against the exact fallback before replacing it. A user rename therefore
wins whether it lands before or during generation, and a restart cannot automatically regenerate a
title from an already inserted turn. **Regenerate title** is the explicit exception: it reads only the
first durable text prompt, asks the same profile again, and compares against the title that was current
when the request started. A rename made while regeneration runs still wins. A generation failure leaves
the current title and adds nothing to the transcript.

### Cross-plugin lifecycle

Three plugin events reduce the durable model without copying its private content:

- `plugin:agents:turn-changed` carries task, session, turn, source, status, and attempt after enqueue,
  dispatch, activation, retry, completion, failure, cancellation, interruption, or restart repair.
- `plugin:agents:request-changed` carries task, session, provider request id, kind, and status after
  creation, resolution claim, provider acknowledgement, expiry, cancellation cleanup, or restart
  repair.
- `plugin:agents:sessions-changed` carries task and session ids, current presence and archive state,
  and a stable `changes` array (`created`, `renamed`, `archived`, `restored`, or `deleted`). A rename
  also carries `renameSource` (`generated` or `user`). Titles never enter the event payload.

The store and repository own these post-commit announcements, rather than each route and runtime
path sending independently. Node-side consumers rebuild current state through the task-scoped
`agents.turns`, `agents.requests`, and `agents.sessions` capabilities. Turn reads omit prompt,
effective policy, error, and transcript content; request resolution remains private to the agent
runtime. Core `agent-session:changed` remains the generic completion/attention compatibility event,
and `agent:*` remains the owned transcript stream.

The immediate fallback, generated title, and user-authored rename all use the repository's one title
mutation. Each successful change also publishes the full `agent:session` frame clients already use to
update their cache.

`agents.reviewInput.v1` is the narrow exception for completion consumers that need content. A caller
must name the owning task, session, and turn. The result contains the persisted `turn_completed`
sequence, purpose, bounded assistant summary and user messages, and availability. It does not expose
the event ledger, prompt policy, tool payloads, or errors. Findings uses the sequence as part of its
durable checkpoint key and skips review-purpose work.

### What a session reports

Starting a provider raises an `agent.session` span and dispatching a turn raises an `agent.turn`
span, both through `ctx.telemetry` and both owned by this plugin
([telemetry.md](./telemetry.md) § Ambient attribution). The session span carries the session id, the
provider and whether this was a reconnect; the turn span carries the turn id, the session id, the
provider and the turn's source. Neither carries a prompt, a result or a transcript.

The session span covers spawning or reconnecting the provider child and nothing more. A session
lives for hours and outlives the process, so a span over its whole life is one nobody can close;
what something waited on is the start.

The turn span opens where the pump dispatches the turn, not where it was enqueued: a turn can sit
behind the concurrency limit for minutes, and "how long did the agent take" is not "how long was the
node busy". It closes on whichever of the four endings comes first, which is a completed turn, an
error, a provider that closed underneath it, or a safe-transient retry putting the same turn back in
the queue. A turn the process died in the middle of reports nothing.

## Harnesses

A harness is one agent acorn can manage. A driver adapts its protocol into the common session and
event model. A profile, meaning how to launch the CLI, resume it, and run it headless, is registered
into a core registry and used by terminal, agents, and workflows. A profile may be available for
interactive terminal use without a managed driver behind it, and `aider` is that case.

There are two driver tiers, permanently.

**Tier 1 is the generic ACP driver, and a harness is data.** One driver
(`plugins/agents/src/server/drivers/acpDriver.ts`), built from a launch spec: a command or a
package-relative adapter entry, arguments, an environment passthrough list, and a small block of
declared quirks. Everything downstream is shared, including the normalizer, the durable event ledger,
the transcript, and permission plumbing. This is the default path for a new agent and the only path a
loaded plugin can reach.

**Picking a session back up is read off the wire, not declared.** The protocol has two ways back into a
session the agent still holds, and they are different calls: `session/load` replays the history the
agent kept, and `session/resume` restores the context and sends nothing back. An agent advertises
whichever it implements at `initialize`, Claude Code the first and DeepSeek the second, so the driver
takes it from there and a harness declares nothing. Reading only the older capability is what used to
put a brand-new agent under an unchanged transcript on every reconnect, silently. Either call can also
answer that it has never heard of the reference, which is an ordinary outcome for a moved checkout or a
pruned store: the driver starts a fresh session and says so in the transcript. The
`sessionPersistence` quirk is now about the terminal handoff alone.

**Tier 2 is a native driver, first-party only, for what ACP cannot say.** Codex is the reason it
exists. Its app-server gives acorn `thread/fork`, `thread/compact/start`, `thread/archive`,
`thread/delete`, and Codex-specific per-turn model, effort, permission, and collaboration-mode
settings. Those app-server operations have no ACP equivalent for a Codex session. The native driver
discovers Default and Plan through
`collaborationMode/list`, expands the selected preset for `turn/start`, and follows
`thread/settings/updated` so a preset's effective model and effort stay synchronized with the generic
configuration shown by acorn. App-servers that do not expose the experimental list endpoint continue
without a Mode picker.
A native driver is written when a vendor protocol carries product value the generic driver cannot,
and it lives in plugins/agents with the rest of the first-party code. The registry has two doors and
the names are the point: `register(spec)` takes data, `registerNative(id, factory)` takes code.

Generated files cross a separate, provider-neutral driver seam. A driver emits transient bytes with
a title, media type, and artifact kind; the runtime bounds them, takes custody in the content-addressed
artifact store, and writes only the resulting artifact reference to the normalized event ledger.
Provider paths and base64 payloads therefore never become durable transcript events. Codex opts into
this seam with the `generated_artifacts` capability and maps completed `imageGeneration` items to it.
Another native provider can emit the same driver event without adding a provider-specific client path.

Claude runs on tier 1 and Codex on tier 2, which makes the two of them the worked example of each.

**plugins/agents stays first-party.** It owns the stream and the surfaces, and a harness contribution
is a descriptor delivered to it rather than a fork of it. The contributing plugin describes the
spawn, and plugins/agents owns the child process, the session, and every byte of the transcript. That
is also why a data-only harness plugin needs no `exec` grant: it never spawns anything.

**The delivery seam.** A manifest's `harnesses` entries reach the node host like schedules and task
checks do. The composition root carries them on the loaded-plugin binding, and
`node-core/server/pluginHost/host.ts` resolves each adapter entry inside the contributing package, turns
each probe route into a call, and hands the result to the host-only `harnesses` seam
(`HostPluginContext` in `server/pluginHost/types.ts` — a plugin has no member to call, the manifest is the
only way in). That facet forwards to the
`agents.harnessRegistry` capability plugins/agents publishes, resolved at delivery time and never
cached, so agents disabled means the same silent nothing every unmatched contribution gets, and
re-enabling redelivers. A harness package with no node bundle still gets a real plugin row, so it is
listed in Settings → Plugins and the owner can turn it off.

A harness names a program acorn will run, so it is disclosed under **Enforced** in the trust prompt,
honestly: the host spawns the declared command with the declared arguments and nothing else. The
whole spawn plus the environment passthrough is the grant key, so a version that swaps the binary,
changes its arguments, or widens the globs reads as newly requested. A one-shot text mode is a second
invocation with its own arguments, so it gets its own line and its own key on the same rule.

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

**A headless turn runs in `auto`, a decide turn in `dontAsk`.** The two modes are not "prompt" and
"do not prompt". `dontAsk` denies anything that is not already in a `permissions.allow` rule, and
acorn writes no such rules, so a headless step ran with every tool acorn projects visible, listed,
and denied on call. `auto` approves through a classifier instead of a prompt, which is the only shape
that works with nobody at the keyboard. What an agent may reach is still decided at the node, by the
owner's tier and per-tool preferences narrowed by the step's own ceiling, so this widens the CLI's
gate to match acorn's rather than replacing it. `aiArgv` keeps `dontAsk`, because it passes
`--tools ''`: with nothing to approve, denying whatever tries anyway is the point.

**A harness may answer one question without holding a conversation.** The manifest's `oneShot` block
sits beside `terminal` rather than inside it, so an agent with no interactive command-line interface
still reaches every Generate control. DeepSeek is that case: `dsh --profile headless` answers a prompt
and exits, and `dsh` alone prints a usage error. Such a harness still gets a profile row, because a
Generate backend is read off the profile registry, and the row carries `interactive: false` so the
terminal's profile menu leaves it out and the spawn route refuses it by name. One binary per harness
either way: `oneShot.command` exists for a harness with no `terminal` to borrow one from, and declaring
both is refused, because "is this installed" is a single lookup on `PATH`.

**`aiArgv` is the one-shot text mode, and declaring it is the whole opt-in.** A profile that returns
an argv from it can answer one prompt with its tools off, and that makes it two things at once: a
profile a workflow `decide` step may name, and a backend every Generate control in acorn lists beside
the owner's connected API keys ([integrations.md](./integrations.md) § Model providers). One field
and no second registry, so a profile author writes it once. Claude Code and Codex both declare it.
Aider does not, because it has no one-shot mode that answers without editing files, and the shell
profile does not, because it is not a model.

The system half of such a turn arrives as `HeadlessOpts.system`, apart from the prompt, because that
is how the connection runtime and every caller's prompt builder already separate them. **The profile
decides how to carry it**, and core never joins the two on a profile's behalf, because only the
profile knows whether its CLI honoured a flag. Claude Code passes `--system-prompt`, which replaces
the CLI's default prompt rather than appending to it, and that is what a generate wants: the
coding-agent persona is noise in front of "answer with SQL only". Codex has no such flag, so it
prepends the system text to the prompt with a blank line between. A profile may also declare `models`,
`defaultModelId` and `glyph`, the same fields a connection provider declares. Claude Code declares
the CLI's own aliases, `sonnet`, `opus` and `haiku`, rather than dated model ids, because the CLI
resolves an alias to whatever it ships with and a pinned id goes stale there before it goes stale
here. Codex declares none: its model list lives in `~/.codex/config.toml` and the owner's account, so
a copy here would be a second list that drifts from the one that decides. A backend with no catalog
draws no model select and runs on the CLI's own configured default.

**The stream shape is the profile's too, and the two harnesses share nothing but the newline.** Claude
Code writes a `result` event carrying the answer, the cost and the token counts. Codex writes none:
the answer is the text of the last `item.completed` whose item is an `agent_message`, the resume
reference arrives up front on `thread.started`, and the token counts arrive at the end on
`turn.completed`. Read with Claude's parser, every field of a Codex capture comes back null and
`runHeadless` calls the run malformed, so no Codex headless or `decide` turn could ever succeed. Each
profile names its own adapter now (`server/agentProfiles/streamJson.ts`). Codex reports tokens and no
cost, so its cost stays absent rather than being invented from a price table, and with
`--output-schema` it answers with the JSON as the message text, which the adapter parses only when it
reads as an object or an array. A prose answer leaves the structured field empty, which is what a
caller that asked for a shape should see.

**There is no findings reviewer preset yet.** One-shot structured output proves that a profile can
return a verdict-shaped value; it does not prove that the provider cannot edit files or invoke its
own native tools while producing one. Findings-backed workflow decisions are deliberately deferred
until a concrete gating workflow exists. Before a reusable reviewer preset can ship, the agents
owner must define a small profile/policy carrier if the existing harness descriptor cannot express
it, and provider conformance tests must prove both sides of the restriction: Acorn exposes only the
declared read ceiling, and the provider's native invocation prevents file writes, shell execution,
and ceiling escape. A prompt that asks the model to be read-only is not evidence. A provider without
that conformance is shown as unavailable for the preset instead of being allowed by convention.

**A contributed harness reaches acorn's own tools through the protocol.** ACP carries MCP declarations
on `session/new` and on the call that picks a session back up, so the driver names acorn's server there
for any harness that has no `mcp add` command of its own to register through. Claude Code and Codex
keep the config-file door they already had, and a harness gets one door, never both.
[mcp.md](./mcp.md) § Configuration owns this, including why the launch environment is spelled out
rather than inherited.

**What ACP offers the client side is declined, except the one that lets an agent ask.** The driver
answers no to `fs` and `terminal` at `initialize`. `mcpServers`, the client capability, stays declined
too, and it is a different thing from the declarations above: it would have the agent ask acorn to
proxy an MCP server on its behalf, rather than connect to one acorn named. Each is worth adopting on its own
merits and none of them blocks, or is blocked by, harness contributions. `fs` would make the agent ask
acorn to read and write files, which is one audit point and the precondition for the agent and the
worktree living on different machines. `terminal` would put agent-run commands through acorn's process
lifecycle and into the task's terminal surfaces. The `mcpServers` client capability would let an agent
hand acorn a server of its own to run and proxy, which is a different consent question from acorn
naming its own; replacing config-file registration was the other half of that idea, and that half
shipped through the session declarations above.

**Form elicitation is declared, and it is what lets an agent ask a question at all.** Declining it is
not neutral: Claude Code's adapter puts its own `AskUserQuestion` tool in `disallowedTools` whenever
the client did not advertise `elicitation.form`, and auto-declines anything an MCP server asks. So an
agent that should have asked guessed instead, for as long as the capability was absent. The driver
declares `form` alone. A url-mode elicitation would hand a person a link to open, which is a different
surface and a different consent question, so it stays undeclared and never arrives.

One schema property becomes one question (`server/drivers/formElicitation.ts`), and nothing in that
mapping knows a vendor's field names, so property-bearing ACP and Codex app-server forms map the same
way. Claude pairs every choice with a free-text box, which lands as its own question titled "Other".
For Codex, a form with no properties is consent rather than an empty question: the card offers Allow
and Decline, and sends the chosen MCP action back to the provider. An answer travels back as the
option's own value behind the label a person picked, because the card answers with labels and Codex
numbers its own question options positionally. A question is answered in the same card, by the same
route, and against the same durable row as a permission (§ Client surfaces).

**A question the agent stopped waiting for is released with its turn.** No cancellation signal reaches
an elicitation handler, so a turn can end with a question still parked: the ACP request would never be
answered, the agent's own call would never settle, and the durable row would sit in the reader's
"Needs you" for good. The driver drains whatever is still parked when `session/prompt` returns,
answering each with `cancel` and recording a `request_resolved`, which is what releases the row.

The Node probes harness availability and usage on bounded intervals. Usage and pricing details are
displayed in the Agent pane; pricing overrides are local preferences and provider prompts/responses
are not stored by the model-provider plugin. The same pricing page holds the built-in Claude and Codex
catalogues plus exact-model overrides. Plan usage is per harness: the built-in CLI probes and a
contributed harness's `probes.usage` route feed one registry, and a harness with no collector shows no
usage section.

## Provider-native subagents

Both managed harnesses can use their provider's native subagent feature, and such a subagent is
**not** a session. It cannot be
addressed, sent a turn, forked, or handed to a terminal, so making it a session row would be a lie in
every table that reads one. It is a projection instead: each session's row carries a `subagents`
roster, folded from that session's own `subagent` events by `recordEvent`, in the same transaction as
the event insert. The runtime already broadcasts a session row after every event it records, and agent
frames are pushed to every client rather than subscribed to per id, so the task sidebar's sub-rows
appear and settle live for every session in the task, not only the open one, and nothing extra is
fetched. Each sub-row is inset behind a one-pixel left rule, aligned with its parent's text, to show
which parent owns it. The roster keeps every in-flight entry plus the last 20 settled ones; the full
history stays in the event ledger, which is what the transcript reads.

A session row also carries `queuedTurns`, the count of follow-ups waiting to dispatch. It is a column
on the session row, kept current by the store whenever a turn enters or leaves the queue, folded there
for the same reason as the subagent roster: the row is broadcast after every event, so a value on the
row reaches every client live, and a count computed only when the list is fetched would be overwritten
by the next broadcast. A queued turn leaves `runtimeState` at `ready` or `working`, so without this
count the task sidebar has no way to mark a session whose only sign of a waiting prompt is the prompt
itself. Enqueuing a follow-up on a session held idle behind the concurrency limit broadcasts the row on
its own, because no event would otherwise wake it.

A subagent's own progress never touches its session's runtime state. Turn boundaries own that, and a
child that settles after its parent's turn completed, which Codex allows, would otherwise drag the
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
| Terminal state | completed, unless backgrounded (see below) | idle, and still resumable |

Reading Claude's `_meta.claudeCode` namespace in the shared ACP normalizer is deliberate rather than a
harness quirk: another harness's namespace is simply absent, so the branch costs nothing, and a quirk
joins `HarnessQuirks` when a *second* harness needs one.

One Claude update is dropped on the floor. The CLI pings every 30 seconds for any tool still running,
and the adapter forwards the ping as a `tool_call_update` under an id it made up,
`<the real call id>-heartbeat-<n>`, carrying the real tool's name and a `toolResponse` of nothing but
`elapsedTimeSeconds`. Only that shape reports an elapsed time without naming an agent, which is how the
normalizer recognises it. Reading a ping as a call mints a new card every 30 seconds, and when the tool
is `Agent` it mints a subagent row keyed on an id that never appears again, so the completion lands on
the real call and the row sits at "Working" for good.

A backgrounded Claude subagent needs a second exception, for the same reason the heartbeat does: the
spawning `Agent` call does not mean what it looks like. When the CLI runs a child with
`run_in_background: true`, the call returns the instant the child launches, so its `toolResponse`
arrives at the start with `status: "async_launched"` and the call's own status then goes `completed`,
all while the child is only getting started. Its inner tool calls stream on for as long as it runs.
Reading that first summary as a finish, or the spawning call's `completed` as the child's, marks the
row done before it has done anything. So `async_launched` folds to `running` and sets the roster
entry's `background` flag, and a background entry is settled only by a real completion summary, the one
update that carries the harness handle. A terminal status with no agent id on it is the launch receipt
and leaves the row running. The parent session still reads as ready meanwhile, by the rule above: a
backgrounded child is precisely a child that outlives its parent's turn.

That last point has a tail, and it is where a background child's status actually comes from. The
completion summary that would settle the row never arrives: the spawning call files a launch receipt
and then says nothing about that child again. What does arrive is the child's own work. Its tool calls
stream on for as long as it runs, each tagged with `parentToolUseId`, so that traffic is the only
honest report that it is still going.

So the roster reads liveness from traffic. Any event the harness attributed to a child marks that
child heard from, which is what `touchSubagentRoster` in `stateMachine.ts` does, and `updatedAt`
becomes the clock. The end is then inferred from silence, because nothing else can infer it: a quiet
window with no traffic in it settles the row to `idle`, meaning detached and resumable by its
`providerAgentRef` rather than spinning or falsely "completed". Traffic after that revives the row,
since quieting was a guess and a child that speaks again has disproved it. A real completion summary,
if one ever comes, still folds the row on to `completed`.

The sweep is a debounced timer per session in `runtimeEngine.ts`, pushed back by every event that
touches a roster row, and re-armed on boot for any session the previous process left with an active
child. The window is `SUBAGENT_QUIET_MS`, a minute. That number is measured, not guessed: in a
captured Claude Code run on Sonnet the longest pause between two events from a child that was still
working was 16 seconds.

Do not tie any of this to turn boundaries. The end of a turn says nothing about a child that was
backgrounded precisely so it could outlive one. An earlier version quieted every active child on
`turn_completed`, and in a captured run that marked a child `idle` while it had 70 more tool calls to
stream, then left the next child spinning for good because it was spawned after the last turn had
already ended and no second `turn_completed` was ever coming.

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
`plugins/agents/src/server/drivers/__fixtures__/`, not hand-written shapes: an extension field can only
be tested against what the harness actually sent.

## Managed delegation

Managed delegation is distinct from provider-native subagents. A terminal or managed session calls
the execute-tier orchestration tools to create an addressable `delegated` managed session, queue more
turns, wait, read bounded output, or cancel work. The child uses the same provider drivers, durable
turn queue, event ledger, restart reconciliation, request handling, and concurrency dispatcher as an
interactive session.

The `agent_spawns` table is the ownership and provisioning ledger. It records the root and direct
owner, child task and session IDs, depth, isolation, call idempotency key, and one of `creating`,
`provisioned`, or `failed`. It does not copy the child's runtime state. Once provisioning succeeds,
the child session owns readiness, work, attention, and terminal status.

Shared isolation keeps the child on the caller's task. Worktree isolation reserves a stable child
task ID before crossing into core, then creates the task, delegated session, and initial turn with
spawn-derived idempotency keys. Startup reconciliation resumes any `creating` worktree row from the
last durable boundary. A permanent failure keeps the row and any child task or session that already
exists, so recovery never deletes a checkout that might contain work.

The Node may bind its listener before the post-startup recovery pass finishes. Every orchestration
tool waits for that pass, so a retried call cannot race recovery of its own spawn row or an
interrupted child turn.

A managed child records `parentSessionId` and the parent's active `parentTurnId`. A terminal-owned
child uses only the spawn ledger for authority and exposes a bounded terminal label and profile for
display. The session list projects that lineage beside its session page. The Agent pane nests managed
children below an available managed parent and marks that ownership with the same inset left rule as
provider-native subagents, labels terminal-owned children without inventing a parent row, shows depth
and isolation, and links a selected child back to its managed parent.
Provider-native subagent rows keep their original place under the provider session.

Only a direct owner can address a child. A child may create one more level, but a third level is
refused. Each root admits at most 12 live delegated sessions in the reservation transaction, counting
rows still being created. The child inherits the intersection of the parent's signed tool ceiling
and any narrower ceiling requested at spawn. General session configuration updates cannot widen or
remove that persisted ceiling.

## Web activity

A reader should be able to answer, from the transcript alone, what an agent searched for, which pages
it opened, and which sources came back. Both built-in harnesses report all three. Neither reported any
of it to a reader, for different reasons: the Codex normalizer mapped a `webSearch` item to an id, a
title and a status and threw the rest away before the event was recorded, and the ACP path kept
Claude's request but showed it as pretty-printed JSON under a title the adapter had written.

The fix is one optional field on the tool call rather than an event type of its own. A web search has
the same identity and the same lifecycle as any other tool call, so a parallel kind would duplicate
status, output, subagent ownership, folding, the extension point and the search index:

```ts
type AgentWebAction =
  | { type: 'search'; queries: string[]; allowedDomains?: string[]; blockedDomains?: string[] }
  | { type: 'open_page'; url?: string }
  | { type: 'find_in_page'; url?: string; pattern?: string }
  | { type: 'fetch_page'; url?: string; prompt?: string }
  | { type: 'other' }

type AgentWebActivity = { action?: AgentWebAction; results?: AgentWebResult[] }
type AgentToolCall = { /* … */ web?: AgentWebActivity }
```

The names are Acorn's, not any provider's. Both fields are optional because a provider reports the
request and the sources on different updates, so absent has to mean unchanged, the same convention
`AgentToolCall.status` follows. `input` and `output` stay filled in beside it: the structured payload
drives the card and the index, and the generic text is what a renderer that has never heard of the
field still has to draw.

**Each driver owns its own mapping, and nothing downstream knows which executable ran.** The Codex
normalizer reads `item.type === 'webSearch'`. The ACP normalizer reads `_meta.claudeCode.toolName`,
never ACP's `kind`, because Claude's `WebSearch` and `WebFetch` both arrive as `fetch` and another
harness may well call a repository grep `search`. An ACP harness whose tool identity the driver does
not recognize keeps the generic card. A new harness earns the card by mapping its own confirmed wire
shape to `AgentWebActivity` and nothing else.

**The row is named after the action, not by the provider.** `Search web`, `Open page`, `Find on page`,
`Fetch page`, `Web activity` for an action a provider declined to name, and `Web search` for a call
that has not said yet. The table is in `plugins/agents/src/server/drivers/webActivity.ts`, shared
between the drivers so that a second one does not import the first. Claude Code's adapter titles a
search `"the query" (allowed: docs.example)`; that title no longer reaches a transcript, because the
query can be a paragraph and the title is what a reader scans by. The query goes in the fold's summary
slot beside the title instead.

What the two providers actually send is checked in, sanitized, under
`plugins/agents/src/server/drivers/__fixtures__`. Two things in those captures contradicted the plan
this work was written from, which is why they are the authority:

- Codex sends nothing on `item/started`. The query is the empty string and both the action and the
  results are null, so the start event carries no payload at all and the fold is what puts the call
  back together. The same model reading a page reported it once as `openPage` and once as `other`.
- Claude Code does forward structured results, on `_meta.claudeCode.toolResponse.results`, whose
  object entries hold `content` arrays of title and URL with the model's prose as a sibling string.
  So a Claude card shows the same list of sources a Codex card does. The adapter also converts
  recognized result blocks to `Title (url)` text in other paths; that format belongs to the adapter
  and is never parsed back.

Claude reports no domain for a result and Codex does. The card reads the host off the URL when the
field is absent rather than storing a derived one, so the two read the same without the ledger
carrying a second thing to keep true.

**The payload is bounded twice before it reaches SQLite**, in `boundProviderEvent.ts`: every string
and collection on its own, and then the whole payload against the 64 KiB the inline tool budget uses.
Overflow drops trailing sources and only that. The per-field limits are chosen so the action fits
inside the budget by itself, which is what lets that trim finish and what keeps the one field that
explains the call. Oversized web data is not promoted to an artifact the way command output and
patches are: a reader wants those in full, and the fortieth search result is not that.

**Only `http:` and `https:` URLs become links.** The card parses with `URL` and checks the protocol.
Anything else stays visible as text, so a reader can see what the provider tried, and no result can
become a `javascript:`, `data:`, `file:` or Acorn deep link. Scheme is a rendering decision, so the
bounds layer stores a hostile URL whole rather than truncating it into something that no longer looks
like what it is.

Queries and result metadata join `agentEventSearchText()`, so Agent Center finds a run by what it
searched for, by a result title, domain, URL fragment or snippet. Bounds run before the index string
is built. Nothing about a web call reaches telemetry, lifecycle events, session rows or notification
text: a query is written from task context and can hold anything that context held.

One card is drawn for both hosts by `plugins/agents/src/client/sessions/webToolCard.tsx`, selected by
the presence of `tool.web` and wrapped by the same `agents:tool-card` slot as the generic one, so a
contributed renderer still wins. It uses kit nodes only. In a terminal a focused result link prints
its address on the line below, which is what that host does with every address it cannot open.

No migration and no schema-version bump: the field is additive and optional, readers already tolerate
an absent optional tool field, and `agent_events.search_text` accepts the longer string for rows
inserted from here on. Codex rows recorded before this change hold no query, because normalization
discarded it, and they keep rendering as the flat `Web search` row they always did. Codex rollout
files may still hold the payload, but they are private provider storage that can be pruned or live on
another node, so a transcript read never touches `~/.codex` or `~/.claude`.

## Client surfaces

The Agent pane is a `list-detail` layout (docs/panes.md § Layout model). The list column is the task's
roster, with a header region of its own so the count stays put while the list scrolls; the detail
column is the open session. The roster is managed sessions, delegated children, and provider-native
subagents, and nothing else: it used to
carry a third group merging this task's terminals with a run's workflow steps, and both halves have a
better home — the terminal drawer, and the Workflows pane. Nothing in the plugin lays anything out and nothing in it ships a
stylesheet: every surface here is a tree of kit nodes, so the same source draws in the shell today and
through the remote root when a harness plugin is loaded rather than compiled
(docs/ui-design.md § The closed kit).

The detail column has a header, a transcript and a composer without a second set of regions. The
transcript is a `Timeline` with `follow` set, which means the kit owns the scroll: it stays on the
newest turn until the reader scrolls away from it, picks the bottom up again when they scroll back,
and gives a reader the place they left when they come back to a session. The bar above it and the
composer below it are pinned by being that scroller's siblings.

Immediately after the title, the header hosts the `agents:session-header` remote `stack` point. Its
props are a public projection rather than the ledger itself: task and session ids, provider id,
per-turn usage and resolved prices, and explicit token/cost accounting modes. The owner stops there.
The bundled `agent-cost` loaded plugin prices and formats those facts, preferring provider-reported USD
and otherwise showing an API-equivalent estimate; disabling that plugin removes the badge without
changing Agents. The point is not cost-specific, so independently installed plugins can fill the same
seat with a token counter or budget warning. The complete contract lives in
[cooperative extension points](./plugins/cooperative-extension-points.md#remote-trees).

That is a property of the region, not of this pane, which is why the conversation reaches its region as
a fragment and never wraps itself in a box: the region is the flex column the scroller sizes against,
and the CSS that caps the measure and hands the padding over names the scroller as a direct child of
it (`packages/client-core/src/infra/styles/shell.css`). Any surface drawing the conversation owes it
the same treatment, so a test asserts it rather than a comment asking for it
(`plugins/agents/src/client/sessions/AgentConversation.test.tsx`). Which surface is drawing also keys
the remembered scroll place, because a reader can be following live in one pane and reading history in
another.

The timeline is not virtualised, and that is the kit's rule rather than this pane's. The virtualizer
this transcript used to run called `measure()` on every new event, which clears the item size cache,
so every row fell back to the estimate, the canvas height jumped, and the rows re-measured, on every
event. It also rebuilt its rows from `getVirtualItems()`, which hands back fresh objects on each
scroll, replacing the DOM under any text selection. If a session ever feels slow to open, render the
last N behind a "show earlier" control: a fixed window has no measurement feedback loop. Two more
guardrails hold in the same place. A card seeds its fold state at mount and then leaves it alone, so
a call finishing does not slam its card shut, and the sidebar's rows are keyed by session id rather
than by object identity, so the roster rebuilding on every socket frame does not replace the row
somebody is reading.

**A selection survives a streaming update**, and a test says so rather than a habit. A message
re-renders only the block that is still growing, so the paragraphs above it keep their elements and
their text nodes, and a reader who selected across two of them still has that selection when the next
delta lands. `packages/client-core/src/kit/components/content/Markdown.test.tsx` holds it against the
real `Selection`: it selects across two blocks, streams an update into a third, and asserts the
selection reads back the same text. Written that way rather than as an element-identity check because
it fails for any reason a selection can break, not only for the one it was written after.

- Agent Center aggregates sessions, search, provider health, attention, transcript import, and launch.
- A provider draws as its own mark wherever it is named: the onboarding cards, the New picker, each
  block in Settings -> Agent defaults, and the session icon in Agent Center. The name comes off the
  descriptor's `glyph`, so a contributed harness gets the same treatment by pointing that field at a
  mark it registers. The two built-in ones are `brand:agents/claude` and `brand:agents/codex`, drawn
  by `ProviderGlyph.tsx` and coloured from the mark (docs/ui-design.md section Brand colour). The
  colour is mixed toward the theme's foreground rather than used raw, because a brand hex is authored
  against white and OpenAI's purple is unreadable on a dark pane.
- The Agent pane shows the current transcript, composer, queue, context, requests, artifacts, and a
  same-task roster. The first three of those are one component, `AgentConversation`, addressed by a
  session id, and the Workflows run pane draws the same one through the `agents.conversation` client
  capability. So a session can be on screen twice, and everything two composers have to agree about —
  the attachments and captured context of an unsent turn, and the guards over sending it — lives in a
  module map keyed by session (`plugins/agents/src/client/composer/composerState.ts`) rather than in
  the component. What stays per mount is view state: how tall the box is, which picker is open, and
  which surface's scroll place the transcript restores.
- A roster row puts the provider's live reasoning effort beside its live model name. Codex reports
  those as separate configuration options, and both can change while the session is open, so the
  display reads `configOptions` rather than the legacy model column. Provider-native subagents inherit
  the same combined summary when the provider has not named a different child model. Dashboard data
  keeps model as its own typed field; the combined value is presentation text, not a stored contract.
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
- On the desktop, a closed disclosure defers its contents until first opened. Opening a task's
  Agent pane therefore does not render hidden tool output or the nested transcript of a completed
  subagent. Once opened, those contents stay mounted across toggles so their local state survives.
- **The card body is a slot.** Three things can draw it, in order: a compiled plugin's renderer that
  matched the call, then a loaded plugin's remote tree that declared the call's tool name, then the
  built-in card. A compiled renderer wins because it draws in the transcript's own realm and costs
  nothing; a remote one runs in that plugin's worker and emits a tree of the host's own components,
  which the transcript grafts in place of the card body
  (`docs/plugins.md` section The client half of a loaded plugin). Either way the props are the same
  `tool`, `defaultOpen` and `onOpenChange`, and a card that fails to draw shows a labelled placeholder
  without disturbing the transcript around it. This is what stopped the tool card from being the reason
  a plugin had to be first-party: `changes` is still compiled, but nothing about the card requires it.
- A card seeds that state at mount and then leaves it alone. Read reactively it would shut the card the
  moment its call finished, which is when somebody is most likely to be reading it.
- The setting, and not the call's reported status, is what decides this. Status was what used to make
  the answer differ by harness with nothing in the product saying so: Codex reports a started call as
  `running`, while the ACP path reports `pending` and then `completed` and never `running` at all, so
  one provider's cards opened themselves and the other's never did. For the same reason the ACP path
  maps a call's `rawInput` into the card as pretty-printed JSON. Output only lands on the completion
  update there, since Acorn declines ACP's terminal capability, so without the parameters a running
  Claude call had nothing to disclose and could not honour the setting until it was over.
- **Claude's plan-mode handover is the exception to that.** `ExitPlanMode` carries the whole plan as
  one markdown string in its parameters, so pretty-printed JSON draws it with every line break spelled
  out as `\n`, and that plan is the one thing in a planning session somebody wants to read. The
  normalizer posts it as an assistant message instead, which renders through the transcript Markdown
  policy and survives the chats-only toggle, and the call keeps its title and its outcome with no
  parameters to disclose. Only the opening `tool_call` is read that way: the parameters arrive with the
  call, so reading an update as well would post the plan twice.
- A plan update is a complete snapshot. Every snapshot remains in the durable ledger, while the
  transcript folds snapshots from one turn into the card the first one opened; a new turn starts a new
  card. Each step has one structured status marker and renders its text through the transcript Markdown
  policy, in a status-and-text grid that keeps wrapped lines inside the card.
- Usage folds the same way, one line per turn. A turn's last usage update can arrive after the turn is
  marked complete and so carries no turn id; it updates the line it belongs to rather than starting
  another. That is how a cost joins a line that started with only a context count. **The fold happens
  on the Node now, not per client.** A harness reports usage as a running snapshot, so a turn draws
  about 58 rows, a quarter of everything this ledger holds, and every one of them used to cross the
  wire and sit in every client's event list for the life of the session. The HTTP snapshot route folds
  them before it serialises and the transcript store folds an arriving one onto the line it belongs to,
  both by the rule in `plugins/agents/src/shared/usageFold.ts`, which is the transcript's own rule
  moved somewhere two callers can share it. The surviving row keeps the first update's id and sequence,
  so the line lands where it always landed. The client's own fold in `conversationItems.ts` stays and
  is now defensive: a replayed page, an imported transcript or an older node still folds the way it
  always did.
- **A folded usage line has no card of its own.** It used to draw at the head of each turn as tokens,
  context and a provider cost on one row. The cost belongs to whichever plugin fills
  `agents:session-header` and already sits beside the session title, and the token counts said the
  same thing twice for a reader scrolling the thread. So the fold feeds the line that closes the turn
  instead: `Turn complete` and its stop reason on the left, the share of the model's context window
  the turn had used on the right. `stampTurnContext` in `conversationItems.ts` copies the figure onto
  the `turn_completed` card by position rather than by turn id, because Codex clears the current turn
  before it emits the completion and the event arrives unattributed. A turn whose harness reported no
  context window closes with its reason alone.
- Anything the agent is blocked on is drawn in the transcript at the point it asked, and that one card
  has two states. While it is blocking, it is the control that answers it: a dropdown, a column of
  checkboxes for a question that takes several answers, a free-text box, or a row of buttons for a
  permission. The reader answers where they are already reading, and the thread keeps the interruption
  in the order it happened. Once it is answered the same seat holds the record: what was asked, what
  was said, and, folded beneath, the options they passed over, which nothing else records.
- What happens after the answer differs by kind. A question stays. A permission goes, because it is a
  decision about one tool call, that call already has a card of its own, and a busy session would bury
  itself under them. Both draw from the request row rather than from their own event, because whether
  anybody has answered yet and what they said both live on the row and keep changing long after the
  event is written. An answer to a question the harness marked secret reads as "Answer hidden", since
  the thread is durable and searchable in a way a prompt answered and gone was not.
- **Chats only keeps the requests.** The toggle above the composer drops the tool calls, the reasoning
  and the notes, and a question the agent asked with the answer sitting on it is the same conversation
  as a message. During planning it is most of the conversation, so leaving it out gave a reader a
  transcript where the agent settled a question it had never asked. An answered permission is already
  gone by then, dropped by the rule in the bullet above rather than by a second one here, so what
  survives the toggle is the questions and whatever is still blocking.
- The task sidebar keeps its own "Needs you" list, which is the way to reach a blocked session the
  reader is not looking at. Picking a row opens that session and brings its card into view.
- A subagent shows up twice: as one card in its parent's transcript, holding everything that subagent
  did, and as one indented row under its session in the task Agent sidebar. The card is seeded expanded
  while the subagent is working and collapsed if it had already settled when the card was first drawn,
  then stays where the reader puts it. Reactive expansion would instead slam the card shut the moment
  the subagent finished, which is when somebody is most likely to be reading it.
- A subagent's run renders through exactly the same cards as its parent's: tool calls, prose, reasoning
  and file changes all go through one `AgentEventCard`, so a contributed tool card works inside a
  subagent's run without knowing it is in one. A tool call belongs to whichever stream opened it, and
  every later update folds there wherever it arrives from, because a provider need not repeat the
  attribution on each one. Claude's adapter in particular tags a subagent's `tool_call` and its final
  `tool_call_update` and leaves the one in between untagged.
- A subagent's mark is the same icon-and-colour pair a session gets (`RuntimeStateIcon.tsx`), so a
  running child turns the same loader as a working session: one glance answers "is this moving?" for
  both kinds of row. Its line names the status, the role where that is not already the title, and the
  model. Codex never names a child's model and Claude only names it once the child has finished, so
  until then the line shows the session's own, which is what a child inherits unless the spawn asked for
  another. The token count is collected on the roster but not shown: Codex's arrives in bursts and
  Claude's only at completion, so the number a reader watched was mostly stale.
- What reaches a subagent's stream is narrower than its parent's, and it differs by harness rather than
  by choice: a Codex child sends prose, reasoning, tool calls and diffs, and its own status becomes the
  row rather than cards; a Claude subagent sends tool calls and diffs only, since the CLI does not
  forward a subagent's prose. A Codex child's plan is dropped, because `plan` carries no
  attribution and a child's plan is not the session's.
- Selecting a sub-row, or the card's own **Open**, moves the whole message window onto that subagent's
  run: the transcript renders the card's children as its top level and a header names the subagent, with
  the way back to the session's own stream. A complex child run does not fit in a box inside its
  parent's stream. The projection already builds the tree, so this is a choice of root rather than a
  second transcript, and the scroll memory keys on the view rather than the session so stepping in and
  out does not restore one list's offset onto another. Picking the session row in the sidebar comes back
  out. The composer is hidden while a subagent's run is showing: it only ever addresses the session, so
  leaving it there would read as a way to reply to the subagent, which neither harness offers. The draft
  is held per session outside the component, so stepping in and back does not lose typed text — and so
  does everything else about the unsent turn, which is what lets the run pane draw a second composer on
  the same session.
- The composer's field is the kit's `MentionTextarea`. It draws `@file`, `/command` and `$skill` in
  three role tones, `accent`, `warn` and `ok`, which the theme maps the same way it maps every other
  tone; the composer names a meaning per run of text and never a colour. A textarea cannot colour part
  of its own value, so a `<pre>` mirrors the draft over it and the field's own text is transparent. The
  two share every property that decides where a glyph lands, and above 20,000 characters the mirror is
  dropped and the field paints itself. A command or skill is coloured only when the session advertises
  that name, so `9/11` stays prose and a misspelled `/reviw` stays visibly plain. File mentions come
  from the same walk that builds the turn's file parts, so what is coloured is what is sent.
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
- ⌘⇧↩, or the expand button in the corner of the box, grows the field from three rows to eighteen. It
  is the same chord the shell uses to maximise a pane and the nearest meaning it has while the caret is
  in a textarea. It is not a registered keybinding, because a task-scoped binding never fires from
  inside a typing target and a rebindable row that did nothing would be a lie. The transcript yields
  the height and keeps its place, because the timeline is the scroller and shrinking it does not move
  what it is following. The state is session-only and per composer, which is deliberate: two panes open
  on one session are two readers, and a reader expanding the box in one has not asked the other to
  change shape.
- **The composer has two more slots.** `agents:attachment` decides how one attachment on an unsent
  turn is drawn, keyed by its media type and in `replace` mode, so a plugin that knows more about a
  `.png` than a chip can say draws it instead and one attachment is still exactly one chip.
  `agents:composer-actions` is room in the action bar beside Attach and the two pickers, in `stack`
  mode with a ceiling of four, because several plugins with something to offer a draft is a real
  answer for a toolbar. Both follow the same four rules as every other point
  (docs/plugins.md § Cooperative extension points).
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

### The transcript store

Because nothing is virtualised, the DOM holds every card in a session, and what a streamed event costs
is the only lever there is. `plugins/agents/src/client/sessions/managedStore.ts` holds one snapshot per
session — the session row, its turns, its events and its requests — and every client sees about 25
events a second per streaming session, because the Node coalesces text deltas at 40 ms or 16 KB
(`durableEventBuffer.ts`). Four rules keep that frame cheap, and all four are load-bearing.

- **The event list is kept in sequence order and appended to in place.** Events arrive in order, so an
  arrival is a `push`; a reconnect replay can still deliver one out of order and that walks back from
  the tail to its seat. A set of seen ids per session answers "have I got this one" without a scan.
  Nothing may hold the array across a change and compare it by identity: what makes the transcript
  re-render is the store's signal, not the array's identity.
- **A usage update folds onto the open line** rather than being appended, by the rule above.
- **A projected event asks for a row, not a session.** `user_message`, `request`, `request_resolved`
  and `turn_completed` used to trigger a debounced refetch of the whole snapshot — up to 2,000 event
  rows, with a JSON body parsed per row — to learn one fact. The Node knows the fact already, so it
  sends it: `agent:turn` carries the turn a `user_message` opened or a `turn_completed` closed, and
  `agent:request` carries the request a `request` raised or a `request_resolved` answered. `error` is
  the one type that still refetches, because it also expires this session's pending requests and no
  frame names that set.
- **The turns are a map above the list, not a scan inside it.** A row used to find its turn with
  `turns.find`, once per row per render.

A snapshot read and the socket can disagree about a usage line, because both sides fold it and both
keep the first update's id: a frame can land while the request is in flight. `managedSnapshot.ts`
unions the two payloads, socket first, so no reported field is lost either way.

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

Interactive sessions only, and not a fork. A workflow step names the settings it wants in the file,
and a fork continues the session it came from at the settings that session was running.

A workflow turn carries its own settings the same way. `AGENTS_SESSION_EXECUTE` takes
`configOptions`, a table of provider option ids to values, which the step's `config_options` fills
([workflows.md](./workflows.md) § Execution model). It is applied through the same
`optionsWithDefaults` fold and the same `patchSession` write, after the provider reports its option
list and before the turn is enqueued, because the Claude driver reads a switch only through
`setConfig`. A value the provider does not offer is dropped and a warning row goes in the transcript.
The model and the reasoning level also go on the turn's `effectivePolicy`, as `model` and `effort`,
because the Codex driver reads them from there at turn time.

Settings reads the option list to draw pickers off the newest session that advertised one, because a
provider reports its models and reasoning levels only once a session is running. A provider you have
not run inside the 50 most recent sessions shows no pickers until you run it again. Each pick is the
save, as everywhere else under Settings: there is no save button, and a write that fails says so and
refetches the stored row.

The same page carries one setting that is not a session default and does not travel with the node:
**Tool call display**, under a Transcript heading, which is a device preference about how a transcript
draws its tool cards (section Client surfaces). It is there because that is where somebody looks for
it, not because it shares a store with anything above it.

## From the command palette

Seven rows plus the open session's own actions, all registered by this plugin rather than by the
shell.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Row | Kind | What it does |
| --- | --- | --- |
| New agent session | search, task-scoped | Lists the harnesses this node has installed, and starting one creates the session, selects it, and shows the Agent pane |
| Open Agent Center | action, no scope | Selects the `agents` rail source, which is this device's view of the node rather than a property of a task |
| Find an agent session | search, task-scoped | The node's own search over session titles, events, and artifacts, asked about the task the palette session captured |
| New Claude Code terminal | action, needs an open task | Creates a terminal on this plugin's `claude-code` profile, opens the drawer, and focuses it |
| New Codex terminal | action, needs an open task | The same for the `codex` profile |
| Carry the last session's model forward | setting, no scope | On and Off over `followLastSession` (section New-session defaults) |
| How a tool call starts out | setting, no scope | The three Tool call display choices: start collapsed, start expanded, and carry my last one forward |
| Agent session | group, task-scoped | Fork, retry, compact, continue in terminal, regenerate title, rename, the two exports and archive — the open session's ••• menu, while the pane is on screen |

**New agent session is a picker, not an action, and it needs an open task.** A session is created
against a task worktree, so there is nothing to start one in when no task is open and the palette
hides the row rather than offering one that can only fail. Which harness runs it is a choice, and the
list comes from the node, so the row is a search whose provider loads once when the frame opens and
filters on this machine as you type (`localSearch`,
`packages/client-core/src/host/registries/commands/localSearch.ts`) — the roster does not move while
somebody is typing, and a request per keystroke would buy nothing. Only installed harnesses are
listed: an absent CLI cannot start a session, and the pane's provider cards are where the diagnostic
saying why belongs. The create itself goes through `managedAgentStore.startSession`, the same call the
pane's New picker makes, so the palette is not a second way to write one.

**The search is task-scoped although the route is not.** The route behind it takes a workspace as
happily as a task, and Agent Center asks it that way. But a row from another task can only be opened
by activating that task first, and that navigation belongs to a router a plugin has no handle on. A
search whose rows cannot all be opened is worse than a narrower one, so the palette asks about the
captured task and Agent Center stays the surface that spans them. The node ranks the rows and the
device does not re-rank them, a request is capped at 50, and each row carries the task it came from,
so a stale context cannot send a pick to the wrong pane. Selection goes through the same retained
path Agent Center uses (`plugins/agents/src/client/sessions/managedSelection.ts`) rather than a
second one of the palette's own.

**The two harness terminals belong to this plugin, not to the shell.** The desktop carried them by
name until 2026-08-31, which meant a third harness needed a shell edit. The profile ids are this
plugin's (`plugins/agents/src/server/profiles/index.ts`), so the commands are too. The shell keeps
the drawer toggle and the plain shell, because neither of those belongs to a harness.

**Each setting shares one accessor with its Settings page, so the two cannot drift.** The first
writes through `writeAgentSessionDefaults`
(`plugins/agents/src/client/settings/sessionDefaultsClient.ts`), which owns the optimistic cache
write and the refetch on failure; the second through `saveAgentToolFoldMode`
(`plugins/agents/src/client/sessions/toolFoldPrefs.ts`), which also spells the three choices once for
the page's picker and the command's options. Both accessors take a query client, and there is none at
plugin init, so these two register from a component mounted in the `overlay` slot
(`plugins/agents/src/client/AgentCommands.tsx`) instead of at boot. That makes them desktop-only: the
terminal draws no overlay slot and has nowhere to store a device preference, and a choice that would
quietly fail to persist is worse than an absent row.

**The session's own actions are registered by the pane, for as long as the pane is drawn.** They need
a selected session, which only the pane model has, and two of them — rename and archive — are dialogs
the detail region draws, so a row offered while that region is unmounted would run and show nothing.
Mounted is therefore the gate: you can reach these when you are looking at the run they are about.
The pane model stays the only place the roster is written
(`plugins/agents/src/client/sessions/agentPaneModel.ts` § `sessionActions`). Nothing is enumerated a
second time in `commands.ts`: the label, the availability and the work are read back out of that memo
when the row is drawn and again when it is picked, so a session that gains an action gains a command
with it, and an action the menu would draw disabled is not offered at all — the menu puts the reason
on the row and the palette has nowhere to put one. Registration is redone only when the set of ids
changes, so typing in the palette never races a re-register. The command registry's mutation path is
non-tracking, so this reactive reconciliation depends only on that id roster and cannot subscribe to
its own register/dispose writes.

What is missing is deliberate. Stop stays out: it is the one destructive verb here, and it needs the
runtime state a low-context row cannot carry. Unarchive and import belong to Agent Center, which is
the surface that spans tasks. Pricing and concurrency are forms: a number has no list of labelled
choices to pick from.

## Context, files, and attachments

Context is assembled by the Node from registered task sections and sent as an immutable snapshot.
Attachments are validated, task-scoped, stored through the shared blob cache, and referenced by
session records. Artifacts are authenticated no-store downloads; provider paths and worktree paths
are revalidated against the owning task. Raster image artifacts are fetched as authenticated bytes
and drawn inline in the transcript with their download action. Other artifact media types keep the
download row.

A sent attachment is drawn the same way, from the same kind of route
(`GET /v2/p/agents/attachments/:id/content`, no-store and `nosniff`, guarded by the attachment's own
task). Each one is a tile that sizes to its own contents: a picture draws as a cropped band above its
filename and opens full size in a modal on press, and anything else draws an icon above its filename and
downloads on press. The turn's text names each attachment as `[Attachment: <id>]`, which is what a
harness receives, and the transcript drops that line once it has a card to draw in its place. Reading these bytes is deliberately wider than the draft-attachment read
below: a claimed attachment is out of a plugin's reach and is exactly what its own sender wants to see
again.

### Draft attachments, and replacing one

An attachment on an unsent turn is a draft: a row and a content-addressed blob that no turn references
yet. The composer owns which ones are in the turn, as an array in client state with the ids in local
storage; the node owns the content. Sending a turn is what turns a draft into evidence, and stored
bytes are never edited in place — content addressing, deduplication, draft recovery and the record of
what a turn contained all rest on that.

Another plugin may draw an attachment instead of the composer's chip, and may hand back an altered one.
Two seams make that possible without letting it reach past either owner.

`agents.draftAttachments` is a node capability with exactly two methods
(`plugins/agents/src/contract/draftAttachments.ts`). `read` returns one PNG or JPEG of a named task
that no turn has claimed, as bytes — never a filesystem path — and answers `null` for every refusal,
because saying which kind of no would answer questions about rows the caller may not see.
`createReplacement` stores an altered copy through the ordinary upload path: same 10 MiB ceiling, same
magic-byte validation, same safe-name normalization, same deduplication, so bytes identical to the
source come back as the source and an edit that changed nothing is a no-op. It rechecks the source
immediately before writing, because an editor stays open while a person draws and the turn can be sent
in the meantime. A loaded plugin declares `requires.plugins: [{ id: "agents" }]` and the capability in
`permissions.node.capabilities`, and resolves it at call time rather than at init.

Neither method replaces the draft or deletes the source, deliberately. The node does not own the unsent
client array and cannot transact with it, and deleting a source before the client has committed would
lose the reader's only valid attachment. So `createReplacement` produces a candidate, and the composer
commits it through the `agents:attachment` point's declared `replace` action
(`docs/plugins.md § Asking the owner`).

That commit is a compare-and-swap, which is the only meaning "atomic" can have across those two
owners: the id the contributor says it edited has to still be in that slot, the replacement has to
belong to the same task and be an image, and the draft's count and aggregate-size ceilings have to
still hold. Exactly one array element changes, order is preserved, and Submit and that slot's remove
are disabled while it runs. The new id is written to durable draft storage *before* the old one is
cleaned up, so a crash in between leaves an extra unreferenced row for the 24-hour sweep rather than a
draft pointing at deleted content. A rejected candidate is deleted on a best-effort basis and the
original stays.

Nothing downstream needed changing. The turn stores `{ type: 'attachment', attachmentId }` and both
drivers resolve the id to a local path at dispatch, so replacing the id before enqueue is the whole of
what makes the agent receive the altered image.

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

Only a turn moves a session into `working`. A harness can stream past the prompt call it was
answering, and `turn_completed` fires only as that call's return value, so an event carrying no turn
records into the transcript and marks the session unread without claiming work is in flight. Nothing
would clear the claim otherwise, and `working` blocks every later dispatch. Stop settles a session
that reports work with no turn to cancel, rather than returning quietly and leaving the button to act
on a state it cannot reach.

Interactive creation is accepted once its session row is durable, not once its provider process is
ready. A startup failure therefore settles that visible row as `failed` and records the error in its
event ledger; it is not reported as a late failure of a create request whose resource already exists.
The runtime tracks the detached initialization through shutdown so it cannot outlive the plugin
database.

Automatic and explicitly regenerated title calls have the same custody: the runtime owns one in-flight
operation per session. Session deletion aborts and joins that operation before deleting the row, and
shutdown aborts and joins every naming call before the plugin database closes.

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
`apps/node/src/composition/runtime.test.ts` exercises) never serves a request through the first boot's
closed database handle.

Each session mints its own scoped internal token rather than sharing one environment record. See
credential handling in [the security doc](./security.md). The list of secrets to redact out of
provider messages and transcripts is therefore collected as sessions start rather than computed once.

## Source map

The main implementation is in `plugins/agents/src/node`, `src/server`, `src/server/routes`, and
`src/client`. `plugins/agents/src/server/profiles/index.ts` and the terminal plugin supply the process and
profile boundaries.
