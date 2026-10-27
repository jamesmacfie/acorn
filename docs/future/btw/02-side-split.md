# Phase 2: The side split in the Agent pane

Date: October 27, 2026. Status: proposed. Needs phase 1.

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
