# Phase 5: build the first release's features

Date: October 17, 2026. Status: shipped October 21, 2026. Needs [phase 3](./03-narrow-mode.md) and
[phase 4](./04-narrow-layouts.md).

## Completion note

Completed October 21, 2026. [Mobile web app](../../mobile.md) owns the shipped behavior,
[the conversation](../../mobile/agent-pane.md) owns the card's phone behavior, and
[the gate](../../notifications/gate.md#keeping-the-inbox-current) owns the inbox refresh. This page
keeps what the later phases need.

### What landed

- **Needs you** on Home (`NeedsYou.tsx`), from `createAttentionInbox`, with the count in the title.
  **New task** in the top bar opens `TaskDraftDialog`.
- `trackKeyboardInset` (`keyboardInset.ts`), which keeps `--keyboard-inset` and `data-keyboard` on
  `<html>`. The shell's height subtracts it, and the bar of panes hides while the keyboard is up.
- In client-core: `onAttentionStateChange` in `deliver.ts`, which `createAttentionInbox` listens to;
  a narrow rule in `overlays.css` that turns every `role="dialog"` modal into a full-screen sheet; and
  an export of `TaskDraftDialog` from `features/tabs`.
- `formFactor` exported from `@acorn/plugin-api/client`, with the surface snapshot updated.
- `AgentRequestCard` draws full-width permission buttons and answers a lone single-choice question
  with the tap on its option, on a narrow form factor only.
- Tests: the keyboard measure, the gate's new cue, and the card's phone behavior.

I checked it in Chromium at 390 by 844 against a throwaway standalone Node, with sessions seeded
through `AgentStore`: one with a permission request and a long tool call, one with a question of three
choices. Tapping a **Needs you** row opened the Agents pane on that session. One tap on **Postgres**
posted `{ answers: { q1: 'Postgres' } }` to the resolve route (the sandbox has no agent adapter, so
the agent then reported an error). With the inbox open, a change to a session's attention appeared
and disappeared within two seconds. A stubbed `visualViewport` that shrank by 336 pixels left the
composer and **Send** inside the shell. **New task** made a task that the Node listed, and the phone
opened it. The screenshots are in
`/Users/jamesmacfie/Source/acorn/apps/node/.acorn/worktrees/jamesmacfie-acorn-phase-5-needs-you/references/mobile-phase-5/`,
a folder git ignores. They aren't committed.

### Decisions and deviations

- **The inbox didn't refresh on events.** It fetched once per Node, so a request raised later never
  showed, on the desktop's bell either. The gate now says when a state changed and the inbox refetches.
  A session that only bumped its `updatedAt` doesn't count.
- **The draft form loads when **New task** is pressed.** With it in the first load, the startup scripts
  were 530,402 B against the ceiling of 507,000 B. They are 492,518 B now, and the styles 124,054 B.
  Client-core's entrypoint cap went from 209 to 210 for `features/tabs/TaskDraftDialog.tsx`.
- **The inbox waits for the roster.** `createAttentionInbox` reads the registered sources once, and the
  phone registers its plugins after the first frame, so Home makes it when `rosterReady()` turns true.
- **A row opens the pane the target handler showed.** The handler calls `dispatchLayout`, and the phone
  takes the last pane of the task's layout, as the terminal's `panes.ts` reads the same layout. This
  works for the agents and workflows sources without the phone naming either. A row with no task runs
  its handler and goes nowhere.
- **The card changed, in the agents plugin.** This page said it adds no plugin code, but a question
  can't be answered with one tap without the card choosing buttons over a dropdown, and that changed
  desktop behavior unless it reads the form factor. So `formFactor` is now exported to plugins, which
  phase 3 anticipated. The desktop's card draws as before.
- **Every `role="dialog"` modal is a sheet, not only the draft form.** The rule is in the shared
  stylesheet. An `alertdialog` stays a box. I didn't check the other dialogs.
- **No in-app help text.** The app has no help screen, and adding one is a feature of its own. What the
  phone leaves out is in `docs/mobile.md` (Limits) and `docs/features.md` (Phone).
- **New task offers every visible project.** The desktop offers the active workspace's, and a phone has
  none.
- **The draft form navigates itself.** Its own `pathForTask` gives `/t/:id` for a local task, which is the
  phone's route, so the phone passes no `onCreated`.

### What later phases need

- **Phase 6.** Check on a real phone that `visualViewport` gives the inset on iOS Safari and Android
  Chrome, and that a focused field scrolled by the browser (`offsetTop` above zero) leaves the shell
  in view. I only checked a stub. With the keyboard up the composer is about 280 pixels tall and the
  transcript nearly vanishes; trimming the composer's notice and hint lines would give it room. The
  pane's header row overflows sideways at 390 pixels, so the usage chip is cut off.
- **Not checked.** A permission request answered on the phone clearing on the desktop, because the
  sandbox's agent adapter is missing, so no real request resolved. The route and the refresh each
  worked on their own.
- **Seeding a request.** `makeTestNodeContext({ plugin: { name: 'agents' }, dataDir })` and
  `AgentStore.recordEvent` write a pending request into a stopped Node's data root. A Node boot marks
  every pending request expired, so set `status = 'pending'` in `agents.sqlite` afterwards, and change a
  session through `PATCH` to make the Node send its frame.


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
  ([the Needs you list](../../browser-extension/notifications.md#the-needs-you-list)). Read it for the
  wording and the order of items, not the code. The extension's list reads a bridge operation, and the
  phone reads the inbox.

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
