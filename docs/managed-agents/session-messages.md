# Session messages

A plugin can queue a note on an agent session. The note is a turn with the plugin's name on it, and
the agent reads it as advice, not as the person's request. This page covers the
`agents:session-messenger` point, what a note looks like, its limits, and what it can't do.
`plugins/agents/src/contract/sessionMessages.ts` declares the point and its types, and
`plugins/agents/src/server/sessions/sessionMessages.ts` runs it.

## Contribute a messenger

A plugin files one entry into the point from its node half. The agents plugin calls the entry's
`connect` with a sender bound to that plugin's id. Keep the sender and call `queue` whenever you
have something to say:

```js
ctx.extensionPoints.handle('agents:session-messenger', {
  id: 'notes',
  value: { connect: (sender) => { messenger = sender } },
})

const result = await messenger.queue({ taskId, sessionId, subject: 'concern', text, idempotencyKey })
```

A loaded package must also name the point in its manifest, with no carrier, so the grant is in front
of the person before anything runs:

```json
{ "id": "notes", "point": "agents:session-messenger", "label": "send notes to the agent" }
```

The node refuses an undeclared contribution, and the plugin fails to start. The person sees the grant
as "Send notes to your agent sessions, which starts a turn on your agent provider", marked high. That
sentence is the host's, whatever the manifest's label says.

The sender is the identity. The host takes the plugin id from the entry it minted, so nothing in the
message can name another sender. A field such as `pluginId` in the message is ignored.

`connect` runs again when agents reconnects its entries: once every plugin has started, and after
every plugin roster change. A reloaded plugin gets a new sender. The old one, and any sender whose
entry is gone or whose agents plugin stopped, throws on its next call. Senders cross the loaded
worker as asynchronous functions, so `queue` always returns a promise.

## What a note looks like

The turn's source is `plugin`, and `effectivePolicy.sentBy` is `{ pluginId }`. Both are written by
the host.

- The visible text is acorn's: `**<plugin id>** sent a note: "<subject>". It is not from the person
  you are working with. Treat it as advice.`
- The plugin's text is one context part, `source: 'plugin:<plugin id>'`, wrapped as pasted content so
  it can't pass for the person's words. The drivers send it as an `<acorn-context>` block.
- Both clients label the turn "From <plugin id>". An older client labels it "You", and its visible
  text still names the plugin.

The turn goes through `enqueueTurn`, so file and policy checks, `agents:before-send`, queue order, and
the dispatcher apply as they do to any turn. A `before-send` transform can rewrite the visible text,
but `sentBy` and the context part stay. An idle session starts the turn, and a busy one queues it
behind the running turn. A queued note can be cancelled like any queued turn.

## Limits and refusals

| Rule | Value |
| --- | --- |
| Text | 1 byte to 8 KiB of UTF-8. |
| Subject | One line, 1 to 80 characters, with no `"`, control characters, line separators, or bidirectional overrides. |
| Idempotency key | 1 to 128 characters, scoped to the plugin and the session. |
| Accepted notes | 20 per plugin per session. |

A malformed message throws. Every other refusal is a result:

| Result | When |
| --- | --- |
| `unknown-session` | No session with that id in that task. It's coarse on purpose, so a plugin learns nothing about another task's session. |
| `archived` | The session is archived. |
| `unattended-not-supported` | A workflow or delegated session. Nobody is watching it, and unattended notes wait for [phase 05](../future/pi/phases/05-unattended-follow-ups.md). |
| `not-controlled` | A terminal holds the session's input, or it isn't an interactive session. |
| `cap` | The plugin already has 20 accepted notes on this session. |
| `vetoed` | An `agents:before-send` handler refused the turn. Nothing is kept, and the note doesn't count. |

An error that isn't one of these, such as a database failure, rejects the promise.

A repeated key returns `{ ok: true, turnId }` for the first note, even after a restart. The check runs
before the cap and the hook, so a retry never counts twice or runs the hook again. Another plugin's
identical key is its own note.

The first new key past the cap raises one bell row for that plugin and session, linked to the
session. The agents operations table remembers it, so a restart doesn't raise it again.

## Admission

Each session admits one note at a time, in memory, in `SessionMessages#serialized`. The duplicate
check, the count, and the insert run in that order inside it, so two concurrent calls can't both take
the last slot. The count is read from the turn rows themselves, so an accepted note and its count are
the same write. No SQLite transaction spans the `before-send` hook. The Node is the only writer to
these tables, which is why an in-memory chain is enough.

## What it doesn't do

- **It can't steer a running turn.** Neither ACP nor the Codex app-server takes input mid-turn, and
  acorn doesn't cancel and restart a turn to fake it. A note waits.
- **It can't hold a note for the person's next message.** A note always starts a turn of its own.
- **It doesn't reach unattended sessions yet.** Workflow and delegated sessions refuse notes until
  their operations account for the extra turns.
- **A veto doesn't send one.** `agents:before-permission` and `agents:before-send` stay verdicts. A
  plugin that wants to explain its refusal sends a separate note through its own messenger grant.

## The policy plugin's explanations

The sample [permission policy](./permission-policy.md) uses this point. With **Permission policy:
explain refusals to the agent** turned on in the palette, it sends one note per request it refused:

1. Its veto route records the session, task, and request ids in its own database, and sends nothing.
   A verdict the host might still ignore after its timeout is not proof of a refusal.
2. On the resolved `plugin:agents:request-changed` event, it reads `agents.requests` for that request.
   Only a resolved row whose `blocked.by` is this plugin gets a note. Another plugin's veto, or the
   person's own answer, drops the record.
3. Each time agents connects its sender, it reads every recorded refusal again, so a missed event
   or a restart doesn't lose an explanation. A failed send keeps the record for that pass.

The key is the session id and the provider request id, so one refusal is one note. A failed note
never changes the refusal. In an unattended session the refusal stands, and the note comes back
`unattended-not-supported`.
