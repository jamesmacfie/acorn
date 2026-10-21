# The agent pane on a phone

This page covers how the shared Agents pane draws in [the mobile web app](../mobile.md). Read it
before you change the pane's header or composer for a phone.

The Agents pane is the shared one, and the phone's shell adds no code to it. The pane draws its phone
differences itself, with `Only formFactors` and `formFactor()`. These parts were checked at 390 pixels:

- Each permission button takes a whole row. A lone single-choice question draws a button for each
  option, and the tap on one is the answer, with no dropdown to open and no **Submit answers** to find.
  A question that takes several answers, or a typed one, draws as on the desktop. `AgentRequestCard`
  reads `formFactor()` from `@acorn/plugin-api/client` for both
  ([request cards](../managed-agents/transcript.md#request-cards)).
- The header is one row: the provider's mark and the title, the state as its icon, **Stop** as an
  icon while there's something to stop, the usage button as a gauge and a dot per harness, **New** as
  a plus, and the session menu. The workflow, parent, background command, and custom agent chips are
  rows at the top of the session menu.
- Every popover, menu, and select opens as a sheet along the bottom edge
  ([overlays](../ui-design/overlays.md#dialogs)).
- The composer starts folded: the message box, a line that names the selects' values and counts what's
  attached, **Steer** while a turn takes it, and **Send**. Opening the line shows the selects, the
  transcript controls, the chips, and the other buttons. Pasting or dropping a file, attaching one, or
  adding a context reference opens it. Whether it's open lasts as long as the page, since the phone
  restores no persisted state slices.
- Opening a session leaves the keyboard down. It rises when someone taps the message box. Return adds
  a line, and **Send** is the one way to send.
- A long tool call is folded, and the transcript scrolls without moving the composer.
- **Attach** opens the page's own file chooser, because the phone has no `files` group.
- With the keyboard up, the composer and **Send** stay in view.
