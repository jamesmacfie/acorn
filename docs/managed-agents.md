# Managed agents

The headless [CLI](./cli.md#commands) uses the same provider roster, durable session and
turn operations, event pages, and bounded wait route as the desktop Agent Center. It queues turns
through the Agents plugin; it does not drive raw terminal sessions or resolve approvals.

Session, turn, event, request, and attachment wire types live in
`plugins/agents/src/contract/wire.ts`. The pure tool-status tone shared with Changes lives in
`plugins/agents/src/contract/toolTone.ts`. Core receives only the small attention snapshot defined
by `packages/protocol/src/agents/attention.ts`; Agents maps its session rows to that snapshot.

The agents plugin manages structured Claude and Codex sessions. It stores a durable normalized event
ledger and exposes the same session through the Agent Center, task Agent pane, HTTP routes, and live
WebSocket streams.

## HTTP control authority

The paired desktop, terminal client, and headless CLI use device authority for provider discovery and
session execution controls. Session creation, transcript import, configuration changes, deletion,
turn creation and editing, plan implementation, forks, compaction, title generation, terminal
handoff, managed resume, imported resume verification, and request resolution require a device
principal. Service and task credentials receive `403` before the runtime is called. A task credential
cannot answer its own provider permission, question, or elicitation request on behalf of a human.

Task credentials retain task-scoped session reads, event replay, search, export, wait, attachment and
artifact access, and cancellation. An unknown or foreign opaque ID receives `404`. The direct
`/runs` source is node-wide and accepts device and service callers, while task callers use the
filtered core run list. Managed delegation and workflow execution call guarded capabilities and
the runtime directly. These HTTP controls do not replace tool permissions, signed ceilings, or
delegation admission.

## Session model

A session belongs to one task and provider profile. It contains turns, normalized events, permission
and question requests, attachments, artifacts, usage snapshots, and lifecycle state. Each session
event has a durable sequence. HTTP pagination is the replay authority, and the WebSocket is the live
tail.

On that tail, each recorded event goes out as an `agent:event` frame. The session row follows as an
`agent:session` frame only when the event changed something a client keeps, which is about one event
in 30 on a real ledger. `runtimeEngine.ts` compares the row with the last one broadcast, whoever sent
it, leaving out `lastEventSeq`, `updatedAt`, and each subagent's heard-from time. A
`session_metadata` event always sends, because it is the one event that writes `config`, and the
comparison skips `config` for its size. So a client's held row carries `lastEventSeq` and
`updatedAt` as of its last change, and the client leaves the row alone on an event frame: rewriting
the roster about 25 times a second woke every reader of it, and Agent Center redrew every row per
event. The pane's read mark is the one reader that needs the live sequence, and it reads it from the
event frames through `managedAgentStore.lastEventSeq(session)` (`managedStore.ts` § eventSeqs).
Agent Center's age and order come from the row, so a session that streams a long turn keeps the time
its turn started until its next change or the next list read.

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
written when the node creates the session. General configuration replacement retains
`workflowRunId`, `workflowStepId`, `delegationSpawnId`, the `customAgent` snapshot, `toolCeiling`, and
`mcpServers`. It cannot add, change, or remove those fields. Dedicated MCP selection can change the
server list after checking Settings. A fork carries its source's identity and authority snapshots.
Both durable `kind: 'workflow'` and the workflow config marker exclude a session from managed delegation.

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

`plugins/agents/src/server/sessions/runtime.ts` coordinates session commands with the provider
engine. `sessionTitleGeneration.ts` owns title requests and cancellation,
`sessionDefaultsCommands.ts` applies saved provider options, and `transcriptCommands.ts` imports,
verifies, and exports transcripts. `sessionWait.ts` checks live frames against the durable snapshot.
The runtime keeps the public methods and durable store boundary.

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

Every 60 seconds while telemetry is on, the engine also reports its provider processes as three
gauges: `agent.processes.live` (sessions with a running process), `agent.processes.idle` (those the
idle rules would stop now), and `agent.processes.memory` (the summed resident bytes of their process
trees). These are the numbers Settings > Storage and memory draws, from `processFootprint()`. Counting
memory runs `ps` through the process broker, so the sample is skipped while telemetry is off, and the
memory gauge is left out when the process table cannot be read.

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
Codex's `turn/plan/updated` steps remain a progress card. A completed `plan` item is stored as a
separate proposal with its item and provider turn IDs and shown in the transcript. For the latest
successfully completed interactive Plan turn under Acorn control, the shared desktop and terminal card
offers **Implement plan**. The Node checks the proposal and turn again in one SQLite transaction,
switches only the session's Mode option to Default, and queues one continuation in the same Codex
thread. The accepted turn records the proposal identity, so a second click or client reuses that turn
and a reload shows the proposal as handled. Planning question responses remain request resolutions;
they never accept a plan. A revision turn or a rejected handoff leaves Plan selected.
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

**What a built-in adapter is told depends on the session.** A built-in spec's `acpSessionMeta` is a
function of the session, sent on create and again on every resume, so it must return the same value
for the same session. Claude's uses it for two things. It turns off Claude Code's own
continue-after-usage-limit, and for a workflow or delegated session it appends the turn-ending
instruction to Claude Code's system prompt
([workflow execution](./workflows/execution.md#a-turn-that-ends-early)). The instruction goes in at
creation rather than partway through, because a system prompt that changes mid-session invalidates
the model's earlier thinking.

**A context part cannot pass for the reader's words.** Both drivers send a context part as an
`<acorn-context>` block (`plugins/agents/src/server/drivers/contextBlock.ts`). Its label and source
are escaped as attributes, and a closing tag inside its content is broken, because a loaded plugin's
label or a pull request body could otherwise end the block early and have what follows read as the
reader's message.

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
listed in **Settings > Plugins > Installed** and the owner can turn it off.

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
`defaultModelId`, `listModels` and `glyph`. Claude Code declares the CLI's own aliases, `sonnet`,
`opus`, `fable` and `haiku`, rather than dated model ids, because the CLI resolves an alias to whatever
it ships with. Codex reads the account's picker-visible models from the local Codex app-server's
`model/list` endpoint. Both harnesses offer **Use CLI default**, which omits the model flag so the CLI
can apply its own config. If Codex's catalog cannot be read, the picker says so and keeps a saved model
choice until it can be checked again.

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
rather than inherited. The user's own servers from Settings → MCP servers reach every harness,
Claude Code and Codex included, through the protocol on each start ([mcp.md](./mcp.md) § Your own
servers).

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
and Decline, and sends the chosen MCP action back to the provider. A Computer Use app-access request
is the one consent form that offers more, because it says how long a grant can last
(§ App-access approval). An answer travels back as the
option's own value behind the label a person picked, because the card answers with labels and Codex
numbers its own question options positionally. A question is answered in the same card, by the same
route, and against the same durable row as a permission (§ Client surfaces).

**A question the agent stopped waiting for is released with its turn.** No cancellation signal reaches
an elicitation handler, so a turn can end with a question still parked: the ACP request would never be
answered, the agent's own call would never settle, and the durable row would sit in the reader's
"Needs you" for good. The driver drains whatever is still parked when `session/prompt` returns,
answering each with `cancel` and recording a `request_resolved`, which is what releases the row.

**Which harnesses are installed and signed in is served from memory.** A probe starts each harness's
CLI, so `GET /v1/p/agents/providers` took 211 ms typically and up to 5 s. The Node keeps the last
answer and serves it at once. Once that answer is 30 seconds old, the next read still gets it and one
probe runs behind the read to replace it; callers that arrive meanwhile share that probe
(`ManagedAgentEngine.providers`, `plugins/agents/src/server/sessions/runtimeEngine.ts`). Three things
wait for a fresh probe instead: the first read after boot, a read after a harness was added or
removed, and `?force=true`, which the New menu's Refresh button sends. A session start or a delegated
spawn that the served answer would refuse, because the harness looks missing or signed out, probes
once more before it refuses, so installing or signing in to a CLI never needs a Node restart. Custom
agents, MCP servers, and session defaults are not part of this answer, so editing them drops nothing.

The Node probes harness availability and usage on bounded intervals. Usage and pricing details are
displayed in the Agent pane; pricing overrides are local preferences and provider prompts/responses
are not stored by the model-provider plugin. Settings > Limits and cost holds the built-in Claude and
Codex catalogues plus exact-model overrides, under the concurrency ceilings. Plan usage is per harness: the built-in CLI probes and a
contributed harness's `probes.usage` route feed one registry, and a harness with no collector shows no
usage section.

The Agent pane shows a refresh icon beside each harness's usage. It probes only that harness and
keeps the other readings in place. The full refresh action and five-minute polling still check every
harness; a single-harness refresh does not delay the next full check.

Each quota row draws a bar under its sentence, coloured by the same reading as the dot beside the
harness name, with a small triangle marking where a steady spend would have left the fill by now. A
percentage on its own does not say whether it is a problem: 20% left is comfortable an hour into a
week and alarming an hour into a five-hour session. The mark needs the window length as well as the
reset time, so a quota carries `windowSeconds` and a collector that cannot say leaves it null, which
draws the bar without the mark. The built-in probes know their own windows; a contributed harness has
no way to declare one yet. A reset further out than the whole window drops the mark as well: Codex
labels a row "Session (5h)" and then reports it resetting in four days, and a mark pinned to the right
end would read as miles ahead of pace when the truth is that the window is not the one acorn assumed.

### App-access approval

When a Codex agent asks Computer Use to operate an app, Computer Use sends a consent form through the
app-server's `mcpServer/elicitation/request`. Its `_meta` names the app by bundle identifier
(`tool_params.app`), gives the name a person reads (`tool_params_display`), and lists the scopes its
policy allows in `persist`: `['session', 'always']`, or `['session']` when policy forbids a saved grant.
The Codex adapter reads that shape into a typed `approval` on the request event
(`plugins/agents/src/server/drivers/codexAppApproval.ts`). The card then offers **Allow for this
session**, **Always allow** only when `always` was advertised, and **Decline**. It names the app with
its identifier, explains both scopes, and shows any warning Computer Use attached.

Computer Use owns every grant. Acorn stores the decision and never the grant. The answer goes back as
`_meta: { persist: 'session' | 'always' }`, and the integration's `node_repl` keeps a session grant per
Codex thread under `$CODEX_HOME/computer-use/sessions/` and an always grant in its own approvals file.
A later request it already holds a grant for is answered by the integration and never reaches Acorn.
A Codex thread is one managed session, so a session grant lasts as long as that session, and a fork
asks again. The grant belongs to the computer the agent runs on, which for a remote node is that
node's computer. Nothing synchronises it across nodes or devices.

To revoke an always grant, use Computer Use's own settings in the ChatGPT app. Acorn has no second
list, because two stores would disagree about what is allowed. A sent response is not proof the grant
was saved, so the settled card says Computer Use saves it and names where to revoke it. It never says
the grant exists.

The descriptor is additive in the request's stored payload. A row written before it existed, or a
request whose metadata is missing, malformed, oversized, or from another connector, reads as the
plain Allow and Decline it always was. An app identifier too long to store is refused, not cut short,
because a shortened bundle identifier names a different app. A form with fields stays a question
whatever its metadata says. Before claiming an answer, the runtime checks it against the options the
stored request offered. The adapter then rebuilds the response from the provider's original request,
so a forged option, an unadvertised scope, or a changed target never reaches Computer Use. The route
stays device-only (§ HTTP control authority), so an agent cannot approve its own access.

Always allow trusts an app identifier, not only the windows an agent launched. The agent test app has
an identifier of its own for this reason ([Local development](./local-development.md#native-control-of-a-session)).

The request shape was read from the integration's source (Codex Computer Use 26.915.1001093,
`@oai/sky` 0.7.5, codex-cli 0.159.2). A live capture and the grant lifetimes still need a real run
([Testing](./testing.md), checks 149-154).

## Provider-native subagents

Both managed harnesses can use their provider's native subagent feature, and such a subagent is
**not** a session. It cannot be
addressed, sent a turn, forked, or handed to a terminal, so making it a session row would be a lie in
every table that reads one. It is a projection instead: each session's row carries a `subagents`
roster, folded from that session's own `subagent` events by `recordEvent`, in the same transaction as
the event insert. The runtime broadcasts a session row whenever an event it records changes the row, and agent
frames are pushed to every client rather than subscribed to per id, so the task sidebar's sub-rows
appear and settle live for every session in the task, not only the open one, and nothing extra is
fetched. Each sub-row is inset behind a one-pixel left rule, aligned with its parent's text, to show
which parent owns it. The roster keeps every in-flight entry plus the last 20 settled ones; the full
history stays in the event ledger, which is what the transcript reads.

A session row also carries `queuedTurns`, the count of follow-ups waiting to dispatch. It is a column
on the session row, kept current by the store whenever a turn enters or leaves the queue, folded there
for the same reason as the subagent roster: the row is broadcast whenever it changes, so a value on the
row reaches every client live, and a count computed only when the list is fetched would be overwritten
by the next broadcast. A queued turn leaves `runtimeState` at `ready` or `working`, so without this
count the task sidebar has no way to mark a session whose only sign of a waiting prompt is the prompt
itself. Enqueuing a follow-up on a session held idle behind the concurrency limit broadcasts the row on
its own, because no event would otherwise wake it. The queue shows each waiting turn's text and its
image or file attachments with the same tiles used in the sent transcript. An attachment-only turn
shows the tiles without a generic input count.

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

A subagent's run reads as a conversation of its own, and both ends of it used to be locked inside a
tool call's parameters. The brief Claude hands a child rides in the spawning `Agent` call as one
markdown string; the report the child hands back rides the same way in its `SubagentHandback` call. As
parameters they render as pretty-printed JSON with every line break spelled out as `\n`, so reading
either meant expanding a tool card and picking prose out of an escaped blob. `PROSE_TOOLS` in
`acpNormalizer.ts` lifts each one out and posts it as somebody talking instead: a brief as a
`user_message`, since the parent plays the reader's part for its child, and a report as an
`assistant_message`. Both carry the subagent's id, so they land in that subagent's stream, and the call
they came out of keeps its title and its outcome and loses its parameters. `ExitPlanMode`'s plan was
the first of these and is now one entry in the same table. Codex needs no lifting: a child thread is a
thread, so its brief already arrives as a `user_message`, which `codexChildRouting` tags with the
subagent's id rather than dropping.

Claude sends a call's parameters on exactly one of its updates, and not always on the call itself: a
spawning `Agent` call arrives with an empty bag and a placeholder title, and the update after it
carries the real title and the whole brief. So the lift reads whichever update is carrying the
document, and a brief renders just under the spawn card rather than above it.

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
Above a managed parent's composer, one row per live direct child shows its title, runtime and
attention state, and the task title when the child belongs to another task. The rows use the same
session-list lineage projection and live session roster as the sidebar. Activating one opens its task
and managed session. Child updates do not remount the parent's composer.

Only a direct owner can address a child. A child may create one more level, but a third level is
refused. Each root admits at most 12 live delegated sessions in the reservation transaction, counting
rows still being created. The child inherits the intersection of the parent's signed tool ceiling
and any narrower ceiling requested at spawn. General session configuration updates cannot widen or
remove that persisted ceiling.

### Reports back to the owner

A turn an owner queues on its child, through `agent_spawn` or `agent_prompt`, carries a `delegation`
context part and, for a managed owner, `reportTo` in its effective policy
(`plugins/agents/src/server/delegation/reports.ts`). The context part names the owner and tells the
child that its final message is its report. It also tells the child to end the turn with a question
when it needs a decision, instead of asking the user. A turn the user types into the child's own pane
has neither, and does not report.

When a `reportTo` turn settles as completed, failed, cancelled, or interrupted, the Agents plugin
queues one `delegation_report` turn on the owner. The report text holds the child's title, the
outcome, any error, the final assistant message cut to its last 8 KiB, and the validated structured
result when the turn declared a `resultSchema`. The final message sits inside `<pasted_content>`
tags, which Claude Code's system prompt explains: text the owner's user didn't write, whose
instructions the owner follows only where its own user asked. A child that read a hostile page can
repeat what it read, and unmarked, that would reach the owner as a request. The transcript hides the
tags. A turn the model refused reports its outcome as refused, not completed. A `delegation_report`
context part names the child and links to it. The report queues behind whatever the owner is doing and never steers an active
turn. The owner answers by calling `agent_prompt`, and that turn reports in its turn.

The idempotency key `delegation-report:<child turn id>` makes delivery exactly-once. The trigger is
the post-commit `turn-changed` broadcast, which every settle path already sends. It is not durable,
so the startup reconcile pass looks for settled `reportTo` turns with no report and queues the
missing ones.

When a delegated turn pauses on a pending permission, question, or elicitation request, the
post-commit `request-changed` lifecycle event queues a separate informational report keyed by
`delegation-request:<request id>`. It names the child, the request kind, and bounded request text,
and links back to the child session. The parent can inspect the child, but a human resolves the
request in the child pane; no agent tool grants approval or response authority. Only a direct managed
owner whose turn carries `reportTo` receives this wake. Pending requests expire on restart, so the
startup reconciliation pass remains limited to settled-turn reports.

No report is queued in these cases:

- The owner cancelled the turn itself with `agent_cancel`.
- The owner session is archived or failed.
- The owner already holds 100 reports. Further results stay readable through `agent_read`.

A report still queued when the owner reads that result through `agent_read`, or cancels the turn,
is withdrawn. A read that lands between the child settling and its report being queued can leave one
redundant report. A terminal owner has no session to wake and keeps using `agent_wait` and
`agent_read`.

The transcript labels a `delegation` turn "From" and the owner's title, and a `delegation_report`
turn "From" and the child's title, using the matching context part
(`plugins/agents/src/client/sessions/turnSender.ts`). A workflow step's prompt is "Workflow", and
the turn acorn sends when a step's turn ended without its result is "Acorn"
([workflow execution](./workflows/execution.md#a-turn-that-ends-early)). Every other user turn is
"You".

Message headers show a small time in the reader's device timezone, styled like the sender label.
Hovering or focusing that time shows the full local date and time with its timezone and relative age.
Expanded built-in tool calls show the local date, timezone, and relative age below the command input;
the collapsed row has no time tooltip. The Node stamps every event when it records it. The conversation
projection keeps the first event's time when message fragments or tool updates fold into one card, so a
streaming card's time stays fixed.

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

type AgentWebStatus = { code: number; text?: string }
type AgentWebActivity = { action?: AgentWebAction; results?: AgentWebResult[]; status?: AgentWebStatus }
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

**A fetched page's HTTP status is its own field**, read from `toolResponse.code` and `codeText`.
Claude Code reports a 404 as a completed call whose result is a note saying the body was not
retrieved, so without the status a missing page finishes with a green dot. The status sits beside
the action rather than inside it, because it arrives on an update that carries no request and the
fold replaces an action whole. The open card always shows it. The closed row shows it only outside
2xx, in the warning tone, after the host. `toolResponse.url` is the requested URL even when the page
redirects, so there is no final address to show, and the redirect target appears only in the
provider's prose.

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

## File changes

A `file_change` event records what one step of the agent did to a file. Its `patch` is that file's
unified hunks, from the first `@@` on with no file header, which is the shape GitHub returns and the
diff rows parse. The exception is Codex's whole-turn diff: it has no `path`, and its `patch` is a
multi-file git patch. The transcript draws the patch in place (see
[client surfaces](./managed-agents/client-surfaces.md#client-surfaces)). The diff is what the step
did when it ran, so a later step that changes the same lines leaves it as it was.

```ts
type FileChange = {
  type: 'file_change'
  path?: string
  patch?: string
  summary?: string
  subagentId?: string
  changeId?: string        // the tool call, Codex item, or `turn:<id>` this belongs to
  snippet?: boolean        // the hunks count lines from an excerpt, not the file
  patchArtifactId?: string // the patch went to this artifact instead
}
```

**Agents report one edit more than once, so `changeId` names the edit.** The transcript keeps one row
per change id and path, holding the latest report, in the place the first one opened. Codex streams
`item/fileChange/patchUpdated` before the `fileChange` item completes, and re-sends `turn/diff/updated`
with the whole turn's diff every time it grows. Claude sends an excerpt when an edit starts and the
real hunks once it has run. So each edit is one row, and each turn has one whole-turn row showing the
latest diff. The ledger stores each edit the same way: its first report, which fixes where the row
sits, and its latest ([client surfaces](./managed-agents/client-surfaces.md) § The transcript store).

Each driver builds the patch from what its provider sends:

- **Codex** sends `changes: [{ path, kind: { type }, diff }]` on both the item and the patch update. For
  an update, `diff` is already headerless hunks. For an added or deleted file it is the file's whole
  text, which the normalizer turns into hunks. Before this, the patch update read `params.path` and
  `params.patch`, which Codex never sends, so every one of those events was stored empty. The item
  kept its paths only.
- **ACP** diff blocks carry `path`, `oldText` and `newText`, which the normalizer turns into hunks with
  the `diff` package. A missing `oldText` is a new file. ACP means the texts to be whole files, but
  Claude's adapter sends the edit's `old_string` and `new_string` when the call starts, so their line
  numbers count from the top of the excerpt. That change is marked `snippet`, and the thread leaves its
  line numbers blank rather than guess. Once the edit has run, the adapter sends each real hunk as its
  own block, with the hunk's first line as the matching entry of `locations`. Those hunks get their
  real line numbers, and they replace the excerpt under the same change id.

A patch over 64 KiB goes to an artifact, like large command output, and the event keeps
`patchArtifactId` in place of the patch. Events stored before patches were kept have neither, and
their row still opens Changes, as it always did.

## Client surfaces

For the full contract, see [Managed agent client surfaces](./managed-agents/client-surfaces.md#client-surfaces).

## New-session defaults

Inline diff chats are interactive managed sessions with a typed `origin` on the durable session row.
The origin records the task, source, path, side, line, patch key, and original quote; a local origin
also records staged or unstaged scope, while a PR origin records its repository and number. The
Agents client capability supplies the compact diff card to Changes and GitHub without either plugin
owning transcripts. The card draws the thread's chats-only view with the thread's own cards: the
messages, and any question the agent asks, which the reader answers in place. Tool calls and other
activity stay in the full session in Agents. The header leads with the session's state mark, the same
one the sidebar draws. **Hide** folds a chat
down to its header line, the way a resolved review thread folds, for the rest of the app session.
The inline message field sends with the same commit chord as the agent thread: Command-Enter on
macOS or Control-Enter on Windows and Linux. Enter alone inserts a newline.
The task sidebar groups these sessions under Inline chats. A patch change
detaches the card from the line while leaving the session and its original context available in
Agents. The client marks a session stale once it has seen that diff's newer document.

Inline chats have separate provider, model, and effort defaults in the existing session-defaults
preference. Their sparkle picker opens above the send row with the provider and model choices beneath
a Read only / Write access control. Each new chat starts with Read only selected. When the provider
advertises a read-only permission profile, the requested profile is applied before the first turn;
otherwise the card labels the choice best effort and asks the agent not to write. Write access is an
explicit per-chat choice.

A new session starts on the settings the owner last used, not on the provider's own choice. Switch
Codex to a higher reasoning effort in one session and the next Codex session starts there.

Nothing in this is per-provider. A provider already advertises its options as `AgentConfigOption[]`
when a session starts, so a default is a value keyed by the provider id and the option id it came
from. A harness added later is defaultable the moment it advertises anything, and a new kind of
option, a fast mode say, needs no change on the acorn side to be remembered.

One `prefs` row (`agents:session-defaults:v1`) holds seven fields. `followLastSession`, on by
default, decides which of `last` and `pinned` applies. `last` is written by the runtime whenever a session's
option changes, and `pinned` is written by the owner under Settings > Harnesses and defaults. Neither writer
sends the other's field, and the write merges server-side, so the Settings page cannot flatten a
switch made while it was open. `continueAfterUsageLimit`, also on by default, controls the durable
usage-window continuation described under Operations and failure. `stopIdleAfterMinutes`, 30 by
default, is **Stop idle agents after** under an Idle agents heading: 15, 30, or 120 minutes, or 0 for
Never. It is described under Operations and failure too. `keepArchivedHistoryDays`, 0 by default,
is **Keep agent history for archived tasks** under an Archived tasks heading: 30, 90, or 365 days, or 0
for Forever. It is described under Operations and failure as well. `inline` holds the inline chat
choices above.

Settings > Harnesses and defaults (`plugins/agents/src/client/settings/AgentSessionDefaultsSettings.tsx`)
lists each harness the node declares and whether this machine can run it, then these fields. Its
new-session rows say they seed new sessions only and name the control that changes an open one: the
pickers in the session's composer, and `/mcp` for the servers a session starts with. The same page
holds **Send task context at startup**, core's `startup_context_injection` preference, which decides
whether an agent started in the terminal drawer is sent the task's pull request, linked issues, and
notes. It moved from the Terminal page because it is part of what a session starts with. It also
holds **Tool call display**, which is this device's and carries a **This device** chip.

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

## Custom agents

A custom agent is a saved start for a managed session: a harness, the provider options it starts on,
text for its system prompt, and a ceiling on acorn's own tools. It shows up under **New** in the Agent
pane, on the empty pane's cards, and in the command palette. Triggered workflows stay the tool for a
job with several steps. A custom agent is one session with a known setup.

The record is `CustomAgent` in `plugins/agents/src/shared/customAgents.ts`. Its options are the same
`optionId -> value` table a session default is, because model, reasoning, and permission mode are all
options a provider advertises about itself (§ New-session defaults). Nothing in the record names one.
`maxToolRisk` is the highest risk of acorn tool the session may call, and like every ceiling it only
narrows ([agent-tools.md](./agent-tools.md)).

**Two feeders, one list.** The owner's own agents are one `prefs` row per user,
`agents:custom-agents:v1`, beside every other agent setting. A plugin's are held in memory for as long
as the plugin is enabled, and are never written anywhere (§ From a plugin). `GET
/v1/p/agents/custom-agents` answers the owner's first, in order, then every plugin's. `POST`, `PUT
/:id`, and `DELETE /:id` write the owner's and are device only, because an agent decides what a later
session's system prompt says, and a task-scoped agent must not be able to write one. A plugin's agent
refuses a write, and Settings offers **Duplicate** for it instead.

**The node reads the agent, not the caller.** `POST /sessions` takes `customAgentId`, and
`reserveSession` copies what the session keeps onto its `config`: a `customAgent` snapshot of id,
name, glyph, and instructions, the agent's options as `requestedConfigOptions`, and its ceiling as
`toolCeiling`. A `customAgent` a caller put in `config` itself is dropped, and an agent on a different
harness from the one named is refused. The options go on after the owner's defaults, so an agent that
names only a model still starts on the owner's reasoning level, and applying them does not write the
owner's `last` values.

**Drivers read the snapshot, never the live list.** Editing an agent changes the sessions started
from it later, not the ones running, and a resumed session is told exactly what it was told at
creation:

- Claude Code appends the instructions to its system prompt through `acpSessionMeta`, ahead of the
  unattended turn-ending text when both apply.
- Codex sends them as `developerInstructions` on `thread/start` and `thread/resume`.
- Any other harness has no system prompt acorn can reach. The generic driver sends the instructions
  as an `<acorn-context>` block with source `context.agent.instructions`, ahead of the first prompt of
  each provider session it creates, and never to one it picks back up. A compaction can drop them,
  and the editor says so. A harness spec opts out of this with `systemPromptInstructions`.

The session header draws a chip with the agent's name from the snapshot, so renaming or deleting the
agent leaves it alone.

**Settings > Custom agents** lists your agents with **Edit** and **Duplicate**, and a plugin's under
**From plugins** with **Duplicate** only. An agent opens in the same pane, with the settings header
naming it and a back link to the list. The editor saves on its button rather than on each change,
unlike the rest of Settings, because an agent needs a name and a harness before it can exist, and it
asks before you leave with changes. **Delete agent** sits in its danger zone and asks first. Its model,
effort, and mode pickers are read off the newest session that advertised them, the same way Harnesses
and defaults reads them, with the same limit: a harness you have not run inside the 50 most recent sessions shows no
pickers until you run it again.

**Another agent can start one by name.** `agent_spawn` takes `agent`, a name or an id
([agent-tools.md](./agent-tools.md) § Managed-session orchestration). The lookup is by id first, then by name ignoring
case.

**Not built.** Tool servers from Settings > MCP servers, which wait for that list to exist, and a workflow step
naming an agent in place of `profile` and `config_options`.

### From a plugin

A manifest declares agents in `contributions.customAgents`, up to eight: `{ id, name, glyph?,
description?, harness, options?, instructions?, maxToolRisk? }`. Data only. It names no program and
cannot bring a tool server, because a server is a program to run, which is what `agentTools` is for.

Delivery is the harness seam's (§ Harnesses). The composition root carries the entries on the loaded
plugin binding, and `node-core/server/pluginHost/host.ts` hands each one to the host-only
`customAgents` facet after every init, which forwards to the `agents.customAgentRegistry` capability
this plugin publishes. The host mints the id as `<pluginId>:<id>`, and qualifies `harness` when it
names one of the manifest's own harnesses; any other harness id, such as `claude`, passes as written.
A package that declares only agents or harnesses still gets a plugin row with an empty `init`, so the
owner can turn it off (`contributesNodeData` in `node-core/server/plugins/manifest.ts`). A compiled
plugin calls the capability itself.

The instructions are the grant. They are text the plugin puts into the system prompt of every session
an owner starts from the agent, so the trust prompt shows them in full under **Declared**, beside the
context sections, and they are in the grant key, so a version that changes one word asks again.

## From the command palette

Seven rows, one more per custom agent, plus the open session's own actions, all registered by this
plugin rather than by the shell.
[command-palette-and-shortcuts.md](./command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](./plugins.md) § Command kinds holds the vocabulary.

| Row | Kind | What it does |
| --- | --- | --- |
| New agent session | search, task-scoped | Lists the harnesses this node has installed, then the custom agents on them, and starting one creates the session, selects it, and shows the Agent pane |
| New *agent* session | action, task-scoped | One row per custom agent, so typing its name finds it without opening New agent session first. Desktop only |
| Open Agent Center | action, no scope | Selects the `agents` rail source, which is this device's view of the node rather than a property of a task |
| Find an agent session | search, task-scoped | The node's own search over session titles, events, and artifacts, asked about the task the palette session captured |
| New Claude Code terminal | action, needs an open task | Creates a terminal on this plugin's `claude-code` profile, opens the drawer, and focuses it |
| New Codex terminal | action, needs an open task | The same for the `codex` profile |
| Start new sessions with my last model | setting, no scope | On and Off over `followLastSession` (section New-session defaults) |
| Tool call display | setting, no scope | The three Tool call display choices: start collapsed, start expanded, and carry my last one forward |
| Agent session | group, task-scoped | Fork, retry, compact, continue in terminal, regenerate title, rename, the two exports and archive — the open session's ••• menu, while the pane is on screen |

The JSON session export includes `version: 1` and `baseline: "acorn-1"` alongside its snapshot.

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
Archive skips its dialog when there is nothing to lose: the session has no turns and its draft is
empty, not counting the task context the composer attaches on its own (`sessionIsBlank`).
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
(`GET /v1/p/agents/attachments/:id/content`, no-store and `nosniff`, guarded by the attachment's own
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
sets both under Settings > Limits and cost. The provider ceiling is counted against one agent CLI
across the whole node, which is what holds a single provider account to a few turns at once. The
workspace ceiling is counted across all providers in one workspace. Both live in one `prefs` row
(`agents:concurrency:v1`), read per scan rather than captured, so a raise applies to the scan the write
triggers. Absent or unreadable, the built-in 2 and 3 stand.

The dispatcher is edge-triggered: it scans the queue when a turn is enqueued, when a provider starts,
and when a turn settles. A scan that starts nothing rescans when a call arrived while it was running,
because that call's turn cannot be in the snapshot the scan is working from, and the reconcile pass
runs one scan at boot. Without both, a turn queued at the wrong moment waits for an unrelated session
to finish a turn before anything looks at it again.

**A plan usage limit pauses the same logical turn until the account resets.** The runtime first needs
two independent facts: a provider error that looks like a usage or rate limit, and that harness's
fresh usage collector reporting every depleted quota with an exact reset time. It waits for the
latest depleted window, adds a short boundary grace period, stores that time and a continuation prompt
on the active turn, and moves the turn back to the durable queue. The original input, turn id, source,
and effective policy stay intact, so workflow and delegation callers continue waiting for the same
operation. At the stored time the dispatcher sends the continuation prompt into the existing provider
session; the attempt counter advances and the final provider completion settles the turn normally.

The queue time survives a Node restart and the transcript says when Acorn will continue. The queued
card shows the same time and may be removed by the owner. Settings > Harnesses and defaults exposes
`continueAfterUsageLimit`; turning it off leaves later limit errors on the ordinary failure path.
Harnesses do not need a continuation-specific hook. A built-in or contributed harness gets this
behavior when its normalized failure names the limit and its registered usage collector returns
depleted quotas with `resetsAt`. A collector with no exact reset cannot schedule safely and the error
remains a failure. This also keeps short transient rate limits out of the hours-long queue unless the
plan collector confirms that an account window is exhausted.

Claude Code has its own process-local automatic continuation. The Claude harness disables that for
ACP sessions through the adapter's session metadata, so the Acorn setting is authoritative and a Node
restart cannot lose the wait. This does not change Claude Code sessions launched directly in a
terminal; they continue to use the owner's Claude setting.

Cancellation, timeout, provider disconnect, and restart are explicit states. A live stream can be
lost without killing the provider process, and the client reattaches from the session sequence or
terminal replay tail.

A provider process runs until something stops it: the session is archived or deleted, its MCP servers
change, it moves to a terminal, its task is archived, it sits idle past the owner's limit, or the node
exits. Each one holds an agent CLI and its MCP servers, about 450 MB, and an idle Claude Code process
grows over time. Archiving the task and the idle limit are the steps that keep them from piling up,
because nothing else stops a session nobody will prompt again. The plugin handles core's
`core:task-archiving` hook ([plugins/node-side-extension-points.md § Hooks](./plugins/node-side-extension-points.md#hooks)),
which runs whether or not the owner ticked anything in the archive dialog. It runs before the worktree
is removed, because a turn in progress is still writing into that folder. For each of the task's live
sessions, `stopTaskSessions` in `runtimeEngine.ts` stops the process, marks an active turn
`interrupted`, expires pending requests, and records `stopped` with "The provider process stopped when
this task was archived. Restore the task and send a prompt to resume." That is the record a restart
leaves, so nothing else changes. The sessions are not archived, and the archived task's Agent pane
still reads them. After a restore, the next prompt resumes the session as it does after a restart.

The idle limit is **Stop idle agents after** under Settings > Agents > Harnesses and defaults, 30
minutes unless the owner picks 15 minutes, 2 hours, or Never. `stopIdleSessions` in `runtimeEngine.ts` runs every five
minutes and reads the limit each time, so a change applies from the next sweep. It stops a live
process only when all of these hold:

- the process has started and is not being set up, stopped, or reconnected;
- no turn is in flight and none is queued;
- no request is waiting on the owner, because an approval or a question would be lost;
- no background subagent is still running, because it lives inside the provider process;
- nothing has come from the provider, and no turn has been dispatched or settled, for the whole limit.

Idleness counts from that last event, not from the start. A `ready` session records `stopped` with
"The provider process stopped after 30 minutes idle to free memory. Send a prompt to resume.", with
the limit that applied. That is the same record a restart leaves, so the client shows it as resumable,
and the next prompt starts the provider on the same conversation: Claude Code through `session/load`
on the stored reference, Codex through `thread/resume` on the stored thread. A `failed` session's
process is stopped too, since a turn error leaves it running, but nothing is recorded, so the failure
still shows. The next prompt restarts a failed session anyway.

Delegated children and workflow sessions get no exception. A delegation report, an `agent_prompt`,
and a workflow step all reach a session through `enqueueTurn`, which resumes a stopped one. A workflow
gate is a pending request, so it keeps its session. An idle child that has been stopped no longer
counts toward a delegation tree's 12 live descendants, the same as after a restart.

Settings > Storage and memory shows the agents on the node and offers the same stop without the
wait. The agents plugin draws its own section into core's `core:storage` point
(`client/settings/AgentStorageSection.tsx`), and reads `GET /v1/p/agents/footprint`, which answers
`AgentFootprint`: how many provider processes are running, how many the rules above would stop now,
their memory, and the size of the `agent-objects` and `agent-artifacts` folders. Memory is the resident
memory of each session's process tree, the provider child and every process under it, MCP servers
included. The engine keeps each child's process id on its driver handle (`pid` on
`AgentDriverSession`), lists every process once with `ps -A -o pid=,ppid=,rss=`, and walks down from
those ids (`server/sessions/footprint.ts`). Resident memory counts shared pages in every process and
misses compressed ones on macOS, so the page says "about". Where `ps` fails, or on Windows, the counts
are shown without memory. The folder sizes are measured at most every 30 seconds. **Stop idle agents
now** is `POST /v1/p/agents/stop-idle`, which runs `stopIdleSessionsNow`: the same rules through the
same code as the sweep, with no time limit and whatever the owner's limit is, Never included. A
`ready` session records "The provider process was stopped from Settings to free memory. Send a prompt
to resume." Both routes are device only, because they reach every task's agents. The section links to
Harnesses and defaults, where the idle limit and history retention are set.

The sweep is a timer the engine owns, not a node schedule
([schedules.md § What deliberately is not a schedule](./schedules.md#what-deliberately-is-not-a-schedule)).
What it sweeps is the engine's map of live processes, which exists only in this process, and the
owner's control is the setting above rather than a schedule row. The timer is armed by the first
provider start and cleared by `stop()` with the other engine timers.

**An archived task can give up its agent history, when the owner chooses.** Nothing else deletes a
session's events, and they are most of `plugins/agents.sqlite`. **Keep agent history for archived
tasks** under Settings > Agents > Harnesses and defaults is Forever unless the owner picks 30 days,
90 days, or 1 year.
The `agents:archived-history-prune` schedule runs daily at 03:50 and does nothing while it is Forever
([schedules.md § What is registered](./schedules.md#what-is-registered)). Otherwise it asks core for
the tasks archived longer than the limit, through `ctx.core.tasks.archivedBefore`, and removes the
history of each of their sessions. A restore clears a task's archive date, so a restored task is never
in that list, and neither is an active one.

History means everything the session owns except its row: its events and their search rows, its turns
and requests, the attachment references its turns hold, and its artifacts. Attachments and artifact
files nothing else references are then deleted from disk. The row stays, with one diagnostic event in
place of the transcript: "Acorn removed this session's history because its task had been archived for
more than 90 days." It is marked with `history_removed_at`, which is what makes a second run a no-op.
The row is kept, rather than deleted the way **Delete** deletes a session, for four reasons:

- The archive page previews an archived task through its Agent pane, and a restored task opens the
  same pane. Without the row, a pruned task would look as if it never had an agent. With it, the pane
  lists the session and the note says what happened.
- Other rows name the session by id: core's task pull relations, the delegation ledger, workflow
  steps, terminal handoffs, and memory proposals. They stay valid.
- The provider's own conversation is untouched. Deleting it would mean starting each session's CLI,
  which is what **Delete** does and what an unattended pass should not. So a restored task can still
  prompt the session, and the agent remembers what the transcript no longer shows.
- The row is small. The events are what take the space.

The pass never touches a session with a provider process in this node or a turn being dispatched or
running. It leaves those for a later run. The database is synchronous, so the pass works in steps: each
step is one transaction deleting 200 of a session's oldest events, and the node gets a turn between
steps. On 20,000 synthetic tool rows of about 2 KB, a step took a median of 7 ms. When a session's
events are gone, one last transaction removes its turns, requests, attachment references and
artifacts, writes the note, and marks the row. Core is asked for the list of tasks again before every
step, and nothing yields between that answer and the write, so a task restored part-way through keeps
whatever it still has. The run stops itself after four minutes, inside the scheduler's 300-second
ceiling, and the next day's run carries on. When it has deleted anything it merges the search index,
as the ledger compaction does. The file keeps its size; see
[data-layer.md § Retention](./data-layer.md#retention).

A window that has a pruned session open keeps the events it already drew until it reloads, because a
reader resumes after its mark and the pass deleted rows below it. The note arrives as an ordinary
event, and a reload shows only the note. The pass sends no delete frame, because the session still
exists.

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
