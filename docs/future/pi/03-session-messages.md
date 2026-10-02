# 03. Let a plugin queue a note on a session

Status: proposed, 2026-10-02. Not started.

## Why

An `omp` extension can push a message into a running session with `pi.sendMessage`, and choose when it
lands: steer the current run, follow up after it, aside at the next step boundary, or hold for the next
turn. That one call is what makes the advisor, the MCP-notification bridge, and most of `omp`'s
reactive extensions possible. Something outside the conversation notices a problem and tells the agent.

An acorn plugin can watch a session through lifecycle events and `agents.reviewInput.v1`, and can
change a prompt the person is sending through `agents:before-send`. It cannot speak first. The only
code that queues a turn on a session without the person is first-party: delegation reports
(`plugins/agents/src/server/delegation/reports.ts`) and workflows through `agents.sessionExecute`.

So the gap is one door: a plugin queues an attributed turn on a live session.

## What already exists

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

## The design

### An extension point, not a bare capability

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

### What the queued turn looks like

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

### Limits

- **Per plugin, per session.** Start at 20 queued messages per plugin per session, counted the way
  `countTurns(ownerId, 'delegation_report')` counts reports. Past it the call returns `cap` and the
  agents plugin raises one attention item naming the plugin.
- **Text size.** 8 KiB, the same ceiling as a delegation report's final message.
- **Unattended sessions.** A workflow or delegated session has nobody watching. A message still queues,
  because the advisor's main use is exactly the run nobody is reading, but it counts against the same
  cap and the run's budget sees the extra turn.
- **No message to a session that is not acorn's.** The `controller` check in `enqueueTurn` already
  refuses a session whose input a terminal holds.

### Delivery modes

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

### Trust prompt

Contributing to `agents:session-messenger` is a **high** grant, the same level as a veto, because it
spends a turn on the owner's provider and puts text in front of the agent. Host-owned copy: "can send
notes to your agent sessions, which start a turn". The plugin id and the verb come from fixed tables.

### The transcript

Draw a `plugin` turn like a delegation report: a compact row with the plugin's glyph and label, the
subject, and the context part folded. Desktop and terminal both. A blocked or capped message draws
nothing in the transcript; the attention item is enough.

## Steps

1. Add `plugin` to `AgentTurnSource` and the `sentBy` policy field. Check an older client's handling
   of an unknown source. Add the transcript row on both hosts.
2. Open `agents:session-messenger` and build the bound sender on `enqueueTurn`, with the cap, the
   idempotency key, and the refusal mapping. Test with the fake driver (`drivers/fake.ts`): a message
   on an idle session starts a turn, a message on a busy session waits, the twenty-first returns `cap`,
   a repeat key returns the first turn, an archived session returns `archived`.
3. Add the trust prompt line.
4. Prove it with [05](./05-advisor.md) and the [02](./02-before-permission.md) consumer before
   documenting it as shipped.
5. Document it in [managed-agents.md](../../managed-agents.md) beside managed delegation, and in
   [node-side extension points](../../plugins/node-side-extension-points.md) beside `findings:producer`.

## Verify before building

- `enqueueTurn` in `plugins/agents/src/server/sessions/runtime.ts`: still the only entry, and still
  runs `before-send` for every source.
- How `findings:producer` binds a writer to its contributor in plugins/findings/src/node/index.ts (retired; read from Git history),
  and how a loaded plugin contributes to a node-side point through `ctx`.
- How the transcript draws `delegation_report` turns, to reuse the row.
- Whether the client treats `AgentTurnSource` as a closed union anywhere that would throw on `plugin`.
