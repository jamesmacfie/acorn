# Phase 6: a task's Agents tab

Date: October 16, 2026. Status: done on October 17, 2026. Depends on [phase 1](./01-navigation.md).
Take [phase 5](./05-this-page.md) first if you can, since this phase's empty state shows the item it
leaves waiting.

## Completion note

Landed on October 17, 2026. The Agents tab lives in `apps/extension/src/sidebar/Agents.tsx`, out of
`Home.tsx`. From the top it draws the task's **Needs you** list, **Managed sessions** as the kit's
`Section` with **New chat** in its header, then **Workflow runs** and **Inline chats** as the kit's
`Fold`, closed, with counts. Each conversation is the kit's stacked `Row`: the state icon, the title,
the provider's logo and model, and the age. A task with no conversation shows the kit's `EmptyState`
with **Start a chat**. Picking an agent opens the new conversation with the cursor in its message box.
[Agent conversations](../../browser-extension/conversations.md#a-tasks-agents-tab),
[navigation](../../browser-extension/navigation.md), [handoffs](../../browser-extension/handoffs.md),
[notifications](../../browser-extension/notifications.md), and three site pages are updated.

Decisions and deviations:

- The pending item shows in the empty state, as designed, and also above **Managed sessions** when
  the task has conversations. The chip's **New chat about this page** can leave an item on a task that
  already has chats, and without the second place it would wait unseen until the next chat took it.
- Fold state is a signal in `Workspace.tsx`, keyed by the fold's label and shared by every task. It's
  controlled, through `Fold`'s `open` and `onOpenChange`, so it never reaches `localStorage`, which
  `persistKey` would use.
- **Managed sessions** with no rows, while a fold has some, shows the desktop's "No managed sessions"
  small empty state, so **New chat** keeps its header.
- The age is the kit's `formatRelativeTime`, which the Runs tab also uses, so it reads "2m ago" rather
  than the prototype's "2m". It ticks each minute while the tab is open.
- The state words left the row, so they became the leading icon's accessible name, from `agentState`
  in `state.tsx`. The trailing alert is decorative.
- A provider with no registered logo shows its ID in words before the model.
- `AgentPicker` takes its `label`, with a plus icon, `solid` for the empty state, and opens at
  `bottom-end`. Each button's accessible name matches its text, so the empty state's picker is
  **Start a chat**, not **New chat**. Tests and `pnpm dev:extension:ui pick` use those names.
- Only a start focuses the composer: `Workspace.tsx` remembers the started session and passes
  `focused` through `Conversation` to `Composer`. Opening a conversation from a row leaves focus alone.
- `NeedsYou` gained `inTask`, which leaves the task's title out of a row's meta line.
- The kit's `primitives.css` spaces an icon from the text in a picker's label when the label holds
  both. A label that is only an icon, as `IconPicker`'s is, is unchanged.
- The rows use `.agent-rows`, not `.task-rows`, because they sit under the kit's section headers and
  keep the row's own padding. The old `.row-button.agent-row` rules are gone.

Sidebar-only, so a plugin can't reach it: `Agents`, `SessionRow`, and `AgentPicker` live in the
extension, not the kit, and so do the `.agent-rows`, `.agent-meta`, `.pending`, and `.pending-item`
rules in `sidebar.css`. The desktop's own row parts, `RuntimeStateIcon` and `ProviderGlyph`, sit in
the agents plugin's client, which the plugin doesn't export, so the extension uses the contract's
`runtimeIcon` and `runtimeTone` instead.

For later phases:

- Phase 7: the composer takes `focused`. The state line above it still reads from `agentState`.
- Phase 8: the Runs tab still draws its own `SectionHeader` lists; the Agents tab's folds show the
  kit's `Fold` in the sidebar, with no extra CSS.
- Tests: `apps/extension/src/test/sidebarUi.ts` has `chatRows`, the Agents tab's rows in its
  sections and open folds. `openChat` reads them, so a conversation in a closed fold needs its fold
  opened first, by clicking its `summary`.

## Goal

A task's Agents tab looks like the desktop's Agents sidebar. **New chat** sits in the section header,
where the desktop puts it. Rows use the desktop's stacked row. Workflow runs and inline chats fold.
The tab carries the desktop's Agent button markers, which phase 1 added.

## In the prototype

- Scenarios: **Agents** and **New chat**. In **Agents**, open the **Workflow runs** and **Inline
  chats** folds. In **New chat**, note the greyed Gemini row.
- Notes: `agents` at line 1304 and `new-chat` at line 1306.
- Code: `agentsView` at line 920 draws the tab, including its empty state. `sessRow` at line 942
  draws a row, and `sessIcon` at line 626 its icon. The `newchat` case of `pickerSpec` at line 1080
  lists the picker's rows.
- Today: `references/extension-ux/today/05-agents-dark.png` and `06-new-chat-picker-dark.png`.

## Starting point

- `Agents` in `apps/extension/src/sidebar/Home.tsx`, at about line 454, draws the list. It groups
  conversations with `SESSION_GROUPS` into **Managed sessions**, **Workflow runs**, and **Inline
  chats**, all open. A row reads "claude · opus · working". `NewChat` sits at the bottom of the list.
- `AgentPicker` in `apps/extension/src/sidebar/agentChoice.tsx` is already the desktop's New picker in
  the kit's `Picker`: a filter, provider logos, logins, custom agents, and agents that can't start
  greyed with the reason.
- `runtimeIcon` and `runtimeTone` give a session's state icon. They come from the agents plugin's
  `plugins/agents/src/contract/runtimeState.ts`, which the desktop's rows also use.
- The desktop's sidebar is `plugins/agents/src/client/sessions/AgentTaskSidebar.tsx`.

## The design

### Sections

From the top:

1. **Needs you**, with this task's requests, as phase 4 draws them. Only while one waits.
2. **Managed sessions**, with **New chat** at the right of its header: a small button with a plus
   icon and a chevron, opening `AgentPicker`.
3. **Workflow runs**, a fold, closed by default, with its count in faint type.
4. **Inline chats**, a fold, closed by default, with its count.

A fold with no rows isn't drawn. Use the kit's `Fold` from
`packages/client-core/src/kit/components/layout/Fold.tsx`. Remember each fold's state for the panel's
life, not in storage.

### A row

The kit's stacked row:

- Leading, the state icon: the amber `circle-alert` when the conversation has a pending request, else
  the runtime icon, spinning while it works, and a muted `circle-check` when idle.
- The title in bold.
- Under it, the provider's logo and the model, such as "Opus · High". Drop the state word. The icon
  says it.
- Trailing, the amber alert again when the conversation waits on you, then the time since
  `updatedAt`, such as "2m".

The row opens the conversation with `openConversation(sessionId, 'agents')`.

### The empty state

A task with no conversation shows a centred empty state: a faint `bot` icon, "No chats in this task",
then, when the task has a pending item from phase 5, its chip with an × and "Goes with your first
message." under it. Then **Start a chat**, solid, with a plus and a chevron, opening `AgentPicker`.

### Starting a chat

Choosing an agent starts the conversation, opens it, and focuses the message box. A pending item moves
into the composer as a chip. The picker keeps its **Check agents again** refresh, which calls
`agents.choices` with `refresh`.

## Changes

1. Move `Agents` and `NewChat` out of `Home.tsx` into their own file, such as `sidebar/Agents.tsx`
   (new). They belong to the task level, not Home.
2. Put **New chat** in the **Managed sessions** header, and add the folds.
3. Redraw the row as above, with the time.
4. Add the empty state with the pending item chip.
5. Focus the composer after a start.
6. Test the groups and folds, the row's icon for each state, the empty state with and without an item,
   and focus after a start.
7. Update [agent conversations](../../browser-extension/conversations.md).

## Acceptance

- A task with three managed conversations, one workflow step, and one inline chat shows three rows,
  then two closed folds with counts of one.
- A working conversation's row spins and has no "working" word.
- **New chat** › **Claude Code** opens the conversation with the cursor in the message box.
- A greyed agent in the picker says why and can't be chosen.
