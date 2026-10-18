# Phase 5: build the first release's features

Date: October 17, 2026. Status: proposed. Needs [phase 3](./03-narrow-mode.md) and
[phase 4](./04-narrow-layouts.md).

## Goal

The app does the jobs a person picks up their phone for: see what agents are waiting on, answer them,
talk to an agent, and start a task. Each one reuses a part the desktop already has. This phase adds
screens to the shell and fixes whatever the shared parts get wrong at phone width. It adds no plugin
code.

## Starting point

- `packages/client-core/src/features/notifications/attentionInbox.ts` collects what's waiting on a
  person across tasks, and `markAttentionSeen` clears an item. The desktop's bell reads it.
- The agents plugin's pane draws the transcript, the composer, permission requests, questions, and
  **Stop** (`plugins/agents/src/client/paneContribution.ts`).
- `packages/client-core/src/features/tabs/TaskDraftDialog.tsx` is the desktop's draft flow for a task.
- The extension's sidebar has its own **Needs you** list
  ([Needs you](../extension-ux/04-needs-you.md)). Read it for the wording and the order of items, not
  the code. The extension's list reads a bridge operation, and the phone reads the inbox.

## The design

### Needs you

Home gets a **Needs you** section above the task list. Each item names the task, the agent, and what
it's asking. Tapping one opens the task on the agents pane with that session selected, through the
`selection` field from phase 4. The section hides when nothing waits. The home screen's title shows
the count.

### The agent conversation

The agents pane already does the work. Check each part at 390px and fix it in the shared component:

- The composer stays above the on-screen keyboard. Use `visualViewport` to measure the keyboard, in
  the shell, and pass the inset as a style value, so the plugin doesn't read the window.
- Permission and question cards show every choice without hover. Each choice is a full-width button.
- **Stop** stays visible while a turn runs.
- A long tool call folds, and the transcript scrolls without moving the composer.
- Attaching a file uses the page's own file input, which the seam falls back to when `files` is
  absent.

### New task

A **New task** button on the home screen opens `TaskDraftDialog` as a full-screen sheet. It creates
the task the same way the desktop does, then opens it.

### What the phone leaves out

These parts draw, but the first release doesn't promise them on a phone. Say so in the app's help
text and in [features](../../features.md) when it ships:

- Typing in a terminal. The terminal pane draws output, and the phone's keyboard can't send the
  control keys a shell needs.
- Editing files. The editor opens and saves, but nobody tested it at phone width.
- The dashboard editor.

## Acceptance

- A permission request raised on the desktop appears in **Needs you** within two seconds. Answering
  it on the phone clears it on the desktop.
- A question with three choices can be answered with one tap.
- With the on-screen keyboard open, the composer and **Send** stay visible in a Playwright run that
  sets a keyboard inset.
- A task started on the phone appears in the desktop's rail.
