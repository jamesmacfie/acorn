# A conversation in the browser extension's sidebar

This page covers what the [browser extension](../browser-extension.md) draws for one agent
conversation: the transcript, folded tool calls, the state line with **Stop**, and the message box.
How the sidebar reads, pages, and sends a conversation is on
[agent conversations](./conversations.md).

`Conversation` in `apps/extension/src/sidebar/Conversation.tsx` draws one conversation. The top bar
names it and its task, and its ⋯ menu holds the links ([navigation](./navigation.md)). Nothing sits
between the top bar and the transcript.

## The transcript

Each message is the kit's `Card` with a stripe, as in the desktop's transcript. An eyebrow names the
sender and the time the Node recorded it:

- The person's message has the accent stripe and reads "You", or "Workflow" for a workflow step's
  prompt. The message is Markdown, followed by the attachments its turn sent as the kit's `Chip`s. A
  queued turn reads "Queued" in place of the time.
- The agent's message has the green stripe and the provider's name, such as "Claude".
- An error has the red stripe and reads "Error".

A tool call is one muted line: a green `circle-check` when done, a red `circle-x` and "failed" when it
failed, and a turning `loader-circle` while it runs, in the colours of the agents plugin's
`agentToolTone`. Any other state is written after the title.

Three or more tool lines in a row, with nothing between them, fold into one line, the kit's `Fold`:
"4 tool calls", and "· 1 failed" in red when any failed. A failed call stays in view under the closed
fold. `conversationItems` in `conversationWindow.ts` does the grouping, as a `tools` item keyed by its
first line, so a run that grows while it streams stays the same fold. Two lines never fold. The panel
remembers which folds are open, by session and run, until it closes, and never stores it.

A request the agent waits on follows the transcript as the desktop's request card
([answering the agent](./conversations.md#answering-the-agent)).

## The state line

One line above the message box shows what the agent is doing, while there's something to show:

- Working: the turning `loader-circle`, "Working", and **Stop**, which sends `session.cancel` with a
  new key and reads the conversation again. The Node's next state ends the line. A failed stop says
  why under it.
- Waiting for you: the amber `circle-alert`, while the agent's runtime state is `waiting` or one of
  its requests waits on the person.

The line shows no elapsed time, because the read doesn't carry when the turn started.

## The message box

Enter sends, and Shift with Enter adds a line, as on the desktop. Enter while an input method is
composing goes to the input method. Command or Control with Shift and Enter toggles the box's size, as
does the icon button in its corner. The placeholder reads "Ask the agent…". The bar under the box
holds the hint "⇧↩ for newline" and **Send**.

While sending is off, the placeholder says why: "Offline. Your draft is kept." while the Node is away,
or that the conversation is archived or gone. Once the box holds a draft, the same words show under
it.
