# Agent-built panels and apps: the design

Status: proposed, 2026-10-01. Revised 2026-10-19: apps are OpenUI Lang programs, every agent-built UI
reads its data through dashboard plans, and agent-made panels come first. This is the target model.
The phase files order the work, [research.md](./research.md) holds the evidence, and
[refused.md](./refused.md) records the alternatives.

## The idea

An agent in a task builds a small UI for that task while the owner watches. Most requests are a view
of data: "graph pull requests over the last month by person." The agent answers those with a
dashboard panel, drawn inline in the conversation. **Add to dashboard** puts it on a Home tab, where it
stays live, because a panel stores where its data comes from and how to shape it, not the data.

Some requests need more than one view: a checklist that remembers what you ticked, a form that fills
in a request, a list of failing pull requests with a button to ask the agent about each. The agent
answers those with an app, a program in [OpenUI Lang](https://www.openui.com/docs/openui-lang) that
lays out kit components and dashboard panels and adds state, forms, and buttons. An app opens as a
pane in the task, can be published to the project and added to a dashboard, and an agent can rebuild
it as an ordinary plugin when it outgrows the language.

Lemma does a version of this with raw HTML in iframes. For what Lemma does and what it costs, what
OpenUI ships, and what dashboards already do, read [research](./research.md).

## One way to fetch, one way to shape, two ways to draw

Every agent-built UI uses the same three layers, and each layer has one owner:

| Layer | What it is | Owner |
| --- | --- | --- |
| Fetch | Data sources: where records come from | The plugins that register them ([data sources](../../data-sources.md)) |
| Shape | Plans: which sources, which columns, which filter, summary, and time steps | The Node, which validates and runs every plan through one route ([dashboards](../../dashboards.md)) |
| Draw | A dashboard view, or an OpenUI program | The client |

A dashboard panel is a plan drawn with one of the dashboard's views: stat, list, table, board, or
chart. An app is a program that draws one or more plans, with kit components around them. Either way,
the records come from the Node's run route, under its cache, shared reads, provenance, and honest
partial and unavailable states. The client never queries a data source itself, which is the rule
[dashboards](../../dashboards.md) already sets for the client.

That's what makes **Add to dashboard** a publish instead of a conversion. The card in the conversation
and the panel on Home are the same plan.

## Terms

| Term | Meaning |
| --- | --- |
| _Plan_ | A version 2 `PanelPlan`: sources, columns, steps, and a view. The one way to say "these records, shaped like this." |
| _Panel card_ | A plan an agent drafted, drawn inline in the conversation with the dashboard's own view. |
| _App_ | A UI an agent builds: an OpenUI Lang program, the plans it reads, its name and description, and its revisions. |
| _Program_ | The OpenUI Lang text of one version of an app. |
| _Library_ | The OpenUI components, functions, and actions Acorn defines. A program can use nothing else. |
| _App card_ | An app drawn inline in an agent transcript. |
| _Task app_ | An app that belongs to one task. It is archived and restored with the task. |
| _Project app_ | An app published to a project. It outlives any task. |
| _Draft_ | A task app that edits a project app. Publishing a draft replaces the project app's current version. |
| _Revision_ | One validated version of an app: its program and plans. Revisions are numbered and immutable. |
| _Head_ | The revision an app runs. |

"App" is the product word. When it could be confused with the desktop app, say "agent-built app".

## Agent-made panels

This is phase 1, and it needs no OpenUI. It shipped as [panels from a conversation](../../dashboards.md).

### Panel tools

| Tool | Risk | What it does |
| --- | --- | --- |
| `panel_guide` | read | Returns the plan instructions the panel studio's AI gets, built from the same text and `PANEL_CAPABILITIES`, plus advice on choosing a view and two worked examples. |
| `panel_show` | write | Takes a title, a panel ID when it revises an earlier card, and a draft plan. Validates the plan on the Node and draws it as a panel card. |

The chat agent and the studio's AI write plans from one set of instructions
(`packages/node-core/src/server/routes/authoring.ts`, built on
`packages/dashboards-core/src/capabilities.ts`) and one validator. A change to what the studio's AI
is told changes the guide too.

`panel_show` returns every validation problem with its path into the plan, and draws no card for a
plan with problems. It never returns records. The agent's data source tools already return schemas
and no records, and the studio's AI sees records only when the owner ticks **Use preview records to
help AI**. A panel card keeps the same line.

### The card

The card runs the plan through the ordinary run route, under the owner's device, and draws it with
the dashboard's own view, including the unavailable and failed states a placed panel has. Above the
view, it shows the plan's plain-language description, which the run returns, such as "Pull requests
opened in the last 30 days in acme/api, counted by author."

Showing a plan with an existing panel ID makes a new version. Older cards collapse to one line, such
as "v1: by day. Replaced by v2.", with **Show**. A plan runs no code, so an old version can draw again
at any time. Every version has its own **Add to dashboard**.

The plan lives in the tool call, so the card needs no storage on the Node.

### Add to dashboard

**Add to dashboard** asks which Home tab, in the task's workspace, and then creates a dashboard draft
from the plan, publishes it, and places it. The owner's click does all three under the owner's
device, which is what every dashboard route requires. An agent never publishes or places anything.
See [refused](./refused.md#agents-that-publish-or-place-panels).

**Edit in studio** opens the panel studio on a new draft of the plan. Changes there don't flow back to
the card.

### Plans that work anywhere

A panel on Home has no task, so a plan must not need one:

- The agent writes the repository, project, and account as values, not as "this task's".
- A window the person stated relatively, such as "last month", is written as a relative date, so the
  panel moves with time.
- "Me" and "mine" use the person filter's **You**, which resolves to whoever looks at the panel.

The card's description shows the result of all three, so the owner sees what the panel will show
before adding it.

## Apps

### An app is a program and its plans

An app is data: a program and the plans it reads, not a package of code. A task app, a project app,
and a draft are the same files with different ownership and lifecycle. Promotion changes an owner
field. Nothing is converted, and nothing is installed.

Lemma reached the first half of this from the other side. Its code comment calls a conversation widget
and an app "the same primitive", which is why its promotion route takes the source unchanged. Acorn
keeps one format for every stage, and that format holds no code.

On disk, under the Node's data root:

```text
apps/
  <appId>/
    app.json                 owner, name, description, head, draft link, source session
    working/
      program.oui            the program the tools edit, before it is shown
      plans/<name>.json      the plans the program reads
    revisions/<n>/
      program.oui
      plans/<name>.json
      revision.json          the library version it was written against, and the agent's one-line note
    state.json               the app's saved `$` variables, see "App state"
```

Apps aren't plugins, so they never appear in **Settings > Plugins**. They appear on the Apps page.

### OpenUI Lang

A program is one statement per line. Each statement binds a name to a component call, a value, or an
expression, and rendering starts at `root`. In this example, `myOpenPulls` and `checksByRepo` are two
of the app's plans, and the component names are illustrative:

```openui-lang
pulls = Query("myOpenPulls", {}, { rows: [] })
root = Stack([chart, list])
chart = Panel("checksByRepo")
list = Stack(@Each(pulls.rows, "p", Card([Header(p.title), Button("Ask why checks fail", @ToAssistant("Why are the checks failing on " + p.url + "?"))])))
```

`Panel` draws a plan exactly as a dashboard panel does. `Query` gives the program a plan's rows, for
its own components to lay out.

The language has `$` variables for state, expressions, built-in functions such as `@Filter`, `@Sort`,
`@Count`, and `@Each`, and actions such as `@Set` and `@ToAssistant`. The
[OpenUI 1.0 specification](https://github.com/thesysdev/openui/tree/main/spec) defines it, and its
conformance cases let any implementation check itself against the spec.

OpenUI's own functions are for display: narrowing rows already fetched as the owner types, or counting
what's on screen. Anything that decides which records to read, or groups and summarizes them, belongs
in a plan.

Acorn uses OpenUI's framework-free core, `@openuidev/lang-core`, for parsing, validation, evaluation,
and prompt generation. It doesn't use OpenUI's React packages or its hosted services.

### The library

The library has three kinds of component:

- Layout and form components, each mapped to a kit component.
- `Panel(plan)`, which draws a plan with the dashboard's own views, with their drill-down, row menus,
  and board moves. The library has no chart or table of its own, so a chart in an app is a dashboard
  chart. See [refused](./refused.md#charts-of-the-librarys-own).
- Host actions and pure functions, added when phase 2 or later use shows
  a need. A program can never define one.

Each component has a Zod schema for its props and a description that the generated prompt shows the
model. The library splits in two:

- The spec half, the schemas and descriptions, lives in the host plugin's shared code. The Node uses
  it to generate the prompt and validate programs without loading any UI.
- The binding half lives in the plugin's client. Layout and form components import the kit through
  `@acorn/plugin-api/ui`, which the terminal build resolves to its own kit
  (`apps/tui/vite.config.ts`), so one binding draws in both clients. `Panel` binds to the dashboard
  views in `packages/client-core/src/features/dashboards/views/`.

Programs pass props by position, so a stored program depends on prop order. The library follows
OpenUI's rules for keeping stored programs working: add a prop only at the end, never reorder or
remove one, and give a new required prop a default. The library has an ID and a version, and every
revision records the version it was written against.

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

It stays `private: true` until phase 2 says **Go** and both conformance levels pass. Publishing is a
separate decision after that, made the way [published packages](../../plugins/publishing.md)
describes for the plugin packages: an unscoped name, because no `@acorn` npm organization exists, and
a pinned published surface. Offering it to OpenUI's own repository instead stays open.

### Where apps show up

| Placement | Where | When |
| --- | --- | --- |
| Card | Inline in the agent transcript, as the tool card for `app_show` | Every time an agent shows a revision |
| Task pane | One **Apps** button in the task's right rail, with a list of the task's apps and the selected app beside it | The task has at least one app |
| Project pane | One **Apps** source in the left rail, listing the routed project's apps, each opening a project-scoped pane | The workspace has at least one project app |
| Dashboard | A cell on a Home tab, beside ordinary panels | The owner added a project app (phase 6) |

Each placement draws the same program. The host sets the reserved variable `$placement` to `card`,
`pane`, `project`, or `dashboard`, so a program can draw a compact version in a card and a full
version in a pane: `root = $placement == "card" ? compact : full`.

The task pane follows the workflows pane: one button, gated so a task that never built an app does not
get it ([panes](../../panes.md)). One button per task, not one per app, because the right rail is a
fixed list of what a task always has.

The left rail gets one **Apps** source, not one icon per app. Ten saved apps as ten rail icons would
crowd out everything else, and the rail's descriptor rule keeps generated content out of chrome. The
source lists project apps the way HTTP, Linear, and Rollbar list their rows, and a row opens a pane at
a project route under `/p/:projectId/x/`, the pattern those three plugins use ([panes](../../panes.md)).

The left rail is workspace-level, and its sources are gated per workspace. Project apps belong to a
project, because the data sources they read, the tasks they relate to, and the memory agents use are
all project-scoped. The **Apps** source lists the apps of the routed project, and shows an empty state
naming the project when there are none, as other project-scoped sources do.

Some data sources need a task. The database plugin, for one, runs queries inside a task's worktree. A
project app whose plans read one offers **Open in a task** in its project pane, through the reference
panel's find-or-create-a-task action ([panes](../../panes.md#not-a-pane-the-reference-panel)), instead
of failing.

Workspace-scoped apps are out until someone needs an app that spans projects. See
[refused](./refused.md#workspace-scoped-apps).

### App tools

The host plugin gives agents seven task-scoped tools:

| Tool | Risk | What it does |
| --- | --- | --- |
| `app_create` | write | Creates a task app with a name, a description, and an empty working program. Returns the app ID. |
| `app_read` | read | Returns one working file, the program or a plan, with its hash. |
| `app_write` | write | Replaces one working file, the program or a plan. Needs the current hash if the file exists. |
| `app_patch` | write | Merges statements into the working program by name, as OpenUI's incremental editing does. A statement replaces the one with its name, a new name adds one, and `name = null` deletes one. Needs the current hash. |
| `app_show` | write | Validates the working program and plans, publishes them as the next revision with a one-line note, makes it head, and draws it as a card. |
| `app_list` | read | Lists the task's apps, the project's apps, and any draft links. |
| `app_guide` | read | Returns the authoring guide: the prompt `lang-core` generates from the library, the plan instructions from `panel_guide`, and worked examples. |

Files go through tools rather than the agent's own file access, for four reasons:

- The files stay out of the worktree, so a task's diff never carries an app it did not ask for.
- A headless session in `auto` permission mode may be refused writes outside its working folder.
- The host sees every change, which is what makes revisions and conflict checks possible.
- `app_patch` lets the agent send the three statements that change instead of retyping the program.
  Lemma's widget skill makes this argument at length: a retype is where a working widget picks up a
  new bug. OpenUI's editing model makes the same choice.

`app_guide` follows the rule `plugin_authoring` enforces: never answer a contract question from
memory. `lang-core` builds the prompt from the running host's library, the way
`packages/node-core/src/server/agentTools/pluginAuthoring.ts` derives its answers from the host.

The agent's harness owns its system prompt, so the OpenUI prompt arrives as a tool result, and the
program arrives whole through a tool call. OpenUI's streaming doesn't apply. See
[refused](./refused.md#streaming-programs-in-the-agents-reply).

### Validation before anything is shown

`app_show` never draws a probe. Before it publishes a revision, it checks on the Node, in order:

1. The program is at most 64 KiB.
2. Every plan passes the same checks `panel_show` runs.
3. `lang-core` parses and validates the program against the library with no errors. Errors such as
   `unknown-component`, `missing-required`, `type-mismatch`, and `no-root` fail it. Warnings go back
   to the agent and don't fail it.
4. Every `Query` and `Panel` names one of the app's plans, or a host tool, with a string literal, and
   every plan is used.
5. The program doesn't declare or set `$placement`.
6. The program isn't one `Panel` and nothing else. That's a panel, and the error points the agent to
   `panel_show`.
7. The program evaluates once against each query's defaults with no `runtime-error`.

A failure returns every error, with its code, path, and hint, and draws no card. The agent fixes the
files and calls `app_show` again. Lemma validates widget HTML before display for the same reason: a
card that fails in front of the owner costs more trust than a failed tool call the owner never sees.

### Revisions, and a history that does not lie

Each successful `app_show` publishes revision `n + 1` and makes it head. Revisions are immutable.

In Lemma, a widget shown from a file follows the file, so every earlier message that showed it
updates too. Scroll back to the fourth message and it shows the seventh version. Acorn pins instead:

- Each card records the revision it showed.
- Only the newest card for an app is interactive.
- Older cards collapse to one line: "v2: added a status filter. Replaced by v3." The line offers
  **Show v2**, which draws v2 read only, and **Restore v2**, which publishes v2's files as a new
  revision.
- The task pane, the project pane, and a dashboard cell always run head.

An old card can draw its own revision because drawing a program runs no code. It draws with current
data, so it shows what v2 does, not the numbers it showed at the time. It stays read only because the
app's state belongs to the head, and two interactive versions of one app on screen would leave the
owner guessing which one acted. See [refused](./refused.md#interactive-old-revisions).

### Remixing from the app

The task pane has an **Edit with agent** drawer beside the app. It draws the conversation of the
session that built the app, composer included, through the `agents.conversation` client capability the
workflows run pane already uses (`plugins/agents/src/contract/conversation.ts`). The owner asks for a
change, the agent edits the files and calls `app_show`, and the pane moves to the new head.

If that session is gone, archived, or belongs to a different task, the drawer offers **Start an editing
session**. It creates a session in the current task with the app attached as context: its name,
description, program, plans, and head revision.

Two sessions can edit one app. `app_write` and `app_patch` need the current hash, so the second writer
gets a conflict and reads the file again.

### What an app can reach

A program reaches the rest of Acorn only through the plans, tools, and actions the host gives it, and
the host checks each call:

| What | In a program | Notes |
| --- | --- | --- |
| The app's plans | `Panel("name")` to draw one, `Query("name", ...)` for its rows | The client runs each plan through the dashboard run route under the viewer's device. Nothing else reads records. |
| Row actions | `Mutation` on the row-action tool, run by `@Run` | The host draws the risk confirm and refuses non-HTTP action URLs, as it does for dashboards. A `Panel` has the dashboard's own row menus too. |
| Task context | `Query` on the task-context tool | Read only, and only for the task the app is drawn in. |
| Compose | `@ToAssistant(text)` | The host puts the text in the composer. The owner sends, edits, or ignores it. An app never sends a message. Lemma's widgets follow the same rule. |
| Links | `@OpenUrl(url)` | The host opens HTTP and HTTPS URLs only, after a confirm that shows the full URL, because a program can build a URL out of the data it reads. |
| App state | `$` variables | See below. |

Phase 3 settles the tool names and argument shapes. Phase 2 finds out whether a program can pass `$`
values into a plan's inputs, such as a date range the owner picks, through the run route.

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
surfaces without either importing the other. A plugin that wants its data usable in panels and apps
registers a source, and every plan can read it. Agents can already find sources with
`data_sources_discover` and `data_source_describe`.

### Dependencies

The plugins behind the data sources an app's plans read are the app's dependencies. The host reads
them from the plans.

- If a plugin an app depends on is disabled or missing, the plan that reads it shows the dashboard's
  unavailable state, which names it. It never guesses a schema or shows an empty result.
- Turning an app into a plugin writes the same list into `requires.plugins`.

### App state

Some apps need to remember something: which checklist items are done, which rows are dismissed, a
filter the owner chose. A program keeps these in `$` variables. The host saves their values to one
JSON document per app, at most 256 KiB, and seeds them when the app mounts.

State survives revisions by variable name. A variable a revision drops is discarded, and a new one
starts at its declared default. A project app's state is shared by everyone who opens it in that
project, in a pane or on a dashboard. A draft starts with a copy of the project app's state.

## No trust grant

Every plugin bundle runs on a device only after that device accepts its exact hash
([security](../../security.md)). Neither a plan nor an app is a bundle. The device runs Acorn's own
interpreter, renderer, library, and dashboard views, which it already trusts as part of the desktop
app or terminal client, over text. A program that changes on every `app_show` needs no prompt, because
nothing in it runs.

The worst an app can do is draw something misleading, offer text into the composer, or ask the owner
to confirm a row action or a link. That is less than the agent that wrote it can already do.

That argument rests on the interpreter and the tool mapping, so phase 3 needs a security review of
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

Panels a person added from a panel card are ordinary dashboard panels. Archiving the task leaves them
alone.

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
page, where it can be restored or removed for good. A dashboard cell for a deleted app shows an
unavailable state that names it. A task app is deleted with its task only when the task is.

## Apps on dashboards

A project app can sit on a Home tab beside ordinary panels. This is
phase 6. The cell runs the app's head with `$placement` set to
`dashboard`, and its plans refresh on the dashboard's rules: when the window regains focus, after a
reported account or plugin change, and at each plan's refresh interval.

Home belongs to a workspace and apps belong to a project, so an app goes only on Home tabs of the
workspace that holds its project, and its cell names the project. A task app's card offers **Publish
and add to dashboard**, which publishes it to the project first.

The shared codec in `packages/dashboards-core/src/definition.ts` drops a definition with no
publication. An older client that saved the dashboards preference would then delete every app cell,
so phase 6 first teaches the codec to keep definitions it doesn't recognize, and ships app cells a
release later.

## Turn an app into a plugin

A program isn't a plugin, so turning an app into one is a rebuild, not a copy. **Turn into a plugin**
writes the scaffold's package with `requires.plugins` filled from the app's dependencies. It then
starts an agent session that rebuilds the UI as a tree pane, with the program, its plans, its revision
notes, and its data sources as the brief. The plans can become published panels in a dashboard region
the plugin reserves ([placements](../../dashboards/placements.md#plugin-regions)). The agent uses
`plugin_authoring` and dev mode, as any agent writing a plugin does.

The owner installs the result through the ordinary trust prompt, and can then add a node half, routes,
settings, or anything else a plugin can do. The app stays until the owner deletes it. See
phase 7.

## In the terminal client

The terminal client draws no dashboard panels (`apps/tui/src/plugins/SourcePanel.tsx`). So in the
terminal:

- A panel card is one line with the plan's description, saying the panel draws in the desktop app.
- An app's layout and form components draw, because the terminal build resolves the library's kit
  import to its own kit. A `Panel` inside an app draws as the same one line.
- Cards cap their height in rows and offer the same **Open** into the task pane.

A terminal view for dashboard panels would close the gap for panels and apps together. It's its own
piece of work. See [the open questions](./README.md#open-questions).

## Cost and performance

Plans run on the Node through the dashboard run route, so panel cards, app cards, and dashboard cells
share its cache and its shared reads. A card runs its plans only while it's in view, and only the
newest card per app is interactive. A program runs in the client's own process, with no worker.

`lang-core` and the renderer package load with the first app card, through a dynamic import, so they
stay out of startup. The desktop renderer roster has a size limit of 340,000 bytes
(`apps/desktop/scripts/check-renderer-budget.mjs`), and the Node service has its own size ceiling. On
the Node, `lang-core` loads with the first app tool call. Phase 2 measures both.

## Security summary

| Threat | What bounds it |
| --- | --- |
| A prompt-injected agent writes a panel or app that leaks data. | Neither has network access. Data leaves only through row actions and links, and the owner confirms each one with its destination shown. Row actions accept only HTTP URLs. |
| An agent puts something on a dashboard. | Only the owner's click publishes or places, and every dashboard route needs a device principal. |
| An app acts without the owner. | Row actions and links show the host's confirm. Compose never sends. |
| A panel or app reads more than it should. | Plans read only through the Node's run route, under the viewer's own authority, and agents see no records. |
| A Node serves a hostile program. | A program runs no code. It can arrange library components and run its own plans, and each device draws it with its own library. |
| A teammate's app runs on my device. | The same bounds, under my own role. See [phase 8](./08-teams.md). |

## Lessons taken from Lemma

- Edit files, not tool arguments. Taken, through `app_write` and `app_patch` on a working copy.
- Never show a probe. Taken, as validation in `panel_show` and `app_show`.
- Give the agent a design vocabulary and examples. Taken, as the plan instructions the studio's AI
  already uses, the library, and the prompt `lang-core` generates from it. Lemma's agent pastes a CSS
  token block and adapts six example widgets. Acorn's agent names plans and library components, which
  is a smaller and safer vocabulary.
- Cap the inline height. Taken: cards cap at 480 pixels with **Expand**.
- A widget offers a message and never sends one. Taken, as `@ToAssistant` filling the composer.
- Widgets and apps are one primitive. Taken further: a panel card is a dashboard panel, and an app is
  one format from task to dashboard.
- A shown widget follows its file. Refused: cards pin versions.

## Why plans, and why OpenUI Lang

**Why plans.** Dashboards already validate, run, cache, and draw plans, with grouping, time buckets,
joins between sources, provenance, and honest partial results. A second way to shape data inside apps
would be weaker and would drift. With one, "make this a dashboard panel" is a publish, and the studio
can edit what the agent made. See [refused](./refused.md#programs-that-query-data-sources-directly).

**Why OpenUI Lang.** [Descriptors, trees, rectangles](../../plugins/ui-tiers.md) refuses a static
schema for plugins: a plugin always needs one more field, and a bad programming language grows inside
the JSON. OpenUI Lang is such a language, designed on purpose, with a specification and conformance
cases that someone else maintains. The refusal still holds for plugins. Apps differ in three ways:

- The author is an agent writing small, short-lived UIs. A ceiling on what a program can express is
  what makes every program safe to draw without a prompt.
- An app that hits the ceiling becomes a plugin, through phase 7.
- An agent-written JavaScript tree would need a sandboxed worker per card, a headless boot to
  validate, a per-Node trust grant with its own review, and an install per revision. A program needs
  none of these. See [refused](./refused.md#agent-written-javascript-trees).

For why Acorn adopts OpenUI instead of designing a language of its own, see
[refused](./refused.md#a-ui-language-of-our-own).

## Verify before building

- Which plan checks can run on the Node for a task's agent. Every dashboard route needs a device
  principal (`packages/node-core/src/server/routes/dashboards.ts`), while the data source agent tools
  describe sources for task principals.
- That no source parameter or query binding resolves from the current task. If one does,
  **Add to dashboard** turns it into a value first.
- How a core feature fills `agents:tool-card`, declared in `plugins/agents/src/client/index.ts`, or
  whether the agents plugin draws panel cards itself with the dashboard views.
- Whether a draft plan can take inputs from a program through the run route.
- That the renderer package and the library draw in both the desktop app and the terminal client, with
  `@acorn/plugin-api/ui` resolving to each host's kit.
- Whether `lang-core` can generate the prompt and validate from the library's schemas alone, or the
  Node needs a library with placeholder components.
- How a row action is addressed, so one mutation tool can run any record's action.
- How HTTP, Linear, and Rollbar list project-scoped rows in a left-rail source.
