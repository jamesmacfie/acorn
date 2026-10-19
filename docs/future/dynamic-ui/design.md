# Agent-built apps: the design

Status: proposed, 2026-10-01. Revised 2026-10-19: an app is an OpenUI Lang program. This is the
target model. The phase files order the work, [research.md](./research.md) holds the evidence, and
[refused.md](./refused.md) records the alternatives.

## The idea

An agent in a task builds a small UI for that task while the owner watches: a triage board over the
linked issues, a checklist for a migration, a chart of error counts, a form that fills in a request.
It shows up inline in the conversation. The owner asks for a change in the next message and gets a new
version. If it proves useful, it opens as a pane in the task. If it proves useful beyond the task, the
owner promotes it to the project, where anyone working on the project can open it from the left rail.
If it grows into a product, an agent rebuilds it as an ordinary plugin.

The agent writes the app in [OpenUI Lang](https://www.openui.com/docs/openui-lang), a short,
line-based language for model-written UI. The program names components from a library Acorn defines
over its own kit, and Acorn's client interprets it. Nothing the agent writes runs as code. The kit
draws the app, so it gets the shell's keyboard handling, focus, accessibility, and style pack. It
draws in the terminal client too, because the terminal build puts its own kit behind the same import.

Lemma does a version of this with raw HTML in iframes. For what Lemma does and what it costs, and for
what OpenUI ships, read [research](./research.md).

## Terms

| Term | Meaning |
| --- | --- |
| _App_ | A UI an agent builds: an OpenUI Lang program, its name and description, and its revisions. |
| _Program_ | The OpenUI Lang text of one version of an app. |
| _Library_ | The OpenUI components, functions, and actions Acorn defines over the kit. A program can use nothing else. |
| _Tools_ | The named queries and mutations the host gives a program. See [what an app can reach](#what-an-app-can-reach). |
| _Card_ | An app drawn inline in an agent transcript. |
| _Task app_ | An app that belongs to one task. It is archived and restored with the task. |
| _Project app_ | An app published to a project. It outlives any task. |
| _Draft_ | A task app that edits a project app. Publishing a draft replaces the project app's current version. |
| _Revision_ | One validated program. Revisions are numbered and immutable. |
| _Head_ | The revision an app runs. |

"App" is the product word. When it could be confused with the desktop app, say "agent-built app".

## An app is a program

An app is data: the text of a program, not a package of code. A task app, a project app, and a draft
are the same files with different ownership and lifecycle. Promotion changes an owner field. Nothing
is converted, and nothing is installed.

Lemma reached the first half of this from the other side. Its code comment calls a conversation widget
and an app "the same primitive", which is why its promotion route takes the source unchanged. Acorn
keeps one format for every stage, and that format holds no code.

On disk, under the Node's data root:

```text
apps/
  <appId>/
    app.json              owner, name, description, head, draft link, source session
    working.oui           the program the tools edit, before it is shown
    revisions/<n>/
      program.oui         the program as validated
      revision.json       the library version it was written against, and the agent's one-line note
    state.json            the app's saved `$` variables, see "App state"
```

Apps aren't plugins, so they never appear in **Settings > Plugins**. They appear on the Apps page.

## OpenUI Lang

A program is one statement per line. Each statement binds a name to a component call, a value, or an
expression, and rendering starts at `root`. Component and tool names here are illustrative:

```openui-lang
$days = "7"
errors = Query("rollbar.occurrences", { days: $days }, { rows: [] })
root = Card([header, filter, chart])
header = Header("Errors by day")
filter = Select("days", [SelectItem("7", "7 days"), SelectItem("30", "30 days")], null, null, $days)
chart = BarChart(errors.rows.day, [Series("Errors", errors.rows.count)])
```

The language has `$` variables for state, expressions, built-in functions such as `@Filter`, `@Sort`,
`@Count`, and `@Each`, queries and mutations against host tools, and actions such as `@Set` and
`@ToAssistant`. The [OpenUI 1.0 specification](https://github.com/thesysdev/openui/tree/main/spec)
defines it, and its conformance cases let any implementation check itself against the spec.

Acorn uses OpenUI's framework-free core, `@openuidev/lang-core`, for parsing, validation, evaluation,
queries, and prompt generation. It doesn't use OpenUI's React packages or its hosted services.

### The library

The library maps OpenUI component names to kit components. Each entry has a Zod schema for its props,
a description that the generated prompt shows the model, and a binding to a kit component. The
library splits in two:

- The spec half, the schemas and descriptions, lives in the host plugin's shared code. The Node uses
  it to generate the prompt and validate programs without loading any UI.
- The binding half lives in the plugin's client and imports the kit through `@acorn/plugin-api/ui`.
  The terminal build resolves that import to its own kit (`apps/tui/vite.config.ts`), so one binding
  draws in both clients.

The library holds only kit components that render in both clients.

Programs pass props by position, so a stored program depends on prop order. The library follows
OpenUI's rules for keeping stored programs working: add a prop only at the end, never reorder or
remove one, and give a new required prop a default. The library has an ID and a version, and every
revision records the version it was written against.

A library can also add pure functions that the model calls like built-ins, and actions that the host
handles. Acorn adds them when phase 0 or later use shows a need, such as grouping rows. A program can
never define one.

### The renderer package

OpenUI has renderers for React, Vue, Svelte, and Angular, and none for Solid. Acorn writes one as its
own workspace package, built to be published:

- It depends on `@openuidev/lang-core`, takes `solid-js` and `zod` as peer dependencies, and imports
  nothing from `@acorn/*`. An architecture rule in `tools/arch` enforces that.
- It holds the renderer, a store that exposes the program's `$` variables as Solid signals, form
  validation, and action dispatch. The host passes in the tools, receives action events, and can
  read and seed the `$` variables.
- It has no renderer target. It builds components with `createComponent` from `solid-js`, or ships
  its JSX uncompiled under the `solid` export condition. The desktop app compiles it for the DOM, and
  the terminal client compiles it with `generate: 'universal'`.
- Its tests run OpenUI's conformance cases at both levels: the program cases through `lang-core`, and
  the interaction cases by mounting programs and replaying clicks and typing.

It stays `private: true` until phase 0 says **Go** and both conformance levels pass. Publishing is a
separate decision after that, made the way [published packages](../../plugins/publishing.md)
describes for the plugin packages: an unscoped name, because no `@acorn` npm organization exists, and
a pinned published surface. Offering it to OpenUI's own repository instead stays open.

## Where apps show up

| Placement | Where | When |
| --- | --- | --- |
| Card | Inline in the agent transcript, as the tool card for `app_show` | Every time an agent shows a revision |
| Task pane | One **Apps** button in the task's right rail, with a list of the task's apps and the selected app beside it | The task has at least one app |
| Project pane | One **Apps** source in the left rail, listing the routed project's apps, each opening a project-scoped pane | The workspace has at least one project app |

Each placement draws the same program. The host sets the reserved variable `$placement` to `card`,
`pane`, or `project`, so a program can draw a compact version in a card and a full version in a pane:
`root = $placement == "card" ? compact : full`.

The task pane follows the workflows pane: one button, gated so a task that never built an app does not
get it ([panes](../../panes.md)). One button per task, not one per app, because the right rail is a
fixed list of what a task always has.

The left rail gets one **Apps** source, not one icon per app. Ten saved apps as ten rail icons would
crowd out everything else, and the rail's descriptor rule keeps generated content out of chrome. The
source lists project apps the way HTTP, Linear, and Rollbar list their rows, and a row opens a pane at
a project route under `/p/:projectId/x/`, the pattern those three plugins use ([panes](../../panes.md)).

### Workspace and project

The left rail is workspace-level, and its sources are gated per workspace. Project apps belong to a
project, because the data sources they read, the tasks they relate to, and the memory agents use are
all project-scoped. The **Apps** source lists the apps of the routed project, and shows an empty state
naming the project when there are none, as other project-scoped sources do.

Some data sources need a task. The database plugin, for one, runs queries inside a task's worktree. A
project app that reads one offers **Open in a task** in its project pane, through the reference
panel's find-or-create-a-task action ([panes](../../panes.md#not-a-pane-the-reference-panel)), instead
of failing.

Workspace-scoped apps are out until someone needs an app that spans projects. See
[refused](./refused.md#workspace-scoped-apps).

## Building and editing

### Tools

The host plugin gives agents seven task-scoped tools:

| Tool | Risk | What it does |
| --- | --- | --- |
| `app_create` | write | Creates a task app with a name, a description, and an empty working program. Returns the app ID. |
| `app_read` | read | Returns the working program, with its hash. |
| `app_write` | write | Replaces the working program. Needs the current hash. |
| `app_patch` | write | Merges statements into the working program by name, as OpenUI's incremental editing does. A statement replaces the one with its name, a new name adds one, and `name = null` deletes one. Needs the current hash. |
| `app_show` | write | Validates the working program, publishes it as the next revision with a one-line note, makes it head, and draws it as a card. |
| `app_list` | read | Lists the task's apps, the project's apps, and any draft links. |
| `app_guide` | read | Returns the authoring guide: the prompt `lang-core` generates from the library and the tools, plus worked examples. |

Programs go through tools rather than the agent's own file access, for four reasons:

- The files stay out of the worktree, so a task's diff never carries an app it did not ask for.
- A headless session in `auto` permission mode may be refused writes outside its working folder.
- The host sees every change, which is what makes revisions and conflict checks possible.
- `app_patch` lets the agent send the three statements that change instead of retyping the program.
  Lemma's widget skill makes this argument at length: a retype is where a working widget picks up a
  new bug. OpenUI's editing model makes the same choice.

`app_guide` follows the rule `plugin_authoring` enforces: never answer a contract question from
memory. `lang-core` builds the prompt from the running host's library and tools, the way
`packages/node-core/src/server/agentTools/pluginAuthoring.ts` derives its answers from the host.

The agent's harness owns its system prompt, so the OpenUI prompt arrives as a tool result, and the
program arrives whole through a tool call. OpenUI's streaming doesn't apply. See
[refused](./refused.md#streaming-programs-in-the-agents-reply).

### Validation before anything is shown

`app_show` never draws a probe. Before it publishes a revision, it checks on the Node, in order:

1. The program is at most 64 KiB.
2. `lang-core` parses and validates it against the library with no errors. Errors such as
   `unknown-component`, `missing-required`, `type-mismatch`, and `no-root` fail it. Warnings go back
   to the agent and don't fail it.
3. Every `Query` and `Mutation` names one of the host's tools with a string literal, so the host can
   read the app's dependencies from the program.
4. The program doesn't declare or set `$placement`.
5. The program evaluates once against each query's defaults with no `runtime-error`.

A failure returns every error, with OpenUI's code and hint, and draws no card. The agent fixes the
program and calls `app_show` again. Lemma validates widget HTML before display for the same reason: a
card that fails in front of the owner costs more trust than a failed tool call the owner never sees.

### Revisions, and a history that does not lie

Each successful `app_show` publishes revision `n + 1` and makes it head. Revisions are immutable.

In Lemma, a widget shown from a file follows the file, so every earlier message that showed it
updates too. Scroll back to the fourth message and it shows the seventh version. Acorn pins instead:

- Each card records the revision it showed.
- Only the newest card for an app is interactive.
- Older cards collapse to one line: "v2: added a status filter. Replaced by v3." The line offers
  **Show v2**, which draws v2 read only, and **Restore v2**, which publishes v2's program as a new
  revision.
- The task pane and project pane always run head.

An old card can draw its own revision because drawing a program runs no code. It draws with current
data, so it shows what v2 does, not the numbers it showed at the time. It stays read only because the
app's state belongs to the head, and two interactive versions of one app on screen would leave the
owner guessing which one acted. See [refused](./refused.md#interactive-old-revisions).

### Remixing from the app

The task pane has an **Edit with agent** drawer beside the app. It draws the conversation of the
session that built the app, composer included, through the `agents.conversation` client capability the
workflows run pane already uses (`plugins/agents/src/contract/conversation.ts`). The owner asks for a
change, the agent edits the program and calls `app_show`, and the pane moves to the new head.

If that session is gone, archived, or belongs to a different task, the drawer offers **Start an editing
session**. It creates a session in the current task with the app attached as context: its name,
description, program, and head revision.

Two sessions can edit one app. `app_write` and `app_patch` need the current hash, so the second writer
gets a conflict and reads the program again.

## What an app can reach

A program reaches the rest of Acorn only through the tools and actions the host gives it, and the host
checks each call:

| What | In a program | Notes |
| --- | --- | --- |
| Data sources | `Query` on a data source's tool | One tool per data source the agent can read, for its rows and a record's details. The shared, Node-owned read contract that dashboards and workflows use ([data sources](../../data-sources.md)). |
| Row actions | `Mutation` on the row-action tool, run by `@Run` | The host draws the risk confirm and refuses non-HTTP action URLs, as it does for dashboards. |
| Task context | `Query` on the task-context tool | Read only, and only for the task the app is drawn in. |
| Compose | `@ToAssistant(text)` | The host puts the text in the composer. The owner sends, edits, or ignores it. An app never sends a message. Lemma's widgets follow the same rule. |
| Links | `@OpenUrl(url)` | The host opens HTTP and HTTPS URLs only, after a confirm that shows the full URL, because a program can build a URL out of the data it reads. |
| App state | `$` variables | See below. |

Phase 1 settles the tool names and argument shapes.

Built-in and library functions run in the client and are pure. A program can't define a function,
reach the network, read a secret, or start a process, because the language has no way to say any of
those.

### Other plugins' capabilities

An app does not get access to every plugin's capabilities.

A node capability (`ctx.capabilities`) is a function one plugin's node half publishes for another
plugin's node half. The owner sees every capability a bundle reaches when they trust it
(`permissions.node.capabilities` in [the manifest](../../plugin-authoring/the-manifest.md)). A tool per
capability would let a prompt-injected agent's app reach whatever the most powerful plugin on the Node
can, with no trust prompt in the way.

Data sources are the answer instead. They are already how one plugin's records reach another's
surfaces without either importing the other. A plugin that wants its data usable in apps registers a
source, and every app can query it. Agents can already find sources with `data_sources_discover` and
`data_source_describe`.

What the app reads is also what the agent could already read through its own data tools, so the tool
set adds no new read path, only a way to draw it.

### Dependencies

The plugins behind the data sources a program queries are the app's dependencies. The host reads them
from the program's `Query` tool names, which validation requires to be string literals.

- If a plugin an app depends on is disabled or missing, the app shows an unavailable state that names
  it, as a dashboard panel does. It never guesses a schema or shows an empty result.
- Turning an app into a plugin writes the same list into `requires.plugins`.

### App state

Some apps need to remember something: which checklist items are done, which rows are dismissed, a
filter the owner chose. A program keeps these in `$` variables. The host saves their values to one
JSON document per app, at most 256 KiB, and seeds them when the app mounts.

State survives revisions by variable name. A variable a revision drops is discarded, and a new one
starts at its declared default. A project app's state is shared by everyone who opens it in that
project. A draft starts with a copy of the project app's state.

## No trust grant

Every plugin bundle runs on a device only after that device accepts its exact hash
([security](../../security.md)). An app isn't a bundle. The device runs Acorn's own interpreter,
renderer, and library, which it already trusts as part of the desktop app or terminal client, over
program text. A program that changes on every `app_show` needs no prompt, because nothing in it runs.

The worst an app can do is draw something misleading, offer text into the composer, or ask the owner
to confirm a row action or a link. That is less than the agent that wrote it can already do.

That argument rests on the interpreter and the tool mapping, so phase 1 needs a security review of
both before it ships. The review starts from two things already found:

- Member access in `lang-core` reads any property of a value, including `constructor`. A program can't
  call what it reads. The review confirms that no host code calls a value it got from a program.
- `lang-core`'s install script sends an anonymous install event to PostHog unless `DO_NOT_TRACK` or
  `OPENUI_TELEMETRY_DISABLED` is set. `pnpm-workspace.yaml`'s `allowBuilds` lists the only
  dependencies whose install scripts run, and `lang-core` isn't one of them. Its runtime telemetry is
  off unless `OPENUI_RUNTIME_TELEMETRY_ENABLED` is set. That variable matters on the Node and in the
  terminal client, which are Node processes, not browsers.

## Lifecycle

### Archive and restore

Archive keeps every plugin's rows and restore brings the task back
([restoring a task](../../workspaces-and-tasks/archive.md#restoring-a-task)). Task apps follow the task:

- The archive confirmation lists the task's apps: "2 apps belong to this task. They are archived with
  it and come back if you restore it." Each has **Publish to project** beside it.
- Archive keeps the task's apps, revisions, and state.
- The archived task preview's Apps pane lists the apps, their revisions, and their programs, read
  only. It doesn't draw them, because an archived task has no worktree and its data may not resolve.
- Restore brings the apps back at the head they had.
- A draft of a project app is a task app. Archiving its task leaves the project app alone.

### Publish and promote

**Publish to project** makes a task app a project app. The first publish is what "promote" means.
Afterwards, the task app becomes a draft linked to the project app, so the owner can keep iterating in
the same task and publish again.

Publishing a draft replaces the project app's head with the draft's head, provided the project app has
not moved since the draft started. If it has, the owner chooses between **Publish as a new app** and
**Replace anyway**. This is a pull request for an app, without the review.

### Forking a project app

Editing needs an agent session, and sessions belong to tasks, so editing a project app needs a task.
**Edit** on a project app offers:

- **Edit in this task**, when a task is open. The draft lands in that task.
- **Edit in a new task**, which creates a task named after the app with the draft in it.

A new task creates its worktree when its first session starts. That is heavy for editing a UI. See
[the open questions](./README.md#open-questions).

### Deleting

Deleting a project app hides it from the rail and moves it to an **Archived apps** list on the Apps
page, where it can be restored or removed for good. A task app is deleted with its task only when the
task is.

## Turn an app into a plugin

A program isn't a plugin, so turning an app into one is a rebuild, not a copy. **Turn into a plugin**
writes the scaffold's package with `requires.plugins` filled from the app's dependencies. It then
starts an agent session that rebuilds the UI as a tree pane, with the program, its revision notes, and
its data sources as the brief. The agent uses `plugin_authoring` and dev mode, as any agent writing a
plugin does.

The owner installs the result through the ordinary trust prompt, and can then add a node half, routes,
settings, or anything else a plugin can do. The app stays until the owner deletes it. See
[phase 4](./04-export.md).

## In the terminal client

The library holds only kit components with a terminal rendering, and the terminal build resolves the
library's kit import to its own kit. Every program that draws on the desktop draws in the terminal.
Cards in the terminal transcript cap their height in rows and offer the same **Open** into the task
pane.

## Cost and performance

A program runs in the client's own process, with no worker. A card's cost is its queries, so a card
runs them only while it's in view, and only the newest card per app is interactive.

`lang-core` and the renderer package load with the first card, through a dynamic import, so they stay
out of startup. The desktop renderer roster has a size limit of 340,000 bytes
(`apps/desktop/scripts/check-renderer-budget.mjs`), and the Node service has its own size ceiling. On
the Node, `lang-core` loads with the first app tool call. Phase 0 measures both.

## Security summary

| Threat | What bounds it |
| --- | --- |
| A prompt-injected agent writes an app that leaks data. | The language has no network access. Data leaves only through row actions and links, and the owner confirms each one with its destination shown. Row actions accept only HTTP URLs. |
| An app acts without the owner. | Row actions and links show the host's confirm. Compose never sends. |
| An app reads more than it should. | Only the host's tools, only the task it is drawn in, and nothing the agent could not already read. |
| A Node serves a hostile program. | A program runs no code. It can arrange library components and call the host's tools, and each device draws it with its own library. |
| A teammate's app runs on my device. | The same bounds, under my own role. See [phase 5](./05-teams.md). |

## Lessons taken from Lemma

- Edit files, not tool arguments. Taken, through `app_write` and `app_patch` on a working program.
- Never show a probe. Taken, as validation in `app_show`.
- Give the agent a design vocabulary and examples. Taken, as the library, the prompt `lang-core`
  generates from it, and the examples in `app_guide`. Lemma's agent pastes a CSS token block and
  adapts six example widgets. Acorn's agent names library components, which is a smaller and safer
  vocabulary.
- Cap the inline height. Taken: cards cap at 480 pixels with **Expand**.
- A widget offers a message and never sends one. Taken, as `@ToAssistant` filling the composer.
- Widgets and apps are one primitive. Taken further: one program from the start.
- A shown widget follows its file. Refused: cards pin revisions.

## Why OpenUI Lang

[Descriptors, trees, rectangles](../../plugins/ui-tiers.md) refuses a static schema for plugins: a
plugin always needs one more field, and a bad programming language grows inside the JSON. OpenUI Lang
is such a language, designed on purpose, with a specification and conformance cases that someone else
maintains. The refusal still holds for plugins. Apps differ in three ways:

- The author is an agent writing small, short-lived UIs. A ceiling on what a program can express is
  what makes every program safe to draw without a prompt.
- An app that hits the ceiling becomes a plugin, through [phase 4](./04-export.md).
- An agent-written JavaScript tree would need a sandboxed worker per card, a headless boot to
  validate, a per-Node trust grant with its own review, and an install per revision. A program needs
  none of these. See [refused](./refused.md#agent-written-javascript-trees).

For why Acorn adopts OpenUI instead of designing a language of its own, see
[refused](./refused.md#a-ui-language-of-our-own).

## Verify before building

- That the renderer package and the library draw in both the desktop app and the terminal client, with
  `@acorn/plugin-api/ui` resolving to each host's kit.
- Whether `lang-core` can generate the prompt and validate from the library's schemas alone, or the
  Node needs a library with placeholder components.
- That a compiled first-party plugin can fill `agents:tool-card` for `app_show`. The point is declared
  in `plugins/agents/src/client/index.ts`.
- How a data source's query options, rows, and details map to OpenUI tool specs with input and output
  schemas.
- How a row action is addressed, so one mutation tool can run any record's action.
- How HTTP, Linear, and Rollbar list project-scoped rows in a left-rail source.
