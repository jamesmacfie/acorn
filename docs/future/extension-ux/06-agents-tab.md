# Phase 6: a task's Agents tab

Date: October 16, 2026. Status: proposed. Depends on [phase 1](./01-navigation.md). Take
[phase 5](./05-this-page.md) first if you can, since this phase's empty state shows the item it
leaves waiting.

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
