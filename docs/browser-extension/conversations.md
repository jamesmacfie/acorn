# Agent conversations in the browser extension

This page covers how the [browser extension](../browser-extension.md) continues an agent conversation:
the agent operations on the native bridge, the change hints, how the sidebar pages and folds a
conversation, how a send survives a lost answer, how it answers the agent's questions and permission
requests, and what it keeps in browser storage. The sidebar code
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
- `session.read` also carries `requests`: every request the agent is still waiting on, oldest first,
  then the 10 that settled most recently. See [answering the agent](#answering-the-agent).
- `agents.choices` returns the rows of the desktop's **New** picker, built by the host with the
  agents plugin's `plugins/agents/src/contract/newSessionChoices.ts`: each harness, or its named
  logins in its place, then each custom agent on a harness the Node registers. Each row has its
  name, its mark and account icon, what it says under its name, and whether it can start. `refresh`
  asks the Node to check its harnesses again, as the picker's refresh button does.
- `session.create` sends `kind: 'interactive'`, the row's `customAgentId` and `account` when it has
  them, and an empty `config`, so the Node applies the same defaults any other client gets. The
  sidebar's **New chat** is the kit's own `Picker`, as on the desktop.

## Writes and retries

Writes carry a `key`, sent as the route's `idempotency-key`. The host checks the selection before a
write and never after, because once sent it may have happened. A write that gets no answer fails with
`ambiguous_mutation`. The sidebar treats that, `host_unavailable`, and `node_unreachable` as an
uncertain result: it keeps the draft with the key, reads the conversation again, and shows **Retry**.
Sending the same text and captures again reuses the key, so the Node answers with the turn it already
made. Other text or captures get a new key. A missing session reads as `not_found`.

## Answering the agent

The agents plugin keeps each question or permission request as a row with a status: `pending`,
`resolving` once an answer is claimed, then `resolved` or `expired`. The Node settles a row once. An
answer to a settled row comes back as that row and reaches no agent.

The host narrows each row in `bridgeRequest` (`apps/cli/src/browser/agents.ts`):

- `options` are buttons. A button sends `{ optionId }`, the option's ID.
- `questions` are a form. A form sends `{ answers }`, keyed by question ID. A choice answers with the
  option's label, and several choices with a list of labels, because labels are what both harnesses
  record as the person's words. A question with no options takes typed text. A `secret` question uses
  a password field.
- `approval` is app access, described with the agents plugin's own words from
  `plugins/agents/src/contract/appApproval.ts`: the app, what each scope lasts for, and any warning.
- `answer` names the button a settled request was answered with. A form's answers stay on the Node,
  because some are secret.
- `unsupported` says why the sidebar can't answer a request: a kind other than `permission`,
  `question`, or `elicitation`; an option or question that doesn't read; app access with no readable
  scope; or nothing to send. The sidebar shows the request in full, with no buttons, and sends the
  person to the Acorn app. It never makes up an answer.

`request.resolve` posts to the agents plugin's resolve route with the `key` as its idempotency key. The
sidebar (`src/sidebar/Requests.tsx`) keeps answers in the card's memory only, never in browser
storage, and clears them once the Node takes them. Every answer, sent or not, reads the conversation
again. An uncertain failure, as in [writes and retries](#writes-and-retries), keeps the key in memory:
pressing the same answer again reuses it, so the Node settles the request once. Nothing resends an
answer on its own, on reconnect or otherwise.

A request shown open stays on screen after it settles, here or in another client, with its outcome
and no buttons. One that settled before the conversation showed it is history and isn't drawn. The
Node answers a second answer while one is settling, or a button it never offered, with 409
`agent_conflict`.

## Change hints

The host listens to the agents plugin's WebSocket frames on the selected Node and gathers them for
250 ms into one hint naming the sessions and tasks they touched. `ws:shed`, the Node dropping frames
for a slow reader, sets `missed`. The sidebar reads on from its window's end when a hint names its
session, and reads the task's session list when a hint names its task. It reads both again when the
selected Node's status returns to online. A real sequence gap closes the broker's socket, so it
arrives as that same return. The host also sets `requests` when the agents plugin reports a request
raised, claimed, settled, or expired, which the
[toolbar badge](./notifications.md#the-toolbar-badge) reads.

## The conversation window

The sidebar holds a window of a conversation, never the whole transcript. It opens 200 events before
the session's end, and **Earlier messages** reads the 200 below the window. If it falls more than 200
events behind, it starts again at the end. It folds streamed messages by message ID, and tool updates
by tool ID with the last title and status reported, skipping any update a folded record already
covers. Each conversation is mounted for one session ID, and its reads stop applying when it is left,
so a slow reply can't land in another conversation.

A conversation opens scrolled to its newest message and keeps it in view as messages arrive, as the
desktop's transcript does. Scrolling up stops that, and scrolling back to within 40 pixels of the
bottom starts it again.

## Browser storage

Besides `selectedNodeId`, the extension keeps these keys in `storage.local`:

- `draft:<nodeId>:<taskId>:<sessionId>`: the unsent text, and an unconfirmed send's
  `{ key, text, captures }`, where `captures` lists the IDs of the captures it carried. A draft
  survives closing the sidebar, a reconnect, and switching away. It's removed when the Node accepts
  it, keeping anything typed since. [Start task](./handoffs.md#the-handoff-card) writes a new
  conversation's first draft here before it opens.
- `captures:<nodeId>:<taskId>:<sessionId>`: that draft's [page captures](./page-capture.md), with each
  screenshot's attachment ID once the Node holds it. It sits apart from the text because the text is
  saved on each keystroke and a screenshot can be megabytes. The background adds a selection here
  for [Add to Acorn chat](./page-capture.md#add-to-acorn-chat), and an open composer shows it.
- `destination:<nodeId>`: the task the panel last showed on that Node, with its project, and the
  conversation open in it, if any. A workflow step's conversation is kept as its task. Home and
  Settings leave it alone, so a selection always has a conversation to go to. The panel returns to it
  when it opens, and **Add to Acorn chat** saves the conversation it added a selection to.
- `taskViews:<nodeId>`: the tab last picked under each task, `{ tab }` by task ID, for
  [moving between pages](./task-pages.md#moving-between-pages). It keeps the 50 tasks used most
  recently. A view stored by an older build may name the Runs tab `workflows`, which reads as `runs`.
- `appearance`: the panel's `{ theme, style }`, with `theme` null to follow the system's light or dark
  ([appearance](./setup.md#appearance)).
- `handoffs`: the selected Node's [handoffs](./handoffs.md#task-chips), `{ nodeId, handoffs }`,
  kept so pages get their buttons before the native host starts. It goes when no Node is selected.
- `hiddenMarkers`: the origins the person hid the [branch marker](./task-pages.md#the-branch-marker)
  on, as a list such as `["https://runn-05ea41.runn.localhost:5104"]`. The marker's **Hide on this
  site** adds one, and **This page** removes it again. It holds for every Node.
- `siteChoices:<nodeId>`: the person's [project overrides](./project-sites.md#overrides) for each site.
- `askAgent:<nodeId>`: the agent row the [element picker's box](./element-picker.md#the-box) last
  started a new chat from on that Node, as its `choiceKey`, such as `claude:work:`. It's the box's
  default for the next one.
- `notifiedRequests`: the requests already sent as [OS notifications](./notifications.md#browser-storage).

Nothing else is stored, and no draft leaves the browser until the person sends it.
