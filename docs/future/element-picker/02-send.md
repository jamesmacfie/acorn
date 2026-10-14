# Ticket 2: send from the box

Status: proposed, October 14, 2026. Depends on [ticket 1](./01-picker-and-box.md). Read
[the context doc](./README.md) first: it holds every decision, its precedent, and the trust rules
this ticket must follow.

## Goal

A question typed in the box reaches the task's agent, in a new chat or a chosen one, and the side
panel opens on that conversation.

## Build

1. On a pick, the picker script sends `acorn:ask.open`. The background answers with the task, the
   task's conversations (from `taskPages().sessions(taskId)`, else `sessions.list`), the usable
   agents from `agents.choices`, and the agent stored under `askAgent:<nodeId>`.
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
