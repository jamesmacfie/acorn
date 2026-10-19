# Phase 1: apps as inline cards

Status: proposed, 2026-10-01. Revised 2026-10-19 for OpenUI Lang. Depends on a **Go** from
[phase 0](./00-spike.md). Read [design.md](./design.md) first.

## Goal

An agent builds a task app and shows it inline in the conversation. The owner asks for a change and
gets the next revision as a new card, with the old one collapsed to a line. Everything an app needs to
exist is built here: the host plugin, the library, the tools, validation, and revisions.

## What the owner gets at the end

- In a managed chat, "build me a view of X" produces a working card in the conversation.
- "Add a filter" produces v2 as a new card. The v1 card collapses to "v1: first version. Replaced by
  v2." with **Show v1** and **Restore v1**.
- No app prompts for trust, on any revision.
- A card that could not be built never appears. The agent sees the errors and tries again.

## Starting point

- The renderer package from phase 0, and the phase 0 answers about the two clients, the Node side,
  and client cost.
- The `agents:tool-card` point, declared in `plugins/agents/src/client/index.ts`.
- Typed data sources and their row actions ([data sources](../../data-sources.md)).

## Requirements

### The host plugin and storage

1. A first-party host plugin owns apps. Its name is decided in this phase. It must not be confused
   with the repository's `apps/` folder.
2. An app is a folder under the Node's data root with `app.json`, a working program, and numbered,
   immutable revisions, as [the design](./design.md#an-app-is-a-program) lays out.
3. In this phase every app is a task app.

### The library

4. The library's spec half, the Zod schemas and descriptions, lives in the host plugin's shared code.
   The client half binds each component to the kit through `@acorn/plugin-api/ui`.
5. The library holds only kit components that render in both the desktop app and the terminal client.
6. The library has an ID and a version, and every revision records the version it was written
   against. Library changes follow OpenUI's rules for stored programs: add props only at the end,
   never reorder or remove one, and give a new required prop a default.
7. The library includes the components and functions phase 0 listed as missing.

### Tools

8. `app_create`, `app_read`, `app_write`, `app_patch`, `app_show`, `app_list`, and `app_guide` behave
   as [the tools table](./design.md#tools) describes.
9. `app_write` and `app_patch` need the current hash. `app_patch` merges statements by name, and
   `name = null` deletes one.
10. `app_guide` returns the prompt `lang-core` generates from the library and the tools, plus the
    worked examples from phase 0.

### What a program can reach, and validation

11. The host gives a program only the tools and actions in
    [what an app can reach](./design.md#what-an-app-can-reach).
12. `app_show` runs the five checks in [validation](./design.md#validation-before-anything-is-shown) on
    the Node, and returns every failure to the agent, with its code and hint, without drawing a card.
13. The host sets `$placement` to `card`.
14. `@ToAssistant` puts text in the composer and never sends it.
15. `@OpenUrl` opens HTTP and HTTPS URLs only, after a confirm that shows the full URL.
16. The row-action mutation shows the host's risk confirm before it runs.

### Cards and revisions

17. A successful `app_show` publishes the next revision, makes it head, and draws a card through
    `agents:tool-card`.
18. Only the newest card per app is interactive. Older cards collapse to their revision, the agent's
    note, **Show**, and **Restore**. **Show** draws that revision read only.
19. **Restore** publishes the old revision's program as a new revision. It needs a device principal.
20. A card caps at 480 pixels with **Expand**, and runs its queries only while it is in view.
21. `lang-core` and the renderer load with the first card, through a dynamic import.

### Security review

22. A security review of the interpreter and the tool mapping is complete before the phase ships. It
    starts from the findings in [no trust grant](./design.md#no-trust-grant).

### Terminal client

23. Cards draw in the terminal transcript, capped in rows.

## Out of scope

- The task Apps pane and the editing drawer. That is [phase 2](./02-task-pane.md).
- Saving app state. That is phase 2.
- Project apps. That is [phase 3](./03-project-apps.md).
- Publishing the renderer package. See [the open questions](./README.md#open-questions).

## Steps and checkpoints

### 1. Host plugin, storage, and tools

**Checkpoint 1.** Call the tools by hand through MCP: create an app, write a program that draws a
heading, and show it. The card appears. The files are under the data root, and the task's worktree has
no new files.

### 2. Validation

**Checkpoint 2.** Show a program that names a component the library lacks, one that leaves out a
required prop, one whose `Query` names an unknown tool, and one that sets `$placement`. Each fails with
its code and hint, and no card appears.

### 3. Revisions

**Checkpoint 3.** Show three revisions. Only the third card is interactive. **Show v1** draws v1 read
only. **Restore v1** produces v4 with v1's program.

### 4. What a program can reach

**Checkpoint 4.** A button with `@ToAssistant` fills the composer and sends nothing. A row action shows
the risk confirm. `@OpenUrl` with a `file:` URL does nothing and reports why, and one with an HTTPS
URL shows the full URL before it opens.

### 5. An agent builds one

**Checkpoint 5.** In a managed Claude chat on a task with a linked PR, ask for "the review comments
grouped by file". The agent reads `app_guide`, builds the app, and shows it. Ask for a change. A second
card appears and the first collapses.

**Checkpoint 6.** The same flow in the terminal client, in the isolated PTY driver.

## Docs that change

- [Agent tools](../../agent-tools.md): the seven app tools.
- [Managed agents](../../managed-agents.md): app cards in the transcript.
- [Security](../../security.md): what a program can reach, and why apps need no trust grant.
- [Plugins](../../plugins.md): the apps host plugin.
- [Testing](../../testing.md): the manual checks above.

## Verify before building

- The phase 0 results.
- That a compiled first-party plugin can fill `agents:tool-card` for `app_show`, and whether the
  point's `replace` mode, one card per tool name, lets one plugin draw every app's card.
- How a data source's query options, rows, and details map to OpenUI tool specs, and how a row action
  is addressed so one mutation tool can run it.
- Whether the host's external-link handling already confirms before it opens a URL.
