# Phase 1: apps as inline cards

Status: proposed, 2026-10-01. Depends on a **Go** from [phase 0](./00-spike.md). Read
[design.md](./design.md) first.

## Goal

An agent builds a task app and shows it inline in the conversation. The owner asks for a change and
gets the next revision as a new card, with the old one collapsed to a line. Everything an app needs to
exist is built here: the package format, the tools, the profile, validation, revisions, and app trust.

## What the owner gets at the end

- In a managed chat, "build me a view of X" produces a working card in the conversation.
- "Add a filter" produces v2 as a new card. The v1 card collapses to "v1: first version. Replaced by
  v2." with **Restore v1**.
- The first app on a device asks once for app trust. Later revisions do not prompt.
- A card that could not be built never appears. The agent sees the errors and tries again.

## Starting point

- The scaffold, dev mode, and `plugin_authoring`, as [research](./research.md#what-acorn-already-has)
  lists.
- The `agents:tool-card` point, declared in `plugins/agents/src/client/index.ts`.
- The phase 0 answers about nested trees, headless validation, and worker cost.

## Requirements

### The package and the host plugin

1. A first-party host plugin owns apps. Its name is decided in this phase. It must not be confused
   with the repository's `apps/` folder.
2. An app is a folder under the Node's data root with `app.json` and numbered, immutable revisions, as
   [the design](./design.md#one-identity-from-the-start) lays out.
3. The host installs an app's head through the local-folder install path, under a reserved plugin ID
   prefix. Apps do not appear in **Settings > Plugins > Installed**.
4. In this phase every app is a task app.

### Tools

5. `app_create`, `app_read`, `app_write`, `app_edit`, `app_show`, `app_list`, and `app_guide` behave as
   [the tools table](./design.md#tools) describes.
6. `app_write` needs the current hash for an existing file. `app_edit` fails when the string is missing
   or not unique.
7. `app_guide` derives its component list and bridge calls from the running host, and includes worked
   examples from phase 0.

### The profile and validation

8. An app manifest may declare only one client tree entry, the data sources it reads, and its name and
   description. Anything else fails `app_show`.
9. The bridge refuses every call outside [the profile](./design.md#what-an-app-can-reach), and every
   data source the manifest did not declare.
10. `app_show` runs the five checks in [validation](./design.md#validation-before-anything-is-shown) and
    returns every failure to the agent without drawing a card.
11. The tree receives its placement, `card` in this phase, as a prop.

### Cards and revisions

12. A successful `app_show` publishes the next revision, makes it head, and draws a card through
    `agents:tool-card`.
13. Only the newest card per app is live. Older cards collapse to their revision, the agent's note, and
    **Restore**.
14. **Restore** publishes the old revision's files as a new revision. It needs a device principal.
15. A card caps at 480 pixels with **Expand**, and mounts its worker only when it scrolls into view.
16. The compose call puts text in the composer and never sends it.

### App trust

17. The first app on a device and Node shows the app trust prompt. Accepting records a grant that
    auto-accepts app bundles inside the profile, from that Node, on that device.
18. **Settings > Plugins** shows the grant with **End app trust**, which removes the grant and every
    acceptance it wrote.
19. A security review of the profile and the grant is complete before the phase ships.

### Terminal client

20. Cards draw in the terminal transcript, capped in rows, using only kit components with a terminal
    rendering.

## Out of scope

- The task Apps pane and the editing drawer. That is [phase 2](./02-task-pane.md).
- App state. That is phase 2.
- Project apps. That is [phase 3](./03-project-apps.md).

## Steps and checkpoints

### 1. Package, host plugin, and tools

**Checkpoint 1.** Call the tools by hand through MCP: create an app, write a tree that renders a heading,
and show it. The card appears. The files are under the data root, and the task's worktree has no new
files.

### 2. Validation

**Checkpoint 2.** Show an app whose tree throws, one that names a component the kit does not have, and
one whose manifest declares a network permission. Each fails with a clear error and no card.

### 3. Revisions

**Checkpoint 3.** Show three revisions. Only the third card is live. **Restore v1** produces v4 with
v1's files.

### 4. App trust

**Checkpoint 4.** On a device that never granted app trust, the first card prompts once. The second and
third revisions do not. **End app trust** removes it, and the next card prompts again.

### 5. An agent builds one

**Checkpoint 5.** In a managed Claude chat on a task with a linked PR, ask for "the review comments
grouped by file". The agent reads `app_guide`, builds the app, and shows it. Ask for a change. A second
card appears and the first collapses.

**Checkpoint 6.** The same flow in the terminal client, in the isolated PTY driver.

## Docs that change

- [Agent tools](../../agent-tools.md): the seven app tools.
- [Managed agents](../../managed-agents.md): app cards in the transcript.
- [Security](../../security.md): the app profile and app trust.
- [Plugins](../../plugins.md) and [activation](../../plugins/activation.md): the reserved prefix and
  the grant.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- The phase 0 results.
- Where dev mode's grant is recorded, so app trust extends it instead of copying it.
- Whether the tool card's `replace` mode, one card per tool name, allows one host plugin to draw every
  app's card.
