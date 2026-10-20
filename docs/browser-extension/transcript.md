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

### Panel and app lines

A call to `panel_show` or `app_show` reads as what the agent made, in the words of the desktop's
card, from the record's `card` ([panel and app calls](./native-messaging.md#panel-and-app-calls)):

- A finished panel draws live, as a [panel card](#panel-cards). On a host too old to run it, it
  reads as its title, then the run's description, such as "Pull requests by author, last 30 days.",
  and "Update the Acorn CLI to see this panel here." **Open in Acorn** opens the conversation in the
  desktop.
- An app reads as its name and revision, such as "Migration checklist · v3", then the revision's
  note. **Open in Acorn** opens the task's Apps pane on that app.
- While the call checks, the line reads "Checking the plan for Commits by day…" or "Checking the
  app…".
- A call that failed its checks reads "Commits by day didn't pass its checks, so nothing was drawn.",
  or "This app didn't…", as the kit's `Alert` in the warning tone.

`conversationItems` gives such a call a `card` item, which ends a run of tool lines, so a card never
folds into "N tool calls". A call with nothing to name, such as an opener whose input didn't parse,
reads as the tool line it would have been. A call that failed its checks always gets its card line.
`CardLineItem` in `Conversation.tsx` draws it.

### Panel cards

A finished `panel_show` call draws as a live panel, with the dashboard's own views, read only.
`PanelCard` in `apps/extension/src/sidebar/` draws it, and the conversation loads it with a dynamic
import, together with `RunPanel`, `CardFrame`, and the views, so a conversation with no panels never
loads them.

- The card shows the title, **Refresh**, and **Open in Acorn**, which opens the conversation in the
  desktop, where **Add to dashboard** and **Edit in studio** are. Under them come the run's
  description and the panel, capped at 480 pixels with **Expand**, as in the desktop.
- The card asks the host to run its call with `panel.run`
  ([panel cards](./native-messaging.md#panel-cards)) when it comes into view, on **Refresh**, on an
  `agent` hint for its session, and when the connection comes back. A hint or the connection reruns
  it at most once every five seconds, and only while it's in view. **Refresh** runs it at once. A card
  scrolled out of view sends nothing. Rows the agent supplied never change, so a hint doesn't rerun
  them, and the card has no **Refresh**.
- A failed run keeps the last panel and says why above it. A run whose source couldn't answer keeps
  the last panel that had data, greyed out, under the run's problems.
- A link cell opens in a new tab through the `tabs` API. A row whose press opens an address does the
  same. A row whose press opens a task, a pane, or an overlay says "That row opens in Acorn." with
  **Open in Acorn**. Buttons, board moves, data source actions, and drill-downs are off, so a row with
  only a data source action isn't pressable.
- A newer card with the same panel ID collapses an older one to "Commits by day. Replaced by a newer
  version." with **Show**, among the cards the sidebar has loaded. A collapsed card doesn't run.
  **Hide this version** collapses it again.

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
