# Ticket 2: send from the box

## Completion note

October 14, 2026. Done, with every item in "Build".

What landed:

- `src/background/askElement.ts` answers the box's three messages. `acorn:ask.open` reads the task's
  conversations, the usable agents, and `askAgent:<nodeId>`. `acorn:ask.send` opens the panel inside
  the click, runs every trust check, makes the new chat if one was asked for, and submits the turn.
  `acorn:ask.cancel` drops the pick. `background.ts` wires it with `pageTask`, `sessions`, `read`, and
  `sent`, which offers `{ type: 'open', target }`.
- `src/content/picker.ts` fills the dropdowns, enables **Send** once there's a question and a target,
  sends on **Enter** or a trusted click, and keeps **Shift+Enter** for a new line. It cleans the HTML
  and builds the CSS path on **Send**, and shows the background's one-line reason when a send fails.
  In Firefox it shows the toolbar line for four seconds, then closes.
- `AskMessage`, `AskOpened`, and `AskSent` in `src/handoffs.ts`.
- Tests: the trust checks, retry keys, a chosen conversation, Firefox, and cancel in
  `background.test.ts`. Filling, sending, failure, cleaning, truncation, and the CSS path in
  `picker.test.ts`. The fake's `sendFromPage(message, frameId)` resolves with the background's answer.

Decisions and deviations:

- The background names the pick, in its answer to `acorn:ask.open`, instead of the page sending a
  `pickId`. `crypto.randomUUID()` exists only in secure contexts, and a local app on a LAN address
  over plain HTTP isn't one. The background keeps one pick per tab, so a new box replaces the last.
- `acorn:ask.open` carries no `rect` or `devicePixelRatio`, and its answer says nothing about a
  screenshot. Ticket 3 adds them with their first use.
- The context part's content is `Page: <url>`, `CSS path: <path>`, and `Size: W × H CSS pixels`, each
  on its own line, then a blank line and the HTML. Its `id` is the pick's, and `capturedAt` is the
  time the box opened, so a retry builds the same input.
- A retry reuses the `turn.submit` key only for the same conversation and the same input. A changed
  question gets a new key. The `session.create` key is kept per agent, and the chat it made is reused,
  as `agentChoice.tsx` does.
- The conversation list leaves out archived conversations. The agent list holds only usable agents,
  by the sidebar's rule (installed, and not signed out). With none, the agent dropdown says so and
  **Send** stays off for a new chat.
- Cleaning runs on a copy imported into a document of its own (`createHTMLDocument`), so the copy
  loads no images and runs no handlers. The picker can't export, so the tests read the cleaned HTML
  and the path from the `acorn:ask.send` message.
- The 50 KiB limit is in bytes. Truncation keeps 100 bytes of room for the marker.
- Saving `askAgent` and the destination after a send ignores a storage failure, because the turn
  already went.

For later tickets:

- Ticket 3: `ask()` in `picker.ts` sends `acorn:ask.open`, and `open()` in `askElement.ts` builds the
  `Pick`. Add the screenshot there, and upload it in `send()` before `turn.submit`, storing the
  attachment on the pick so a retry reuses it. Pass its ID in the `attachmentIds` map that
  `turnInput()` takes.
- Ticket 4: the comment on `askElement()` cites `docs/future/element-picker/README.md`. Point it at
  the reference doc when this folder moves.
- Still red at this base, untouched: oxlint's unused `openChat` import in `sidebar/Handoff.test.tsx`,
  and the formatter check on `manifest.ts`, `sidebar/Conversation.tsx`, and `sidebar/Workspace.tsx`.

Status: proposed, October 14, 2026. Depends on [ticket 1](./01-picker-and-box.md). Read
[the context doc](./README.md) first: it holds every decision, its precedent, and the trust rules
this ticket must follow.

## Goal

A question typed in the box reaches the task's agent, in a new chat or a chosen one, and the side
panel opens on that conversation.

## Build

1. On a pick, the picker script sends `acorn:ask.open`. The background answers with the task, the
   task's conversations (from `taskPages().sessions(taskId)`, else `sessions.list`), the usable
   agents from `agents.profiles`, and the agent stored under `askAgent:<nodeId>`.
2. Fill the dropdowns. **New chat** is selected by default. The agent dropdown shows only for a new
   chat.
3. On **Send**, clean the HTML and build the CSS path. See
   [HTML cleaning](./README.md#html-cleaning) and [CSS path](./README.md#css-path).
4. Send `acorn:ask.send`. In the background, open the panel at once, inside the click, then run every
   check in [Trust and privacy](./README.md#trust-and-privacy).
5. Build the turn with `withCapture()` and `turnInput()` from `src/capture.ts`, using a `context`
   capture labelled `Element on <page title>`.
6. Call `session.create` for a new chat, then `turn.submit`, with keys kept per pick. See
   [Retries](./README.md#retries).
7. On success, store the agent under `askAgent:<nodeId>`, call `saveDestination()`, offer
   `{ type: 'open', target }`, and close the box. On failure, keep the box open with one line from
   `errorGuidance()` in `sidebar/guidance.ts`.
8. In Firefox, show the toolbar line before closing. See [Firefox](./README.md#firefox).

## Done when

- In Chrome, **Send** opens the panel on a new chat whose first message holds the question and a
  context block with the address, the CSS path, and the cleaned HTML.
- Choosing an existing conversation adds the turn there instead.
- A retry after an unconfirmed send makes no second chat or turn.
- Tests cover each trust check, the retry keys, cleaning, and the CSS path.
