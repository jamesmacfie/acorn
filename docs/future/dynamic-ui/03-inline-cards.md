# Phase 3: apps as inline cards

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang and plans. Depends on a **Go** from
[phase 2](./02-renderer-and-spike.md). Read [design.md](./design.md) first.

## Goal

An agent builds a task app and shows it inline in the conversation. The owner asks for a change and
gets the next revision as a new card, with the old one collapsed to a line. Everything an app needs to
exist is built here: the host plugin, the library, the tools, validation, and revisions.

## What the owner gets at the end

- In a managed chat, "build me a checklist for this migration" produces a working app card in the
  conversation.
- "Add a column for who owns each step" produces v2 as a new card. The v1 card collapses to "v1: first
  version. Replaced by v2." with **Show v1** and **Restore v1**.
- A chart or table inside an app is a dashboard panel, with the dashboard's row menus and drill-down.
- No app prompts for trust, on any revision.
- A card that could not be built never appears. The agent sees the errors and tries again.

## Starting point

- The renderer package and the answers from phase 2.
- `panel_guide` and the plan checks from [phase 1](./01-agent-panels.md).
- The dashboard run route and views ([dashboards](../../dashboards.md)).
- The `agents:tool-card` point, declared in `plugins/agents/src/client/index.ts`.

## Requirements

### The host plugin and storage

1. A first-party host plugin owns apps. Its name is decided in this phase. It must not be confused
   with the repository's `apps/` folder.
2. An app is a folder under the Node's data root with `app.json`, a working program and plans, and
   numbered, immutable revisions, as [the design](./design.md#an-app-is-a-program-and-its-plans) lays
   out.
3. In this phase every app is a task app.

### The library

4. The library's spec half, the Zod schemas and descriptions, lives in the host plugin's shared code.
   The client half binds layout and form components to the kit through `@acorn/plugin-api/ui`, and
   `Panel` to the dashboard views.
5. Layout and form components are only kit components that render in both the desktop app and the
   terminal client. `Panel` draws one line in the terminal.
6. The library has no chart or table component apart from `Panel`.
7. The library has an ID and a version, and every revision records the version it was written
   against. Library changes follow OpenUI's rules for stored programs: add props only at the end,
   never reorder or remove one, and give a new required prop a default.
8. The library includes the components, functions, and plan inputs phase 2 listed as missing.

### Tools

9. `app_create`, `app_read`, `app_write`, `app_patch`, `app_show`, `app_list`, and `app_guide` behave
   as [the tools table](./design.md#app-tools) describes.
10. `app_write` and `app_patch` need the current hash. `app_patch` merges program statements by name,
    and `name = null` deletes one.
11. `app_guide` returns the prompt `lang-core` generates from the library, the plan instructions from
    `panel_guide`, and the worked examples from phase 2. It tells the agent to use `panel_show` when a
    request is one view of one plan.

### What a program can reach, and validation

12. The host gives a program only its own plans and the tools and actions in
    [what an app can reach](./design.md#what-an-app-can-reach).
13. The client runs every plan through the dashboard run route under the viewer's device. A program
    reads no data source any other way.
14. `app_show` runs the seven checks in
    [validation](./design.md#validation-before-anything-is-shown) on the Node, and returns every
    failure to the agent, with its code, path, and hint, without drawing a card.
15. The host sets `$placement` to `card`.
16. `@ToAssistant` puts text in the composer and never sends it.
17. `@OpenUrl` opens HTTP and HTTPS URLs only, after a confirm that shows the full URL.
18. The row-action mutation shows the host's risk confirm before it runs.

### Cards and revisions

19. A successful `app_show` publishes the next revision, makes it head, and draws a card through
    `agents:tool-card`.
20. Only the newest card per app is interactive. Older cards collapse to their revision, the agent's
    note, **Show**, and **Restore**. **Show** draws that revision read only.
21. **Restore** publishes the old revision's files as a new revision. It needs a device principal.
22. A card caps at 480 pixels with **Expand**, and runs its plans only while it is in view.
23. `lang-core` and the renderer load with the first app card, through a dynamic import.

### Security review

24. A security review of the interpreter and the tool mapping is complete before the phase ships. It
    starts from the findings in [no trust grant](./design.md#no-trust-grant).

### Terminal client

25. App cards draw in the terminal transcript, capped in rows.

## Out of scope

- The task Apps pane and the editing drawer. That is [phase 4](./04-task-pane.md).
- Saving app state. That is phase 4.
- Project apps. That is [phase 5](./05-project-apps.md).
- Apps on dashboards. That is [phase 6](./06-apps-on-dashboards.md).
- Publishing the renderer package. See [the open questions](./README.md#open-questions).

## Steps and checkpoints

### 1. Host plugin, storage, and tools

**Checkpoint 1.** Call the tools by hand through MCP: create an app, write a plan and a program that
draws a heading above `Panel` of that plan, and show it. The card appears with a dashboard view in it.
The files are under the data root, and the task's worktree has no new files.

### 2. Validation

**Checkpoint 2.** Show a program that names a component the library lacks, one that leaves out a
required prop, one whose `Query` names a plan the app doesn't have, one that sets `$placement`, and one
that is a single `Panel`. Each fails with its code and hint, the last one points to `panel_show`, and
no card appears.

### 3. Revisions

**Checkpoint 3.** Show three revisions. Only the third card is interactive. **Show v1** draws v1 read
only. **Restore v1** produces v4 with v1's files.

### 4. What a program can reach

**Checkpoint 4.** A button with `@ToAssistant` fills the composer and sends nothing. A row action shows
the risk confirm. `@OpenUrl` with a `file:` URL does nothing and reports why, and one with an HTTPS
URL shows the full URL before it opens.

### 5. An agent builds one

**Checkpoint 5.** In a managed Claude chat on a task with a linked PR, ask for "the review comments
grouped by file, with a button to jump to each". The agent reads `app_guide`, builds the app, and shows
it. Ask for a change. A second card appears and the first collapses. Ask for "a chart of my open pull
requests by repository". The agent uses `panel_show`, not an app.

**Checkpoint 6.** The same flow in the terminal client, in the isolated PTY driver.

## Docs that change

- [Agent tools](../../agent-tools.md): the seven app tools.
- [Managed agents](../../managed-agents.md): app cards in the transcript.
- [Security](../../security.md): what a program can reach, and why apps need no trust grant.
- [Plugins](../../plugins.md): the apps host plugin.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- The phase 2 results.
- That a compiled first-party plugin can fill `agents:tool-card` for `app_show`, and whether the
  point's `replace` mode, one card per tool name, lets one plugin draw every app's card.
- That the dashboard views draw inside a card with no dashboard around them: no grid, no placement,
  and no panel menu.
- How a row action is addressed, so one mutation tool can run it.
- Whether the host's external-link handling already confirms before it opens a URL.
