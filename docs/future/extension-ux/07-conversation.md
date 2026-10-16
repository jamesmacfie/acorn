# Phase 7: the conversation

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md) and, for the
request card, [phase 4](./04-needs-you.md).

## Goal

A conversation reads like the desktop's transcript, in a narrow panel. The crowded line under the
header goes. State moves above the message box, with **Stop**. A run of tool calls folds into one
line. The keys and the placeholder match the desktop's.

## In the prototype

- Scenario: **Conversation**. Open the folded "4 tool calls · 1 failed" line, type a message and press
  Enter, and press **Stop** while it works.
- Notes: `conv` at line 1307, including the box saying **Stop** needs a bridge operation, and
  `offline` at line 1325 for the kept draft.
- Code: `convView` at line 947 draws the transcript, `toolLine` under it a tool line, and
  `requestCard` at line 970 the request card. `composer` at line 980 draws the state line, the chips,
  the message box, and its bar. `chipView` at line 978 draws an attachment chip. The key handler at
  line 1629 sends on Enter.
- Today: `references/extension-ux/today/07-conversation-dark.png`.

## Starting point

- `apps/extension/src/sidebar/Conversation.tsx` draws the header line with the agent's name, its
  state, **Open in Acorn ↗**, and **Copy Acorn link**, then the transcript. Each tool call is one line
  with a coloured dot.
- `conversationItems` in `apps/extension/src/sidebar/conversationWindow.ts` turns records into
  messages, tool lines, and errors. A tool line carries a title and a status.
- `apps/extension/src/sidebar/Composer.tsx` sends on Command or Control with Enter, toggles its size
  with Shift as well, and reads "Message the agent". `props.blocked` disables **Send** with a reason.
  Drafts are already kept per conversation in browser storage.
- No bridge operation stops a turn. The agents plugin stops one with
  `POST /v1/p/agents/sessions/:id/cancel`, which takes an optional `turnId`.

[Agent conversations](../../browser-extension/conversations.md) documents today's behavior.

## The design

### The header

Phase 1's top bar names the conversation and its task. Phase 2's ⋯ menu holds the links. Delete the
line under the header.

### The transcript

Draw each item as a kit `Card` with a stripe, as `convView` does:

- **You**: the accent stripe, an eyebrow with "You", or "Workflow" for a step's prompt, and the time.
  The message as Markdown, then its attachments as chips.
- **The agent**: the green stripe, an eyebrow with the provider's name, such as "Claude", and the
  time. The message as Markdown.
- **Error**: as today.

Tool calls stay as lines: a green `circle-check` when done, a red `circle-x` and "failed" when it
failed, and a spinning `loader-circle` while it runs.

### Folding tool calls

Three or more tool lines in a row, with nothing between them, fold into one line: a chevron and "4
tool calls". A failed call stays visible under the folded line, and the folded line adds "· 1 failed"
in red. Clicking the line opens the run, with the chevron pointing down. Two lines or fewer never
fold. Remember each fold's state per conversation for the panel's life.

Do the grouping in `conversationItems`, as a `tools` item holding its lines, so the view only draws.
A run still streaming stays one group as lines join it. A run's key is its first line's key, so a
fold stays open as the run grows.

### The state line

Above the message box, one line while there's a state to show:

- Working: a spinning `loader-circle`, "Working", and **Stop**, a small quiet button with a `square`
  icon. Add the elapsed time, such as "Working · 1m 12s", only if the read already carries the turn's
  start. Don't add a field for it.
- Waiting on you: the amber `circle-alert` and "Waiting for you" in amber.

**Stop** calls a `session.cancel` bridge operation, with `nodeId`, `sessionId`, and `key`. The host
sends `POST` to the session's `cancel` route with an empty body and returns `{ nodeId, sessionId }`.
The next read shows the stopped state.

### The composer

- Enter sends. Shift with Enter adds a line, as on the desktop. Keep Command or Control with Shift and
  Enter for the size toggle, and add an icon button with `maximize-2` at the box's corner for it.
- The placeholder reads "Ask the agent…", the desktop's.
- The bar under the box holds the **Context** button phase 13 may add, a hint of "⇧ ↵ newline" in
  faint type, and **Send**, solid.
- Offline, the placeholder reads "Offline. Your draft is kept." and **Send** is disabled. The draft
  already persists. Keep it as it is.

## Changes

1. Delete the line under the header.
2. Draw transcript items as striped cards.
3. Group runs of three or more tool lines in `conversationItems`, and draw the fold.
4. Add the state line and **Stop**.
5. Add `session.cancel` to the protocol, the host, the host's tests, and
   [native messaging](../../browser-extension/native-messaging.md).
6. Change the composer's keys, placeholder, and offline text, and add the size button.
7. Update `Conversation.test.tsx`: the key tests at about line 446 press Command with Enter. Add tests
   for the grouping, including a failed call in a folded run and a run that grows while folded, for
   the state line, for **Stop**, and for Enter and Shift with Enter.
8. Update [agent conversations](../../browser-extension/conversations.md).

## Acceptance

- Four tool calls in a row show as one line. Opening it shows all four.
- A failed call in a folded run shows under the folded line.
- Enter sends. Shift with Enter adds a line. Neither sends while an input method is composing.
- **Stop** stops a working agent, and the state line goes.
- With the Node stopped, the draft stays in the box and **Send** is disabled. Starting the Node lets it
  send.

## Risks

Enter sending changes a habit. A person who typed several lines with Enter sends early. The
desktop made the same choice, and the hint under the box says how to add a line.
