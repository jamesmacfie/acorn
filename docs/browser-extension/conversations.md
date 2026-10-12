# Agent conversations in the browser extension

This page covers how the [browser extension](../browser-extension.md) continues an agent conversation:
the agent operations on the native bridge, the change hints, how the sidebar pages and folds a
conversation, how a send survives a lost answer, and what it keeps in browser storage. The sidebar code
is in `apps/extension/src/sidebar/`, and the host side in `apps/cli/src/browser/agents.ts`.

## The agent operations


The agent operations are thin calls to the agents plugin's routes, with that plugin's types
(`plugins/agents/src/contract/wire.ts`). The host imports them for types only, so the CLI bundle
carries none of its code. It narrows each answer to what the sidebar draws:

- A session row keeps its IDs, title, kind, `runtimeState`, `attention`, `lastEventSeq`, and
  `archivedAt`, and drops `config`.
- `session.read` asks the session route for `afterSeq`, `limit`, and `fold=1`, so each tool call
  arrives as one record. Each record keeps its ID, seq, turn, and `foldedThroughSeq`. Only the
  session's own user and agent messages, tool calls, and errors are kept, and a tool call keeps only
  its title and status. A person's message lists the attachments its turn sent
  ([page capture](./page-capture.md#sent-screenshots-in-the-conversation)). Its input and output can be megabytes, and a summary never shows them.
  `reach` is the furthest seq the page covered, counting the records left out, and the next read
  starts there. `queued` lists turns accepted but not yet sent to the agent, whose message joins the
  conversation only at dispatch.
- `session.create` sends `kind: 'interactive'` and an empty `config`, so the Node applies the same
  defaults any other client gets. The sidebar offers one choice per provider, on its default
  account, and names any that can't start.

## Writes and retries

Writes carry a `key`, sent as the route's `idempotency-key`. The host checks the selection before a
write and never after, because once sent it may have happened. A write that gets no answer fails with
`ambiguous_mutation`. The sidebar treats that, `host_unavailable`, and `node_unreachable` as an
uncertain result: it keeps the draft with the key, reads the conversation again, and shows **Retry**.
Sending the same text and captures again reuses the key, so the Node answers with the turn it already
made. Other text or captures get a new key. A missing session reads as `not_found`.

## Change hints

The host listens to the agents plugin's WebSocket frames on the selected Node and gathers them for
250 ms into one hint naming the sessions and tasks they touched. `ws:shed`, the Node dropping frames
for a slow reader, sets `missed`. The sidebar reads on from its window's end when a hint names its
session, and reads the task's session list when a hint names its task. It reads both again when the
selected Node's status returns to online. A real sequence gap closes the broker's socket, so it
arrives as that same return.

## The conversation window

The sidebar holds a window of a conversation, never the whole transcript. It opens 200 events before
the session's end, and **Earlier messages** reads the 200 below the window. If it falls more than 200
events behind, it starts again at the end. It folds streamed messages by message ID, and tool updates
by tool ID with the last title and status reported, skipping any update a folded record already
covers. Each conversation is mounted for one session ID, and its reads stop applying when it is left,
so a slow reply can't land in another conversation.

## Browser storage

Besides `selectedNodeId`, the sidebar keeps two kinds of key in `storage.local`:

- `draft:<nodeId>:<taskId>:<sessionId>`: the unsent text, and an unconfirmed send's
  `{ key, text, captures }`, where `captures` lists the IDs of the captures it carried. A draft
  survives closing the sidebar, a reconnect, and switching away. It's removed when the Node accepts
  it, keeping anything typed since.
- `captures:<nodeId>:<taskId>:<sessionId>`: that draft's [page captures](./page-capture.md), with each
  screenshot's attachment ID once the Node holds it. It sits apart from the text because the text is
  saved on each keystroke and a screenshot can be megabytes.
- `destination:<nodeId>`: the project, task, and session last chosen on that Node, restored when the
  sidebar opens. Only the person's own choices are saved.

Nothing else is stored, and no draft leaves the browser until the person sends it.
