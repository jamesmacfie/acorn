# Phase 03: attributed session messages

Status: done with recorded limitations, 2026-10-07. Proposed 2026-10-03. Entry: phase 02 accepted
with its loaded policy consumer. Next: [phase 04](./04-model-grants-and-advisor.md).

## Completion note, 2026-10-07

**What landed.** On branch `phase-03-session-messages`, at the commit titled "Phase 03: Attributed
session messages". [Session messages](../../managed-agents/session-messages.md) is the owning
contract.

- `agents:session-messenger`, declared in `plugins/agents/src/contract/sessionMessages.ts` with
  `SessionMessage`, `SessionMessageResult`, `SessionMessenger`, `SessionMessengerContribution`, and
  the limits. A contribution's value is `{ connect(sender) }`. Agents calls `connect` with a sender
  bound to the host-minted `pluginId` of the entry, at `ready` and on every `plugins:changed`. The
  messenger itself, `server/sessions/sessionMessages.ts`, loads on the first contribution.
- Each `queue` call checks that its entry is still the live one, so a removed entry, a reloaded
  plugin's old sender, and a sender whose agents plugin stopped all throw at once.
- Refusals: `unknown-session` (missing, or in another task), `archived`, `unattended-not-supported`
  (workflow and delegated sessions), `not-controlled` (terminal-held or not interactive), `cap`, and
  `vetoed`. A malformed message throws. An unexpected failure rejects.
- The turn source `plugin` and host-written `effectivePolicy.sentBy: { pluginId }`. The visible text
  is the host's, `**<plugin id>** sent a note: "<subject>". It is not from the person…`. The plugin's
  text is one `pasted_content`-wrapped context part with source `plugin:<plugin id>`. The HTTP enqueue
  schema still refuses `plugin`, so no client can claim a plugin's identity.
- `TurnVetoedError` in `runtime.ts`, so a `before-send` veto maps to `vetoed` and every other error
  stays an error. `AgentStore.countPluginMessages` counts by `sentBy.pluginId` with `json_extract`.
- `senderLabel` draws "From <plugin id>" from `sentBy`. Both hosts render the transcript through the
  same `AgentEventCard`.
- Disclosure. `DISCLOSED_NODE_POINTS` in `@acorn/protocol/extensionPoints.ts` names the point and its
  fixed trust sentence, "Send notes to your agent sessions, which starts a turn on your agent
  provider", always high. A loaded package declares the point in `contributions.extensions` with no
  carrier, which the manifest schema allows only for a disclosed point. `buildPluginContext` refuses
  `ctx.extensionPoints.handle` on that point from a loaded plugin whose manifest didn't declare it,
  and the client's chrome pass skips the carrier-less entry.
- The policy package is 0.2.0, in [`docs/future/pi/packages/permission-policy/`](./packages/permission-policy/README.md).
  It adds `explanations.js`, a migration chain with `settings` and `explanations` tables, the
  `plugin:agents:request-changed` event and `agents.requests` capability grants, the messenger
  declaration, and a palette `setting` command, **Permission policy: explain refusals to the agent**,
  off by default.

No agents migration: `source` is a text column and `sentBy` lives in `effective_policy_json`. The wire
change is additive.

**Decisions and deviations.**

- **The exact backing module for atomic admission** is `SessionMessages#serialized` in
  `plugins/agents/src/server/sessions/sessionMessages.ts`. It's an in-memory promise chain per
  session. Inside it, the duplicate check, the session checks, the count, and `enqueueTurn` run in
  order. The count is read from the turn rows, so an accepted turn and its count are one write. No
  SQLite transaction spans the `before-send` hook. The Node is the only writer, which is why memory is
  enough.
- **Duplicates come first.** A repeated key returns the original turn before the archived, cap, and
  hook checks, and after the task association check, so a retry after a restart is idempotent even
  once the session is archived.
- **One bell row per plugin and session.** The first new key past the cap writes a
  `plugin-message.cap` row to `agent_operations` and raises `ctx.events.notice` with a
  `managed-agent` target. The operations row keeps a restart from raising it again.
- **The plugin id, not the plugin's label, names the sender.** The id is what the host mints and what
  the blocked card already shows. Agents has no host-owned label for a loaded plugin.
- **The subject is quoted, and `"` is refused in it.** A background security review flagged an
  unquoted subject in the visible text. Control characters, line and paragraph separators, and
  bidirectional overrides are refused too.
- **A disclosed node point is a small new protocol rule.** A node point had no manifest form, so
  without it a loaded plugin could join one with no consent line. The table holds one point. Built-in
  plugins aren't checked.
- **The policy switch is a palette `setting` command, not a settings page.** A settings page needs a
  client bundle, and this package has no build step.
- **The policy's veto route only records work.** Delivery waits for the resolved event and the
  `agents.requests` row whose `blocked.by` is the policy. Each `connect` replays every recorded
  refusal. A record whose request row never appears is dropped after 60 seconds.
- **The service boot budget rose to 3,123,500 B.** The build measured 3,117,860 B before this phase
  and 3,123,120 B after. The messenger (about 6 KB) is lazy. The point declaration and loader, the
  store count, the veto error class, the manifest rule, and the host gate load at boot.

**Verification.**

- `pnpm lint` passes. `@acorn/arch-tests`: 86 passed.
- `@acorn/plugin-agents`: 152 files, 1,130 passed. `sessionMessages.test.ts` drives a real runtime on
  the fake driver. It covers host-bound identity and host-written text, an idle session starting the
  note, a busy one queueing it behind the running turn, coarse refusals before the hook, a repeated
  key across a restart, 25 concurrent calls admitting exactly 20 with one bell row that a restart
  doesn't repeat, a `before-send` veto, UTF-8 byte bounds, subject rules, and revocation.
- `@acorn/node-core` under Node 26.8.1: 1,587 passed. The three failures are `storage/backup.test.ts`,
  which times out on 26.8.1 and passes its 12 tests on Node 24.11. `reload.test.ts` installs a folder
  package with a real loaded worker. The worker keeps a host-bound sender past `connect`, calls it,
  and echoes the answer it got back, and the host sees both calls under the package's own id. A
  package that files into the point without declaring it fails to start. `manifest.test.ts` covers
  the carrier-less declaration.
- `@acorn/client-core`: 2,454 passed. The two failures are phase 02's pre-existing ones,
  `scopes.test.ts` and the `cssHygiene` box-shadow ratchet. `permissionLines.test.ts` covers the
  fixed high line.
- `@acorn/protocol`: 294 passed. `@acorn/tui` under Node 26.8.1: 676 passed.
  `@acorn/plugin-workflows`: 568 passed.
- The policy package's `node --test`: 10 passed. `explanations.test.mjs` covers off by default, one
  note per confirmed veto keyed by session and request, no note for another plugin's veto or an
  ignored late verdict, a missed event recovered on the next connect, a failed send keeping its
  record, and a host refusal ending the work.
- `apps/node` `pnpm build` passes the service budget at 3,123,120 B.

Real host, `pnpm dev:agent -- --session pi-phase-03`, Claude Code through ACP, Opus 5.5:

- The package installed through `POST /v1/core/plugins/install`, and after a Node restart it was
  `active`. Its **Permissions** tab lists the veto and "Send notes to your agent sessions, which
  starts a turn on your agent provider", both marked **Broad access**.
- The palette read the switch as **Off** and then set it to **On**, which the route read back as
  `on`.
- In **Default** mode, `rm -rf /tmp/acorn-pi03-outside` drew no card. The transcript shows the
  resolved "Blocked by acorn-permission-policy" request, the agent's turn ending, then one turn
  labelled **From acorn-permission-policy** with its context manifest folded, then the agent saying
  it won't work around the rule. SQLite has one `plugin` turn with `sentBy`, and the policy's work
  table is empty. The directory survived.
- After another Node restart, no second note was sent.
- That Node bundle was staged before the subject quoting, so its visible text has no quotes. The
  quoting is covered by `sessionMessages.test.ts`.
- Screenshot `screenshot-1791329948184.png` is in the session's ignored
  `.acorn/agent-dev/pi-phase-03/screenshots/`.

**Limitations.**

- **Codex wasn't run to a refusal.** codex-cli 0.159.2 started a session, and the first turn answered
  "Usage limit reached" until 2026-10-10 10:44 AM. The messenger and the policy are
  harness-neutral, and the Codex refusal path is phase 02's. Manual check 157 in
  [agents and providers](../../testing/agents-and-providers.md) is owed for Codex.
- **No terminal-client PTY run of the note.** The terminal client draws the same `AgentEventCard`,
  and `turnSender.test.ts` covers the label. A PTY case was tried, but at 40 rows the note is above
  the visible transcript, and a taller screen changes the focus order.
- **Node switching wasn't exercised.** The session had one Node. The label reads only the turn row,
  which the selected-Node cache already carries.
- **Archived, terminal-held, and unattended refusals, cancellation of a queued note, and concurrent
  cap admission were proven in tests, not on the real host.** A queued note is an ordinary turn row.
- **DeepSeek and `omp` weren't run.** Neither is on this machine.
- **An older client labels a note "You".** The visible text still names the plugin.

**For phase 04.** Contribute the advisor's messenger through `agents:session-messenger`, and declare
it in the manifest with no carrier, or the node refuses it. Its notes count against its own 20-per-session
cap, because the cap is per plugin. Use a stable idempotency key per reviewed turn.
Workflow and delegated sessions answer `unattended-not-supported` until phase 05 changes
`SessionMessages#sessionRefusal`. The policy package revision is 0.2.0 at this phase's commit.

## Outcome

A loaded plugin queues an attributed note on an interactive Acorn-controlled session. The policy
consumer optionally explains a veto in one later turn. This phase ships a usable consumer with the
messaging seam. Explanations follow
[phase 02's explanation design](./02-permission-veto.md#addition-1-tell-the-model-why).

## Design

The design as proposed on 2026-10-02. Where it differs from the completion note above, the completion
note records what was built.

### Why

An `omp` extension can push a message into a running session with `pi.sendMessage`, and choose when it
lands: steer the current run, follow up after it, aside at the next step boundary, or hold for the next
turn. That one call is what makes the advisor, the MCP-notification bridge, and most of `omp`'s
reactive extensions possible. Something outside the conversation notices a problem and tells the agent.

An acorn plugin can watch a session through lifecycle events and change a prompt the person is
sending through `agents:before-send`. The bounded `agents.reviewInput.v1` reader was removed with
Findings; [phase 04](./04-model-grants-and-advisor.md) introduces a replacement. It cannot
speak first. The only
code that queues a turn on a session without the person is first-party: delegation reports
(`plugins/agents/src/server/delegation/reports.ts`) and workflows through `agents.sessionExecute`.

So the gap is one door: a plugin queues an attributed turn on a live session.

### What already exists

`ManagedAgentRuntime.enqueueTurn` in `plugins/agents/src/server/sessions/runtime.ts` is the one way a
turn enters a session. It refuses an archived session or one whose input another controller holds,
checks attached files against the task root, bounds the policy JSON, and runs `agents:before-send`
over the text. A turn that arrives while another is running waits behind it.

Delegation reports show the shape a non-person turn should take:

- The visible text is short and written by acorn. The sender's content goes in a context part with a
  label, a source, provenance, and a deep link.
- Content another agent wrote is wrapped with `pastedContent`, so it cannot pass for the person's
  request.
- An idempotency key makes delivery exactly once across restarts.
- `MAX_REPORTS_PER_OWNER` caps how many reports one session takes, because two agents answering each
  other is a loop with a provider bill.

### The shape

#### An extension point, not a bare capability

A capability is a function in a map. The provider cannot tell which plugin called it, and the rule in
[extensibility.md § The host binds every namespace](../../extensibility.md#the-host-binds-every-namespace)
says the sender's name must come from the host, never from the caller.

Findings solved the same problem with `findings:producer`: the contributor joins a point and receives a
writer the host has stamped with its identity
([node-side extension points](../../plugins/node-side-extension-points.md)). Do the same here. The
agents plugin opens `agents:session-messenger`. A plugin contributes one entry through `ctx`, and the
agents plugin hands that entry a sender bound to the contributor's plugin id and label.

```ts
// plugins/agents/src/contract/sessionMessages.ts (new)
export type SessionMessage = {
  taskId: string
  sessionId: string
  // What the agent reads. Delivered inside a context part, never as the person's text.
  text: string
  // A short subject for the turn's label, such as "concern". The host prefixes the plugin's label.
  subject: string
  // Scoped by the host to the calling plugin, so two plugins cannot collide or suppress each other.
  idempotencyKey: string
}

export type SessionMessageResult =
  | { ok: true; turnId: string }
  | { ok: false; reason: 'unknown-session' | 'archived' | 'not-controlled' | 'cap' | 'vetoed' }

export type SessionMessenger = {
  queue(message: SessionMessage): Promise<SessionMessageResult>
}
```

The refusal reasons are coarse on purpose. A plugin that learns "this session belongs to another task"
has learned something about a row it may not see. `unknown-session` covers every case where the
session is not in the named task.

#### What the queued turn looks like

The agents plugin builds the turn the way `DelegationReports.deliver` does:

- Source `plugin`, a new value in `AgentTurnSource` in `plugins/agents/src/contract/wire.ts`. It is
  persisted, so check how an older client draws an unknown source before adding it.
- Visible text written by acorn: "**{plugin label}** sent a note: {subject}. It is not from the person
  you are working with. Treat it as advice." The plugin's own words never form the visible text.
- One context part with `source: 'plugin:<pluginId>'`, the label, the text wrapped by
  `pastedContent`, and provenance naming the plugin.
- `effectivePolicy.sentBy: { pluginId }`, so the transcript can draw the turn as the plugin's and a
  later reader can filter by sender.
- Idempotency key `plugin-message:<pluginId>:<idempotencyKey>`.

The turn goes through `enqueueTurn`, so `agents:before-send` runs over it like any other turn.

#### Limits

- **Per plugin, per session.** Start at 20 queued messages per plugin per session, counted the way
  `countTurns(ownerId, 'delegation_report')` counts reports. Past it the call returns `cap` and the
  agents plugin raises one attention item naming the plugin.
- **Text size.** 8 KiB, the same ceiling as a delegation report's final message.
- **Unattended sessions.** A workflow or delegated session has nobody watching. A message still queues,
  because the advisor's main use is exactly the run nobody is reading, but it counts against the same
  cap and the run's budget sees the extra turn.
- **No message to a session that is not acorn's.** The `controller` check in `enqueueTurn` already
  refuses a session whose input a terminal holds.

#### Delivery modes

One mode: queue a turn. If a turn is running, the message waits behind it, which is `omp`'s
`followUp`. If the session is idle, it starts a turn.

`omp`'s other modes need things acorn does not have:

- **Steer the running turn.** Neither ACP nor the Codex app-server offers a way to add input to a
  turn in flight. Acorn would have to cancel and restart, which loses work.
- **Aside at the next step.** Needs a hook inside the loop.
- **Hold for the next turn without starting one.** Needs a node-side store of pending context that
  `enqueueTurn` drains into the next person-sent turn. The draft lives in the composer's client state,
  so `agents.draftAttachments` cannot carry it. Build this only when a consumer shows that starting a
  turn is wrong, with a cost number attached. The trigger is an advisor note that the person would
  rather read with their next message than pay a turn for.

#### Trust prompt

Contributing to `agents:session-messenger` is a **high** grant, the same level as a veto, because it
spends a turn on the owner's provider and puts text in front of the agent. Host-owned copy: "can send
notes to your agent sessions, which start a turn". The plugin id and the verb come from fixed tables.

#### The transcript

Draw a `plugin` turn like a delegation report: a compact row with the plugin's glyph and label, the
subject, and the context part folded. Desktop and terminal both. A blocked or capped message draws
nothing in the transcript; the attention item is enough.

## Ownership and data flow

Host-qualified extension entry → agents-bound sender → task/session validation → durable admission
and idempotency → `enqueueTurn` and `before-send` → provider input → transcript and lifecycle →
selected-Node cache and shared compact plugin row.

Read `plugins/agents/src/server/sessions/runtime.ts`, the turn repository, delegation reports,
`plugins/agents/src/contract/wire.ts`, and core's extension registry. That registry supplies
`pluginId`; a caller must not provide its own identity or namespace. Callback methods cross the
loaded-worker RPC membrane, including a returned sender's asynchronous `queue` method.

## Implementation

1. Put the typed `agents:session-messenger` point, message, sender, and result in the agents public
   contract. Open the point in agents activation. Reconcile entries at the owner lifecycle seam,
   including late registration and disposal, and bind each sender to the host's entry identity.
   Do not cache the set at initial activation or expose a caller-named sender capability.
2. Validate task/session association before disclosing state. Keep the proposal's coarse refusal
   reasons and add an explicit `unattended-not-supported` result for this phase. Permit only
   interactive, unarchived sessions controlled by Acorn; a terminal-controlled session is refused.
3. Add the `plugin` turn source and host-owned `sentBy` metadata. Keep the visible subject bounded
   and single-line, including control-character validation. Put the plugin's text in an 8 KiB
   context part fenced as untrusted content. Prefix identity from the host and mark the note as
   advice. Do not let a transform of visible text erase stored sender provenance.
4. Enforce 20 accepted plugin messages per plugin per session, with a host-qualified idempotency key.
   Check duplicate keys before cap and hook side effects. Serialize or transact admission so two
   concurrent calls cannot both consume the last slot. Persist the accepted turn and count together
   without holding a SQLite transaction across an asynchronous hook. Retries after restart return
   the original turn. A new key over cap raises at most one durable attention item per scope.
5. Route admission through `enqueueTurn`, preserving file/policy validation, `before-send`, queue
   ordering, and the Node's pump. An idle session starts a turn; a busy one queues it. Map expected
   refusals to results and retain unexpected infrastructure failures as errors. Revoke old senders
   when the contribution or owner runtime retires.
6. Add fixed high-grant disclosure for the named point and draw the plugin row on both hosts.
   Trace any new metadata through storage, HTTP snapshots, broker events, query mapping, export,
   transcript search, and the terminal projection. Preserve saved older turn sources.
7. Extend the policy consumer with a separate messenger contribution and an off-by-default
   explanation switch. Use session ID plus phase 02's request ID as the idempotency key. A refusal
   is explained only after a resolved `request-changed` event and the `agents.requests` blocked
   summary confirm that this plugin's veto took effect. Declare the event and read grants; re-read
   committed blocked rows on startup so a missed notification does not lose an explanation.
   Store delivery work durably and deduplicate it by provider request ID. Never send from inside the
   veto route: a timeout may ignore its late verdict, and another handler may supply the actual veto.
   Queue failure must not undo a veto.
   Refusals in unattended sessions remain effective but have no automatic explanation until phase 05.
   This explanation turn is the fallback for harnesses without a bridge. Where
   [phase 10](./10-harness-bridges.md) installs one, a bridge veto carries its reason to the model
   inside the turn.

Do not make the hook queue notes, grant messaging implicitly with veto, steer a running turn,
cancel/restart to simulate steering, or add held-message delivery. Keep those refusals visible.

## Verification and acceptance

Apply [shared verification](./README.md#verification-for-every-phase). Through a real loaded worker,
prove host identity cannot be spoofed, foreign-task lookups are coarse, revoked senders fail, and
returned callbacks preserve asynchronous transport. Cover idle and busy delivery, a vetoed prompt,
Unicode byte bounds, restart duplicates, concurrent cap admission, and one attention item.
Prove an ignored late veto or a veto from another plugin cannot send a false refusal explanation.

Drive the policy consumer in real Claude and Codex sessions. One denied permission produces a
resolved request and one separately attributed explanation turn. Check desktop/terminal display,
Node switching, cancellation, archived sessions, and terminal ownership. An unattended attempt must
return `unattended-not-supported`, not silently spend an unowned turn.

## Documentation and handoff

Update [managed agents](../../managed-agents.md),
[node extension points](../../plugins/node-side-extension-points.md),
[plugin authoring](../../plugin-authoring.md), [security](../../security.md), and provider checks.
Document limits, idempotency scope, sender revocation, and interactive-only support. Give phase 04
the public contract and policy package revision. Record the exact backing module for atomic admission.

## Verify before building

Recheck `enqueueTurn` and duplicate-turn storage, extension registration lifecycle, generic
worker callback marshalling, unknown-source rendering, and trust projection for a node-side point.
Do not reuse the retired Findings implementation without checking it against the worker carrier.

From the design:

- `enqueueTurn` in `plugins/agents/src/server/sessions/runtime.ts`: still the only entry, and still
  runs `before-send` for every source.
- How `findings:producer` binds a writer to its contributor in plugins/findings/src/node/index.ts (retired; read from Git history),
  and how a loaded plugin contributes to a node-side point through `ctx`.
- How the transcript draws `delegation_report` turns, to reuse the row.
- Whether the client treats `AgentTurnSource` as a closed union anywhere that would throw on `plugin`.
