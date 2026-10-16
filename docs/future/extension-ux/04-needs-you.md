# Phase 4: Needs you, on every screen

Date: October 16, 2026. Status: done on October 16, 2026. Depends on [phase 1](./01-navigation.md).
Easier after [phase 2](./02-go-to-task-and-menus.md), which also adds to the top bar.

## Completion note

Landed on October 16, 2026. An amber **Needs you** button with the count sits in the top bar of Home,
a task, and a conversation while an agent waits, and opens the list in the kit's `Popover`. Home's
**Waiting for you** is now a **Needs you** section drawn by the same component, `NeedsYou` in
`apps/extension/src/sidebar/NeedsYou.tsx`, which replaces `Waiting.tsx`. A permission or a single
choice is answered in its row. Anything else opens its conversation. The conversation's request card
is the kit's `Card` with the amber stripe, and has no "Waiting for an answer" line.
[Request notifications](../../browser-extension/notifications.md#the-needs-you-list),
[answering the agent](../../browser-extension/conversations.md#answering-the-agent),
[navigation](../../browser-extension/navigation.md), and the site's page on waiting requests are
updated.

Decisions and deviations:

- The answer logic moved out of the card into `createAnswer` in `Requests.tsx`, so the card and the
  row share the key reuse, the uncertain-answer note, and the re-read. `send` returns the Node's
  settled request. `ChoiceButtons` draws both places' buttons with the kit's `Button`.
- A refusal is a quiet danger button for every kind, as on the desktop, not only for a permission.
- A "single choice" is a request with buttons and no form, or a form of exactly one question with
  choices that isn't multiple or secret. Its choices become the buttons, sending `{ answers }`, and
  the request's own buttons, such as Skip, follow them. The expanded row shows the question's prompt.
- The settled text comes from the button's label: a permission's refusal reads "Denied", a label
  with "allow" reads in the past tense ("Allowed once", "Always allowed"), and anything else reads
  "Answered: <label>". When another client answered first, the Node's answer wins.
- Each list reads its own conversations, as `Waiting.tsx` did, so with the popover open over Home
  both read. A row answered here is held for 1.5 seconds even when the next pending list drops it
  first, and rows keep their place as the list changes.
- A row that only opens its conversation shows `chevron-right`, not the expanding chevron. Until the
  conversation's read lands, a row has no buttons, so a click opens the conversation.
- The kind icon for a question is `message-circle-question-mark`, Lucide's name for it. It joined the
  kit's eager icon set.
- The button stays while its popover is open, so the popover can say "Nothing waits on you." It's
  hidden during pairing and in Settings. With nothing waiting, the top bar keeps an empty
  `display: contents` anchor, which the regenerated site pictures show.
- The runtime state `waiting` in `state.tsx` now reads "Waiting for you".
- The request's detail uses the kit's `CodeBlock`. The `.request pre.detail` rule went.
- In the tests, jsdom stopped matching `.ui-row-leading > *` on an SVG once the Needs you rows drew,
  so `ProjectSites.test.tsx` reads the agent mark through `firstElementChild`.

For later phases:

- Phase 6: put `NeedsYou` at the top of the Agents tab with `requests` filtered to the task. The row
  has no option yet to leave the task's title out of its meta line; add it there.
- Phase 7: the card's look is set. The state line above the composer still says "Waiting for you" from
  `agentState`.
- Tests: `Conversation.test.tsx`'s **Needs you** block has `topButton`, `homeList`, `popover`, `row`,
  and `pressRow`. The popover draws in a portal on `document.body`.

## Goal

Answer an agent from any screen in two clicks. An amber **Needs you** button sits in the top bar
whenever an agent waits. It opens the same compact list Home shows. A permission or a single choice is
answered in the list. A form opens its conversation. The request card in a conversation follows the
desktop's.

## In the prototype

- Scenario: **Answer an agent**. Click **Allow once** and watch the row settle and leave. Then open
  **Needs you** from a task or a conversation.
- Notes: `needs` at line 1295, and the third bullet of `conv` at line 1307.
- Code: `needsRow` at line 839 draws a row, collapsed, expanded, and answered. `needsOverlay` at line
  1136 draws the popover. The `needs-pill` button is in `topBar` at line 742. `requestCard` at line
  970 draws the card inside a conversation. The `answer` action at line 1423 shows what a settled row
  says.
- Today: `references/extension-ux/today/04-home-task-page-dark.png` shows today's full request cards
  pushing Home's other sections down.

## Starting point

- `Waiting.tsx`, beside `Requests.tsx` in `apps/extension/src/sidebar/`, drew **Waiting for you** on
  Home: one group per conversation, each with the task's title, **Open**, and the conversation's
  requests as full cards.
  `WaitingConversation` reads each conversation's requests with `session.read` past the end, because
  `requests.pending` names a request without its buttons.
- `apps/extension/src/sidebar/Requests.tsx` draws a request card, answers it with `request.resolve`,
  and labels each status, including "Waiting for an answer" for every pending one.
- `apps/extension/src/sidebar/state.tsx` holds the same "Waiting for an answer" wording.
- The background keeps the pending list for the toolbar badge, as
  [request notifications](../../browser-extension/notifications.md) describes, and the sidebar
  receives it in `App.tsx` as `requests`.
- The desktop's request card is `plugins/agents/src/client/sessions/AgentRequestCard.tsx`.

## The design

### The button

In the top bar of Home, a task, and a conversation, while at least one request is pending: a small
amber button with `circle-alert` and the count. Its label is "Needs you". It opens a popover, 340
pixels wide and at most 420 tall, anchored under it, with a **Needs you** header and its count, and the
rows below. With nothing pending, the button isn't drawn, and an open popover shows "Nothing waits on
you."

Setup, pairing, and Settings don't show the button.

### A row

Collapsed, a row is a stacked row:

- Leading, the amber `circle-alert`.
- The request's title in bold, such as "Run pnpm test billing".
- Under it, the conversation's title, then "·" and the task's title. In a task's Agents tab, where
  every row shares the task, leave the task's title out.
- Trailing, a muted icon for the kind, `shield` for a permission and `message-circle-question` for a
  question, then a chevron.

A click on a permission or single-choice question expands the row in place. Expanded, it shows the
request's detail, such as the command, in a code block, then one button per option, with **Open chat**
at the right as a bare link. The first option is solid. For a permission, the refusal, the option
with `reject: true`, is a quiet danger button. The others are plain.

A click on any other request, a form, a multi-choice question, an app approval, or one with
`unsupported` set, opens its conversation with `openConversation`. Don't expand it.

Answering calls `request.resolve` as `Requests.tsx` does. The row then shows a green `circle-check`,
the result in muted text, such as "Allowed once", "Denied", or "Answered: A4", and the request's
title under it. Keep it for about 1.5 seconds, then let the next pending list drop it.

### Where the list shows

- In the popover, every pending request on the Node.
- At the top of Home, as a **Needs you** section with its count, while something waits.
- At the top of a task's Agents tab, that task's requests only. Phase 6 places it.

All three draw the same row component.

### The data

Keep `WaitingConversation`'s one `session.read` per waiting conversation. It returns the
conversation's `session`, which carries the title the row needs, and its `requests`, which carry the
detail and options. Read it when the pending list changes, as today.

Every `AgentOpenRequest` the Node lists is a full request, so the host could send the buttons with
`requests.pending` and save the read. Leave that for later. The read is cheap, it already exists, and
the row needs the conversation's title either way.

### The request card in a conversation

Redraw the card in `Requests.tsx` to the desktop's shape, as `requestCard` at line 970 does: an amber
stripe, a small eyebrow, **Permission** or **Question**, the title, the detail in a code block, and the
buttons styled as in the row. Remove "Waiting for an answer". The amber stripe says it. Keep the other
status lines: "Answer sent. Waiting for the agent to take it." and the expired line describe states
the stripe doesn't.

## Changes

1. Add a request row component with the collapsed, expanded, and answered states.
2. Rebuild `Waiting.tsx` on it as Home's **Needs you** section, and add the popover and the top-bar
   button.
3. Route a form, or any request the row can't answer, to its conversation.
4. Redraw the card in `Requests.tsx`, and drop the pending label from it and from `state.tsx`.
5. Update the tests that read "Waiting for you" or "Waiting for an answer": `Conversation.test.tsx`,
   `ProjectSites.test.tsx`, and `pictures.test.tsx`. Add tests for each row state, for a form opening
   its conversation, and for the button showing and hiding with the count.
6. Update [request notifications](../../browser-extension/notifications.md) and
   [answering the agent](../../browser-extension/conversations.md#answering-the-agent).

## Acceptance

- With a permission pending, the **Needs you** button shows on Home, on a task, and in a conversation.
- Opening it and clicking **Allow once** answers the agent. The agent continues, and the row shows
  "Allowed once" and then leaves.
- A question with a typed answer opens its conversation.
- Answering in the desktop app clears the row in the sidebar within one hint.
- The conversation's request card has no "Waiting for an answer" line.

## Risks

Two clients can answer the same request. The Node settles a request once and returns the settled row
to the second answer, which `Requests.tsx` already draws. Keep that path, and show the settled answer
in the row, not an error.
