# Phase 3: Side questions in the task sidebar

Date: October 27, 2026. Status: done.

## Completion note

October 27, 2026. Phase 3 landed on branch `phase-3-sidebar-section`.

What landed:

- A **Side questions** fold in `AgentTaskSidebar.tsx`, under **Inline chats**, saved open or closed
  under `agents.side-questions`. A row's second line is the source session's title, or **Side
  question** when the source isn't in the task's list. Picking a row calls `openManagedSession` and
  leaves the split alone.
- A `btw` group in `sessionOrder.ts`, so the fold's order button saves its choice per task.
- A `btw` flag on the extension bridge's session row (`BridgeAgentSession` in
  `packages/protocol/src/transport/extensionBridge.ts`), set in `apps/cli/src/browser/agents.ts`. The
  browser extension's Agents tab gained the same **Side questions** fold, because it mirrors the
  desktop sidebar and would otherwise list side sessions under **Managed sessions**.
- Docs: the order-button paragraph and a new sidebar paragraph in
  [client surfaces](../../managed-agents/client-surfaces.md#side-questions), and the fold list in
  [browser extension conversations](../../browser-extension/conversations.md).
- Tests: `AgentTaskSidebar.test.tsx` covers the filter, the source title and its fallback, the
  **need you** count, the request in **Needs you**, opening a row without the split, and the hidden
  fold. `sessionOrder.test.ts` covers the `btw` group, `agents.test.ts` in the CLI covers both flags,
  and the extension's `Conversation.test.tsx` covers its fold.

Decisions and deviations:

- The inline and side-question folds share one local component, `OriginChats`, in
  `AgentTaskSidebar.tsx`. Only the second line differs, so copying the 50 lines of row markup would
  have left two places to keep in step.
- I added a `btw` flag beside `inline` instead of one `origin` field. It's an added field, so readers
  of the bridge's output keep working.
- No Node code changed, so the Node service graph is unchanged at 1,940,389 B.
- I didn't walk the fold in `pnpm dev:agent`. The tests render the real kit components.

Every other origin reader:

- Agent Center, the attention inbox (`attentionSources` in `plugins/agents/src/client/index.ts`), and
  the `sessions` dashboard source (`sessionSourceHandler.ts`) don't filter on origin. Each lists side
  sessions the way it lists inline chats, with no change.
- The readers that do filter on origin all check `kind`: the sidebar's managed and workflow lists
  (keep sessions with no origin), `InlineDiffCard.tsx`, the git plugin's `changesModel.tsx`, and
  `ChangeRequestDiff.tsx` (keep `inline-diff` only), and the CLI's bridge row (both flags).

## Goal

The task sidebar lists side sessions in a **Side questions** section, with the same order button and
**need you** count as **Inline chats**. Every other place that reads a session's origin handles the
`btw` kind on purpose.

## Steps

1. In `AgentTaskSidebar.tsx`, add a `btwSessions` memo filtered on `session.origin?.kind === 'btw'`,
   and a **Side questions** `Fold` beside **Inline chats**, with `persistKey="agents.side-questions"`.
   Copy the inline section's rows. The second line names the source session's title instead of a
   file and line, and falls back to **Side question** when the source is gone.
2. Add a `btw` group to `sessionOrder.ts`, so the order button saves its choice per task like the
   other groups.
3. Picking a row opens the side session on its own, through `openManagedSession`. It doesn't reopen
   the split, which belongs to the source session's view.
4. In `apps/cli/src/browser/agents.ts`, the `inline` flag is true only for inline diff chats. Add a
   matching `btw` flag, or turn both into one `origin` field. Pick whichever keeps the command-line
   tool's output stable for scripts that read it.
5. Check Agent Center, the attention inbox, and the `sessions` dashboard source. Each should list side
   sessions the way it lists inline chats. Write down any that filter on origin.
6. Update the sidebar paragraph in [client surfaces](../../managed-agents/client-surfaces.md) that
   names the groups with order buttons.

## Acceptance

- A side session shows under **Side questions** and not under managed sessions.
- The section hides when the task has none, and its count matches the rows.
- A side session waiting on a permission request counts in the section's **need you** text and in the
  task's **Needs you** list.
- Archiving a side session removes its row, and the archived list shows it.
- Tests cover the filter, the order group, and the command-line tool's flag.
