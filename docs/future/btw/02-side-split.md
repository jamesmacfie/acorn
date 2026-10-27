# Phase 2: The side split in the Agent pane

Date: October 27, 2026. Status: done.

## Completion note

October 27, 2026. Phase 2 landed on branch `phase-2-side-split`.

What landed:

- `readOnlyPermission` in `plugins/agents/src/client/readOnlyPermission.ts`. `InlineDiffCard.tsx`
  and the pane model both use it.
- An **Ask a side question** action in `sessionActions`, beside **Fork session**, and a **btw**
  button on the desktop header bar. The palette picks the action up through
  `registerSessionActionCommands`. The action isn't in `READS_STORED_SESSION`, so an archived task
  doesn't offer it.
- `showSideSession` and `openSideSession` in `managedSelection.ts`, keyed by source session for the
  app lifetime. The pane model exposes `sideSession`, `closeSideSession`, and `askSideQuestion`.
- The split in `AgentPane.tsx`: a kit `ListDetail` with two `DetailColumn`s, kept under the width key
  `agents.side-question`. The side column has a header with the state icon, title, and close button.
- On a phone and in the terminal client, the action selects the side session instead of splitting.
- The prompt fallback from the README's "Read-only by default". When the client sends no
  `requestedConfigOptions`, `runtime.btw` opens the copied history with the inline chats' sentence,
  "Please answer without changing files or running write commands." `buildForkContext` takes it as an
  optional `instruction`, so the copy's byte and token counts include it. The first message carries it
  with the copy. This adds 126 bytes to the Node service graph.
- [Client surfaces § Side questions](../../managed-agents/client-surfaces.md#side-questions)
  documents the button, the split, and what closing does.
- Tests: `agentPaneModel.test.tsx` covers the mid-turn start with the read-only value, the live
  options winning over the provider's, opening and closing the split, and the phone fallback.
  `AgentPane.test.tsx` covers the bar button and menu row mid-turn, their absence on an archived
  task, and the split drawing both conversations with the caret in the side one. `runtimeBtw.test.ts`
  covers the instruction: present with no options or an empty set, absent with a read-only value.
- I walked it in `pnpm dev:agent` with Claude Code mid-turn. The split opened at once, and the main
  transcript kept streaming. The side draft showed **History copied from**, and its message field had
  focus. A question sent from the side ran a turn in the side session only. Closing the split returned
  the caret to the main conversation and left the side session listed and ready.

Decisions and deviations:

- The side session is in the left column, not the right. `ListDetail` sizes its first column and gives
  the rest to the second, so the doc's order would have squeezed the main conversation into about 430
  pixels.
- `DetailColumn` gained an `inset` prop. It pads the column the way the detail region pads a lone
  conversation, through one rule in `shell.css`. Plugins can't ship CSS, and inferring the column's
  contents from its children broke on a new session, which draws an empty state instead of a
  timeline. The terminal kit accepts the prop and ignores it.
- The read-only pick reads the source session's live `config.configOptions` first, then the
  provider's. In the live check, both harnesses answered an empty `configOptions` on the provider.
- The **btw** bar button is desktop only. In the terminal, one more button wrapped the header onto a
  second line and pushed a plan card off screen in `apps/tui/src/agents.test.tsx`. The terminal keeps
  the menu row and the palette command.
- Opening or closing the split remounts the main conversation, because it moves into or out of a
  column. Its snapshot read resumes from held events, so the cost is one small read.
- I fixed a phase 1 miss in `packages/change-request-ui/src/views/ChangeRequestDiff.tsx`. Its
  restated session origin admitted only diff lines, so `tsc` failed in `apps/tui` and the GitHub,
  GitLab, and Bitbucket plugins once origin could be `btw`. Both readers narrow on `kind` now.

What later phases and the coordinator need to know:

- Claude Code advertises its modes under category `mode`, with no value the read-only pick matches,
  so a Claude side session gets the prompt instruction rather than a mode. The Node keys the
  instruction on the caller sending no options, which matches the btw body's documented meaning. A
  caller that someday sends other options, such as a model, must send the read-only value too, or the
  instruction goes missing.
- The Node service graph measures 1,940,389 B against the 1,939,500 B ceiling, so `pnpm dev:agent`
  fails at staging. Phase 1 put it at 1,940,263 B, and the prompt fallback adds 126 B. I ran the app
  with `--prepared` and left the ceiling alone.
- Phase 3's sidebar section is the only way back to a closed side session on the desktop.

## Goal

A **btw** button in the open session's header starts a side session and opens it in a split beside
the main conversation. Both conversations stay live. The side one has the copied history attached to
its draft and its message field focused, so you type the question and press **Send**.

## Steps

1. Move the read-only permission pick out of `InlineDiffCard.tsx` (`readonlyProfile`) into a small
   shared helper in `plugins/agents/src/client/`, and use it from both places. It takes the
   harness's advertised options and answers the permission option ID and its read-only value, or
   nothing.
2. Add a `btw` action to `sessionActions` in `agentPaneModel.ts`, beside **Fork session**, with the
   label **Ask a side question**. Unlike fork, it's offered while a turn runs. It isn't in
   `READS_STORED_SESSION`, because it starts a harness, so an archived task doesn't offer it.
3. Put a **btw** button in the session header toolbar as well as the menu, since the point is to
   reach it mid-turn without hunting.
4. Hold the open side session's ID in the pane model, keyed by source session, for the app lifetime,
   like the **Chats only** choice in `managedSelection.ts`. Nothing is persisted. Reopening Acorn
   shows the main conversation alone, and the side session is still in the sidebar.
5. In `AgentPane.tsx`, when a side session is open for the selected session, draw the detail region
   as two columns with the kit's `SplitHandle`: the main `AgentConversation` on the left and the side
   one on the right, each addressed by its own session ID. Give the side column a header with its
   title and a close button. Closing hides the split and leaves the session alone.
6. On the narrow form factor, there's no room for two columns. Navigate to the side session instead,
   as if you'd picked it in the sidebar.
7. In the terminal client, check how `AgentPane` draws there. If the split can't fit in 80 columns,
   navigate to the side session as on narrow.
8. Update [client surfaces](../../managed-agents/client-surfaces.md#the-agent-pane) with the button,
   the split, and what closing does.

## Acceptance

- With a turn running, **btw** opens the split within one round trip, and the main transcript keeps
  streaming beside it.
- The side draft shows the **History copied from** context, and the message field has focus.
- Sending a question runs a turn in the side session only.
- On a harness with a read-only mode, the side session's header shows that mode.
- Closing the split leaves the side session running and listed.
- Two sessions on screen don't share a draft. Composer state is keyed by Node and session already,
  so check it rather than build it.
- Tests cover the action's availability (mid-turn yes, archived task no), the split opening and
  closing, and the narrow fallback.
