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
- A finished app runs, as an [app card](#app-cards). While it loads, and on a host too old to draw
  it, it reads as its name and revision, such as "Migration checklist · v3", then the revision's note,
  and on an older host "Update the Acorn CLI to see this app here." **Open in Acorn** opens the task's
  Apps pane on that app.
- While the call checks, the line reads "Checking the plan for Commits by day…" or "Checking the
  app…".
- A call that failed its checks reads "Commits by day didn't pass its checks, so nothing was drawn.",
  or "This app didn't…", as the kit's `Alert` in the warning tone.

`conversationItems` gives such a call a `card` item, which ends a run of tool lines, so a card never
folds into "N tool calls". A call with nothing to name, such as an opener whose input didn't parse,
reads as the tool line it would have been. A call that failed its checks always gets its card line.
`CardLineItem` in `Conversation.tsx` draws it.

### Panel cards

A finished `panel_show` call draws as a live panel, with the dashboard's own views.
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
  **Open in Acorn**. A row whose own press calls a Node route isn't pressable, because only the desktop
  calls one.
- A row's buttons and its menu offer the plan's buttons. An **open** button follows the row's press
  rules, an action button runs the source's action ([row actions](#row-actions)), and **Start task**
  says "That row opens in Acorn." Board moves, corrections, and drill-downs stay in the desktop.
- A newer card with the same panel ID collapses an older one to "Commits by day. Replaced by a newer
  version." with **Show**, among the cards the sidebar has loaded. A collapsed card doesn't run.
  **Hide this version** collapses it again.

### App cards

A finished `app_show` call runs the app, as the desktop's app card does
([agent-built apps](../agent-built-apps.md#cards)). `AppCard` in `apps/extension/src/sidebar/` draws
it, and the conversation loads it with a dynamic import, together with the trellis plugin's
`AppRuntime`, lang-core, and the views, so a conversation with no apps never loads them.

- The card reads the app with `app.view` ([app cards](./native-messaging.md#app-cards)) when it mounts,
  on an `agent` hint for its session, and when the connection comes back. A hint or the connection
  reads it at most once every five seconds.
- The card that shows the app's head runs it: its name and revision, **Open in Acorn**, which opens
  the task's Apps pane where **Publish to project** is, and the app, capped at 480 pixels with
  **Expand**. Its queries and panels run through `app.run` once it's in view. A panel draws read only,
  with the dashboard's views, and its links open in a new tab.
- Ticks and typed values are saved with `app.state`, 400 milliseconds after the last change, as on
  the desktop. The card reads them when it mounts.
- A link in the app shows its full address in a confirm, then opens in a new tab. **Ask the agent**
  puts the app's text in this conversation's message box, on a line after what's typed. It never
  sends.
- A row action runs after the runtime's confirm ([row actions](#row-actions)), and then the app's
  queries and panels run again.
- An older revision collapses to "v2: Added owners. Replaced by v3." with **Show v2**, which draws it
  read only, and **Restore v2**, which sends `app.restore` and draws the new revision in its place. A
  retried restore keeps its key, so a restore the Node already made isn't made twice. A restore moves
  the head without a hint, so every app card in the conversation reads its summary again, and the card
  that was the head collapses at once. A restore made in the desktop shows on the next hint or reload.
- In a task that's no longer active, the card draws one line: "Migration checklist · v3. This task is
  archived, so the app isn't drawn."

### Row actions

A data source's action on a card's row, such as **Close issue**, runs from the sidebar after the
confirm the desktop shows. The card sends `row.act` with the card's plan, the row's ID, and the
action's ID ([row actions](./native-messaging.md#row-actions)). The host runs the plan again and finds
the row and action there, so the card can't act on a row the source no longer has.

- An action that can change something asks first: "Close issue? Close issue on Fix the login
  redirect. This can change something." An action that can run something says "This can run
  something." A read action runs without asking, as on the desktop. **Cancel** sends nothing. In a
  panel card, the confirm draws above the panel. In an app card, the app's runtime shows its own.
- After an action, the card runs its plan again, so the row shows its new state. A panel card says
  "Action completed." or "This action no longer applies."
- An action that answers with a link shows "Open this link?" with the address, then opens it in a
  new tab. One that answers with anything else, such as a task or a pane, says "That action
  continues in Acorn." with **Open in Acorn**.
- "That row changed. Refresh and try again." means the row, or its action, wasn't in the host's fresh
  run.
- When the host can't tell whether an action happened, the card says so. Pressing again sends the
  same key, so the Node acts at most once. Any other press gets a new key.

`rowActions` in `apps/extension/src/sidebar/rowActions.ts` holds the confirm's words, the keys, and
the next step, for both cards.

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
