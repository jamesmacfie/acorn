# Phase 09: activity feed, session options, and request notes

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-07. Entry: phase 08 disposition
recorded. Next: [phase 10](./10-harness-bridges.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-09-session-reach`, at the commit titled "Phase 09: Activity feed,
session options, and request notes". The owning contracts are [activity](../../managed-agents/session-events.md#activity),
[session control](../../managed-agents/session-control.md), and the `agents:request-card` row in
[remote points](../../plugins/remote-points.md).

- **Activity feed.** `plugin:agents:activity` and `agents.activity.v1` in
  `plugins/agents/src/contract/lifecycle.ts`. A frame carries one item's whole state: a tool call
  (`toolCallId`, `turnId`, `kind`, `title`, `status`, up to 8 `paths`, `subagentId`), a subagent
  (`subagentId`, `turnId`, `title`, `role`, `status`, `background`), or the context fill
  (`contextUsed`, `contextSize`). `server/sessions/activity.ts` is the one projection the frames and the
  read share. `sessionRepository.recordEvent` hands the lifecycle the committed folded card and roster
  after the transaction, beside the turn and request announcements. The read takes each call's newest
  stored row, the session's subagent roster, and the newest context counts, 50 tools and 50 subagents
  at most.
- **Session control.** `agents.sessionControl` gains `setConfig(taskId, sessionId, optionId, value)`.
  `sessionControl.ts` checks the task, and `sessionConfig.ts`, loaded on first use, refuses archived and
  terminal-held sessions and any option or value the harness didn't advertise, then calls
  `runtime.patchSession` with the composer picker's own patch. `patchSession` takes `changedBy`, so the
  transcript reads "Effort changed to Xhigh by acorn-session-meter", and `remember: false`, so a
  plugin's change doesn't become the person's default. The `agents.sessions` roster entry gains
  `configOptions`, so a consumer can see what it may pick.
- **Caller binding.** `BIND_CAPABILITY_CALLER` in `@acorn/protocol/plugin/ids.ts`. `scopeCapabilities`
  hands a loaded plugin what the function under that key returns for its id, instead of the value.
  It's the capability counterpart of phase 04's `core.models.forPlugin`.
- **Grant.** A loaded plugin could already be granted `agents.sessionControl`, with the generic line
  "Use capability agents.sessionControl". `permissions.ts` in client-core now draws a host-owned, high
  line for it: "Stop your agent sessions’ turns, and change their model, reasoning effort, and other
  options, which changes what they spend". Both ids are in `CapabilityCatalogue`.
- **Request note.** `agents:request-card`, a `stack` point of up to two, registered in the agents
  client. `AgentRequestCard` draws the `Slot` under its own buttons while the request is pending, with
  `{ taskId, sessionId, requestId, kind, title }`. Both hosts draw it through their shared `Slot`.
- **Consumers.** [`packages/session-meter/`](./packages/session-meter/README.md) 0.1.0, new: a pane of
  the task's four newest sessions with context fill, tool calls, and the subagent tree, a **Cycle
  effort** button, and the palette command **Session meter: cycle reasoning effort**, delivered to the
  pane by `surfaceAction`. [`packages/permission-policy/`](./packages/permission-policy/README.md)
  0.4.0 adds three warn-only rules (a push, a recursive delete inside the root, a download piped into a
  shell) and a `client.js` tree that draws the warning in the request card.

No migration. The wire changes are additive: a new channel, a new capability id, a new method, a
roster field, and a point. Docs updated: [managed agents](../../managed-agents.md),
[session events](../../managed-agents/session-events.md), the new [session control](../../managed-agents/session-control.md)
page, [remote points](../../plugins/remote-points.md), [events](../../plugins/events.md),
[collaboration](../../plugins/collaboration.md), [security](../../security.md), and
[the docs index](../../README.md).

**Decisions and deviations.**

- **One frame per edge, not per update.** A tool call sends its start and its finish, never an output
  chunk, and the context count only when it changes. [Events](../../plugins/events.md) refuses agent
  steps by name, so the doc now names this channel as the one exception and why it still meets the
  other rules: each frame is an item's whole state, so a missed one heals.
- **Command lines are kept out by kind.** Codex and Claude title a command with its command line, so a
  call of kind `execute` is always titled `Command`. DeepSeek titles a call by its tool name. A
  harness that put a command line in another kind's title would leak it; none checked does.
- **Order is a display hint.** An output chunk moves a call's newest stored row without a frame, so the
  read and the applied frames hold the same items by id, not always in the same order. The contract
  and the test say so.
- **No rate-limit percentages.** No driver reports them per session. Plan usage is account-wide, on
  the providers page. The usage frame carries the context counts only.
- **Parents.** Harnesses report one level of subagents. A subagent's parent is the session, and a
  tool's `subagentId` names its subagent. On Claude the spawning `Agent` call is itself attributed to
  the subagent it started.
- **One grant line covers both calls.** The design asked for distinct trust copy for cancel and for
  option changes. One capability id is one grant, so the line names both. Splitting the id waits for a
  consumer that wants only `cancel`.
- **The caller is bound by the host, generically.** No capability knew its caller. The symbol is the
  smallest seam that lets a provider ask for it, and `sessionControl` is its one user.
- **The meter's tree applies frames itself.** Its node half only reads. The tree reads the rebuild
  once, subscribes to `plugin:agents:activity` through the broker, and applies frames for its task.
- **The policy's warnings live in memory,** up to 200, keyed by session and request. A Node restart ends
  the harness process that asked, so nothing pending loses its note.
- **A request-card extension's label should name the place.** The trust line quotes it: "Draw its own
  UI inside agents’s “request card”". The first label, "Why a request looks risky", read badly there.
- **The service boot budget rose 3.5 KB to 3,149,000 B.** HEAD measured 3,145,022 B. The activity
  projection and read, and the option change, load on first use. The per-event check, the usage
  dedupe, the roster field, the caller binding, and the point's constant load at boot.

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed, with the surface pin regenerated for the two
  catalogue ids. `apps/node` `pnpm build` passes the budget at 3,148,541 B.
- `lifecycle.test.ts`: tool, subagent, and context edges only, no command line, input, output, or
  message text in any frame, a view that reads midway and applies later frames holding what the read
  returns, the same read from a fresh store after a restart, and `null` for another task.
- `runtime.test.ts`: a bound `setConfig` changes the option through the picker path, emits the
  `agent:session` row, names the plugin in the transcript, leaves defaults alone, and refuses an
  unadvertised option, an unadvertised value, another task, a terminal-held session, and an archived
  one.
- `reload.test.ts` under Node 26.8.1: a real loaded worker calls a caller-bound capability and the
  provider sees the package's own id.
- `AgentRequestCard.test.tsx`: a contributor gets the request's identity, draws after the buttons, and
  is gone once the request is answered. `permissionLines.test.ts`: the high line.
- Suites: `@acorn/plugin-agents` 1,161 passed. `@acorn/node-core` under Node 26.8.1: 1,624 passed, and
  the 3 failures are `storage/backup.test.ts`. `@acorn/client-core`: 2,460 passed, with the known
  `scopes.test.ts` and `cssHygiene` reds. `@acorn/node` under 26.8.1: 272 passed, with the known
  `routeRegistry.test.ts` red. `@acorn/tui` under 26.8.1: 676. `@acorn/protocol` 294,
  `acorn-plugin-types` 5, `@acorn/plugin-workflows` 568. `@acorn/desktop`: 171 passed, with the 11
  known `clientPluginDisable.test.ts` cases, whose only difference is `terminal.run.setup`. The full
  `pnpm test` wasn't run.
- Packages: `node --test` passes in `session-meter` (3) and `permission-policy` (13).

Real host, `pnpm dev:agent -- --session pi-phase-09`, in a throwaway `/tmp` repository:

- Both packages installed through `POST /v1/core/plugins/install` and were `active` after a Node
  restart. The meter's trust prompt showed the new high line (`p09-meter-trust.png`), and the
  policy's showed the request-card line (`p09-policy-trust.png`).
- **Claude Code 2.1.292, Opus 5.5.** A turn read a file, ran `ls -la`, and started one `Explore`
  subagent. The meter, opened mid-turn, showed the calls, `Command` in place of the command, the
  subagent with its own calls, and a context meter at 42,061 of 1,000,000 (`p09-meter-claude.png`).
  With the pane open, a second turn's two calls appeared live, and the pane's items matched the
  rebuild read (`p09-meter-live.png`). **Cycle effort** moved High to Xhigh, and the palette command
  moved Xhigh to Max. The transcript read "Effort changed to Xhigh by acorn-session-meter", and the
  picker and session row showed the new value (`p09-agent-effort-changed.png`).
- In **Default** mode, `rm -rf /tmp/p09-repo/build` drew a permission card with **Permission policy**:
  "rm deletes recursively. Check what it removes before you allow it." under **Always Allow**,
  **Allow**, and **Reject** (`p09-request-card-note.png`). **Reject** was pressed by hand, the note went
  away with the pending state, the call failed, and the folder survived.
- **Codex 0.159.2, GPT-6-Sol.** A turn ran `cat`. The meter showed it as `Command` with 21,639 of
  258,400 context, and **Cycle effort** moved medium to high (`p09-meter-codex.png`).
- After a Node restart, the meter's read for both sessions was identical apart from the runtime state.
- Screenshots are in the session's ignored `.acorn/agent-dev/pi-phase-09/screenshots/`.

**Limitations.**

- **DeepSeek and `omp` weren't run.** Neither `dsh` nor `omp` is installed. DeepSeek's titles and
  usage come from its source (`references/deepseek-harness/packages/acp/acp/src/updates.ts`), and the
  shared ACP path is covered by the lifecycle test.
- **No Codex subagent.** Codex reports child threads, but the run didn't start one. The roster
  projection is the same for every harness.
- **No terminal-client run of the note or the meter.** The terminal fixture runs its own Node without
  either package. The note draws through the shared `Slot`, which the terminal host implements.
- **No real-host refusal of an unadvertised option.** No meter path sends one. `runtime.test.ts`
  covers it.

**For phase 10.** The consumer revisions at this commit are permission policy 0.4.0 and session
meter 0.1.0. The policy's warn rules sit beside its veto rules in `policy.js`, so `agents:before-tool`
can reuse `decide` and `warn` on the same subject. A bridged tool call reaches the activity feed only
through the ledger, so a bridge that adds calls the driver never reports won't show in the meter.

## Outcome

A loaded plugin draws a live view of a session's tool activity, context use, and subagents on every
harness, changes a session's advertised options under a high grant, and adds a warn-only note to a
pending request. None of this needs a bridge, because acorn already holds the data and the control.

## Design

The design as proposed on 2026-10-07. The implementation steps below refine it and win where they differ.

### Why

On 2026-10-07 the community directory at [claudemod.com](https://www.claudemod.com/browse) listed
172 entries across mods, skills, agents, commands, hooks, MCP servers, configs, and harnesses. Most
of them are content. The mods and hooks that are code fall into four groups:

| Group | Examples | Acorn today |
| --- | --- | --- |
| Live dashboards | Context and token meters, burn rate against the five-hour limit, cost, subagent trees, CI and pull request status | `agents:session-header` gets token and cost accounting. CI and pull requests are plugin data already. Nothing gives a plugin tool activity or the subagent tree. |
| Guards | Block destructive commands, confirmation codes, test-first guards | Phases 02 and 10. |
| Feedback after edits | Run the linter, type checker, or tests after an edit and tell the model | Phase 10's `after-tool` point. |
| Session control | Pause at a budget, cycle reasoning effort from a shortcut, desktop and audio alerts | `agents.sessionControl` offers only `cancel`, and only workflows calls it. No plugin can change a session's model or effort. |

Content is covered elsewhere: skills by [phase 06](./06-portable-skills.md), subagents by custom agents,
configs by context sections, and MCP servers by MCP management. Importing whole Claude Code plugin
bundles waits on [ecosystem](../ecosystem/README.md).

Three gaps remain that don't need a bridge, because acorn already holds the data or the control.

### Gap 1: a read-only activity feed

Every driver already normalizes tool calls, usage, subagent updates, and file changes into the
session ledger (`AgentNormalizedEvent` in `plugins/agents/src/contract/wire.ts`). That's true for
every harness, with no bridge. A plugin sees only turn, request, and session lifecycle events.

Add a bounded, harness-neutral projection:

- A `plugin:agents:activity` event for tool start and finish, carrying `toolCallId`, `kind`, `title`,
  `status`, and `paths`, plus subagent start and finish with its parent.
- A `usage` frame with context tokens, context window, and the rate-limit percentages the harness
  reports, when it reports them.
- An `agents.activity.v1` read that rebuilds the current state for one session, so a pane opened
  mid-session doesn't start empty.

Leave tool output, message text, and reasoning out. The title is what the transcript card already
shows. Command lines stay with the hooks, where the grant is explicit.

### Gap 2: changing a session's options

Extend `agents.sessionControl` with `setConfig(taskId, sessionId, optionId, value)`. Validate the value
against the options the harness advertised, through the same path the model picker uses. That makes
an "effort cycle" shortcut or a "switch to a cheaper model past 80% of the limit" plugin possible. It
is a high grant, because it changes what a person's session spends.

Leave `compact` out until a consumer asks. A budget plugin needs `cancel` too, so check that a loaded
plugin can be granted the capability rather than only the compiled workflows plugin.

### Gap 3: a note on a pending request

Open an `agents:request-card` remote point in `stack` mode, up to two, with props
`{ taskId, sessionId, requestId, kind, title }`. A policy plugin with warn-only rules shows why a
request looks risky without blocking it.

The point decorates the card. It never replaces the card or its buttons, so no plugin draws or
presses **Approve**. Confirmation codes and similar flows use phase 10's `ask` verdict instead.

### Later, each with its trigger

- **Notes on a message.** Claude's Mods can draw under any user or assistant message. Trigger: the
  advisor in [phase 04](./04-model-grants-and-advisor.md) needs to attach a concern to the turn it reviewed, rather than
  showing a card.
- **Plugin sounds.** Mods has `$.audio`. Acorn's notifications already alert on attention. Trigger: a
  request that notifications don't cover.

## Ownership and data flow

Driver normalized events → provider event materializer → agents ledger → bounded activity projection
→ lifecycle publisher and `agents.activity.v1` read → loaded plugin worker → remote tree in a pane or
`agents:session-header`. Option changes go plugin → `agents.sessionControl.setConfig` → the runtime
path the model picker uses → driver `setConfig` → `session_metadata` → clients.

Read `plugins/agents/src/contract/lifecycle.ts`, `plugins/agents/src/contract/wire.ts`,
`plugins/agents/src/server/sessions/sessionControl.ts`, the runtime's config option handling in
`runtime.ts`, the remote point table in [remote points](../../plugins/remote-points.md), and
`AgentRequestCard.tsx`. Agents owns every projection and the point. Plugins read public contracts only.

## Implementation

1. Define the activity frames and the rebuild read in agents' public contract. Project tool start
   and finish, subagent start and finish with parent, and usage snapshots from the materialized
   ledger. Keep tool output, message text, reasoning, and command lines out. Bound every string and
   the rebuild size.
2. Publish `plugin:agents:activity` from the lifecycle seam after events commit, never before. Make
   the rebuild read agree with the published frames after a Node restart and during replay.
3. Add `setConfig` to `agents.sessionControl`. Validate task and session ownership, then the option
   and value against the session's advertised options. Reuse the picker's path so persisted config and
   `session_metadata` stay consistent. Refuse terminal-controlled and archived sessions. Record the
   calling plugin in the session's diagnostics so a person can see who changed the model.
4. Check whether a loaded plugin can be granted `agents.sessionControl` at all. If it can't, add the
   grant with distinct trust copy for cancel and for option changes.
5. Open `agents:request-card` as a `stack` point, up to two, on both hosts. Props are
   `{ taskId, sessionId, requestId, kind, title }`. Draw it inside the card, below the host's controls.
   The host keeps the buttons.
6. Build a standalone session meter plugin as the consumer for steps 1 to 4: a pane with tool
   activity, context fill, and the subagent tree, plus a command that cycles reasoning effort.
   Extend phase 02's policy plugin with warn-only rules drawn through `agents:request-card`.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Prove:

- The same tool and subagent activity reaches the meter for Claude, Codex, and DeepSeek sessions,
  and a pane opened mid-session rebuilds to the same state.
- No activity frame carries output, message text, or a command line.
- An option the harness doesn't advertise is refused, and an accepted change shows in the session's
  picker on both clients.
- A request-card note appears on a pending request and leaves approval to the person.

## Documentation and handoff

Update [managed agents](../../managed-agents.md), [remote points](../../plugins/remote-points.md),
[events](../../plugins/events.md), and [security](../../security.md). Supply phase 10 with the
policy and meter package revisions.

## Verify before building

Recheck the usage fields each driver reports, subagent parent IDs per harness, lifecycle event
bounding, and loaded-plugin access to agents capabilities.

From the design:

- Which usage fields each driver reports, from a live Claude, Codex, and DeepSeek session.
- That `subagent` events carry a parent ID on every harness that reports subagents.
- The config option path the model picker uses, and whether it already accepts a non-person caller.
- Event bounding and grant projection for a new lifecycle channel.
