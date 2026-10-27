# Phase 3: Side questions in the task sidebar

Date: October 27, 2026. Status: proposed. Needs phase 1.

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
