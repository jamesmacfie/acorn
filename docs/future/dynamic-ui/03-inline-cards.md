# Phase 3: apps as inline cards

Status: built, 2026-10-19. Depends on a **Go** from [phase 2](./02-renderer-and-spike.md). Read
[design.md](./design.md) first. The shipped behavior is in [agent-built apps](../../agent-built-apps.md),
which wins where this page disagrees.

## Completion note, October 19, 2026

**What landed.** The phase 2 slice first, then apps.

- **Account IDs for agents.** `data_sources_list` names each source's provider and lists the person's
  accounts for those providers by ID, label, and status (`agentTools/sourceAccounts.ts`). No
  credentials.
- **Plan inputs on the run route.** The run takes `inputs`, and `resolvePlanContexts` fills a filter's
  `{ from: "input" }` addresses beside `context`. A run that leaves out an input the plan reads fails
  at `/stages` with the input's name. `PublishedDashboardPanel` and its drill-downs pass `inputs`.
- **A set of ticked rows.** `@Includes(list, value)` and `@Toggled(list, value)`. A row's `Checkbox`
  takes `@Includes(…)` as `checked` and `@Set($ticked, @Toggled($ticked, r._id))` as its `action`.
- **Grouping live rows.** `@GroupBy(rows, field)` returns `[{ key, rows }]`.
- **A bar chart over a text field.** A `text` column is a chart's axis when a summarize stage groups
  by it (`isChartAxis` in `planColumns.ts`, used by the validator, the view needs, and the chart).
- **A compose hook.** `composeForAgent(taskId, text)` in `@acorn/plugin-api/client` puts plain text in
  the composer. The reference-target contract gained an `as: 'reference' | 'text'` argument, and the
  agents plugin adds `@` only for a reference.
- **`Card` in a row.** A `Card` inside a row `Stack` gets the kit card's `fit`.

Then the host plugin, `plugins/trellis`: storage under `<data root>/apps/`, the seven tools, the seven
checks, revisions with **Show** and **Restore**, the card in `agents:tool-card`, the library's spec and
kit bindings, and the terminal halves. Core gained a compiled-only `ctx.dashboards` seam
(`planProblems`, `guide`), which `panel_show` and `app_show` share, and `@acorn/plugin-api/ui/dashboards`
gained `CardFrame` and `PlanPanel`. The panel card moved onto `CardFrame`, so both cards cap, expand,
and pause off screen the same way. [Agent-built apps](../../agent-built-apps.md) is the owning doc, and
the public site has a Built-in plugins page for Apps. The four plugin golden lists gained the plugin's
card, route, and seven tools.

**Decisions and deviations.**

- **The code name is `trellis`.** A trellis is the frame something grows on, and an app that outgrows
  it is replanted as a plugin in phase 7. It shares nothing with `apps/`, the desktop app, the panel
  studio, or an HTML canvas. The first pick, `easel`, is in the device fingerprint word list, which
  the "core never names a plugin" rule reads as naming a plugin.
- **`@Toggled` is a function, not a `@Toggle` action.** A library action receives values, not the
  variable, so it couldn't write. `@Set` with a pure function does the same with no new host code.
- **No `@Compose` and no `Link`.** `@ToAssistant` fills the composer, and a `Button` with `@OpenUrl`
  is a link. The library has 17 components and three functions.
- **Restore draws on the card that asked.** A restored revision has no `app_show` call of its own.
  The card whose revision head was restored from draws head, labelled "restored from v1", and every
  other card collapses. That holds after a reload, because `revision.json` records `restoredFrom`.
  Restore also copies the files into the working copy, so the agent's next `app_show` builds on them.
- **A failed `app_show` shows the panel card's failure line and the error**, not nothing, which is
  phase 1's pattern. No card with an app in it appears.
- **App state isn't saved.** `$` variables last while the card is open, as the phase says. The guide
  tells agents so, because the first agent in checkpoint 5 told the person their ticks would be kept.
- **The terminal can't open a link.** Its URL confirm offers **Copy** instead of **Open**.
- **Row action rows come from the host.** A query's rows carry `_id` and `_actions`. `rowAction`
  takes a plan, row ID, and action ID, and the card looks all three up in its own last run of that
  plan. A program can't name a record or action the source didn't offer.
- **The Node's service budget rose 6,000 bytes**, to 1,897,800. The plugin's declarations, seven tool
  descriptions and input schemas, cost 4,321 bytes on the boot path. Everything else, lang-core
  included, loads on the first tool call in a 102 KB chunk. The store, the routes, and the account
  lookup are lazy too.
- **Two phase 2 reds fixed on the way.** `openui-solid`'s conformance tests cited OpenUI repository
  paths that the comment-path rule read as local files. They now cite URLs. The architecture
  resolver didn't handle a package's root export, so a bare `@acorn/openui-solid` import failed to
  resolve. Plugins may now import `@acorn/openui-solid`, the way they import `@acorn/protocol`.

**Verify-before-building answers.** A compiled plugin fills `agents:tool-card` for `app_show` as the
memory plugin does for its tools, and `matches` names one tool, so one plugin draws every app's
card. The dashboard views draw in a card with no dashboard around them through
`PublishedDashboardPanel` with an unpublished plan, as phase 1's card does. A row action is
addressed as a record ref plus an action ID, posted to `/v1/core/data-sources/act` with the confirmed
risk. The host's external-link path for dashboards doesn't confirm, so the app card has its own
confirm.

**Checks run.** Unit tests: `plugins/trellis` (26), the terminal render in
`apps/tui/src/trellis.test.tsx`, the run inputs in `inputs.test.ts`, the account lookup in
`sourceAccounts.test.ts`, the text axis in `plan.test.ts`, and compose in `reference.test.ts`. Live, in
a `pnpm dev:agent` window with a managed Claude Code session (Opus 5.5, Auto mode) on a worktree task:

- Checkpoint 1: passed. The card drew a heading above the dashboard's own table of the core tasks
  source. The files were under the data root's `apps/`, and the worktree's `git status` was empty.
- Checkpoint 2: passed. The five programs failed with `unknown-component`, `missing-required`,
  `unknown-plan`, `reserved`, and `single-panel`, the last pointing to `panel_show`, and no card drew.
  The agent noticed lang-core's messages lack a closing period, so problems now end with one.
- Checkpoint 3: passed. With v1 to v3 shown, only v3 was interactive. **Show v1** drew v1 under its
  line. **Restore v1** made v4, "restored from v1", with v1's program, drawn on v1's card.
- Checkpoint 4: passed for compose and links. **Ask** filled the composer and sent nothing. A `file:`
  link did nothing and said "This app tried to open a file: link. Apps open only web links." An
  HTTPS link showed the full URL in a confirm. The row-action confirm wasn't exercised live, because
  no source on the dev Node offers named row actions. `AppView.test.tsx` covers it, including a
  forged row ID that never reaches the action route.
- Checkpoint 5: passed with a substitute prompt. The dev Node has no GitHub account and no source
  carries review comments, which phase 2 also found. Asked in a fresh session for "my tasks grouped by
  status, each with a tick … a count … and a button that asks you what's left", the agent read
  `app_guide` and built it on its first `app_show`. "Only active tasks, with the branch as a badge"
  produced v2, and v1 collapsed. "A chart of my agent sessions by provider" went to `panel_show`, a
  bar over a text column, which the new axis rule allows.
- Checkpoint 6: not run live. The terminal launcher's own Node can't open the desktop session's data
  root, whose keys the desktop app sealed ("Start this Node from the desktop app, or set
  SESSION_ENC_KEY"), and its own seeded Node has no managed transcript with `app_show` calls. Getting
  past that means handling the session's encryption key, which this check doesn't justify.
  `apps/tui/src/trellis.test.tsx` draws an app through the terminal kit inside a pane body: the card,
  a checkbox with its hint beside the label, the `Panel` line, and Space ticking the box, which
  updates the count.

**For later phases.**

- Phase 4 saves app state. The runtime's `snapshot()` and `initialState` are ready, and the guide's
  sentence about state not being saved must change with it.
- The terminal card caps at 24 rows with no **Expand**. A pane will want the full height.
- `describePanelPlan` text is still long inside an app's `Panel`, as phase 1 noted.
- An agent in a task can still write into the data root. `app_show`'s checks keep broken cards out of
  the conversation but aren't the security boundary. See the review below.
- A task can create any number of apps. Nothing limits the count.

## Security review, October 19, 2026

Requirement 24. The review starts from [no trust grant](./design.md#no-trust-grant) and
[what an app can reach](./design.md#what-an-app-can-reach), and asks one question per path: how could
a program reach beyond its plans and the host tools, and what stops it?

**The boundary is the card, not `app_show`.** An agent runs as the person's OS user and can write
into the data root, so it can plant a revision that skipped every check. Each item below is enforced
where the program runs, so a planted revision reaches no more than one that passed.

| # | Way a program could reach further | What stops it |
| --- | --- | --- |
| 1 | Call a function it read off a value, such as `x.constructor`. | lang-core resolves `@Name(…)` only against the library and its built-ins, and a name such as `@toString` or `@constructor` fails to parse as `inline-reserved`. Checked by probing the validator. |
| 2 | Put a built-in function on an object as `toString` or `toJSON`, so coercion calls it. | Found: lang-core's own `+` calls it, with no arguments, while evaluating. The reachable functions are JavaScript built-ins, none of which runs program text, so the residual risk is a built-in called with no arguments on the program's own object. **Fixed** for host code: `plainData` copies every program value to plain JSON before the host reads, sends, or prints it, and bindings draw only strings, numbers, and booleans. Test: `plainData.test.ts`. |
| 3 | Name a tool on the prototype, such as `Query("toString", …)`. | **Fixed**: the renderer's tool lookup takes own names only. `app_show` also refuses any name that isn't one of the app's plans or `task`. |
| 4 | Read a data source directly, or a plan outside the app. | A query tool exists only for each plan in the revision's own files, fetched from the Node, and runs through the dashboard run route under the viewer's device. `Panel` looks up the same plans. The program text names plans; it can't supply one. |
| 5 | Act on a record it chose, or an action the source didn't offer. | `rowAction` finds the row and action in the card's own last run of that plan, by ID. A forged row ID throws before any request (`AppView.test.tsx`). Then the card shows a confirm, and the Node checks the confirmed risk. |
| 6 | Send a message as the person. | `@ToAssistant` calls `composeForAgent`, which only appends a draft. Nothing in the card sends. Checked live. |
| 7 | Leak data through a link, or open a local file. | `@OpenUrl` and a row action's `openUrl` result go through one check: HTTP and HTTPS only, after a confirm showing the full URL. Checked live with `file:` and `https:`. |
| 8 | Act from an old revision. | A shown older revision is read only. Controls are off, actions are ignored, and `rowAction` refuses. |
| 9 | Reach another task's app through the tools. | Every tool loads the app and refuses one whose task isn't the caller's, as if it didn't exist (`handlers.test.ts`). |
| 10 | Reach files outside the app folder. | App IDs, file names, and plan names are checked by pattern before they reach a path, and route parameters are parsed the same way. |
| 11 | Restore, or read revisions, as an agent. | The routes are device-only. An agent's task token gets 403. |
| 12 | Fill the disk. | **Fixed**: a working file is at most 256 KiB, and a patch that would grow the program past that fails. The number of apps isn't limited. |
| 13 | Learn records through `app_show`. | Plan checks run as the Node's service principal, describe sources, and read no records, as `panel_show` does. |
| 14 | Report usage to OpenUI. | lang-core's install script is denied in `allowBuilds`. Its runtime telemetry is opt-in, but reads the process environment. **Fixed**: the Node's handler module and the terminal client set `OPENUI_TELEMETRY_DISABLED`, so an owner who opted in for their own project doesn't have Acorn report too. |
| 15 | Run code at render time. | The renderer draws only library components through kit bindings. An unknown component draws nothing, and a component that throws is listed as `render-error` and drawn as a warning. |

Not fixed, and recorded for the reviewer: lang-core's evaluator can still make the zero-argument call
in row 2. Removing it needs lang-core to skip non-own members, which is an upstream change.

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
