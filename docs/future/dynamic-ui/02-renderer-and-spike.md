# Phase 2: the renderer and the spike

Status: built, 2026-10-19. Verdict: **Go with changes**. Depends on [phase 1](./01-agent-panels.md).
The spike's harness and library were throwaway and aren't in the repository. The renderer package is
kept, private. This phase's output is the measurement in [Results](#results).

## Completion note, October 19, 2026

**What landed.** `packages/openui-solid` (`@acorn/openui-solid`, private) binds
`@openuidev/lang-core` 1.0.0 to Solid. `createOpenUIRuntime` parses a program, keeps its `$`
variables in lang-core's store behind Solid signals, runs its queries and mutations through the tools
the host passes in, and dispatches actions to `onAction`. The host reads a variable with
`runtime.state(name)`, seeds variables with `initialState`, and saves them from `runtime.snapshot()`.
`Renderer` draws the runtime's tree. A component that throws draws nothing and is listed in
`runtime.errors()` as `render-error`, and the rest still draws. Components reach the runtime with
`useOpenUI`, `FormScope`, `useFormName`, `createStateField`, and `reactive`. `createFormValidation`
checks a form's fields against the spec's validation rules. The package has no JSX and no renderer
target, so each host compiles it unchanged. The conformance cases are copied with OpenUI's license into
`packages/openui-solid/conformance/1.0`. The program runner and the interaction runner follow OpenUI's
reference runners, and all 58 program cases, the one validation case, and all 12 interaction cases
pass. The package's own tests check that a bound input keeps its element, and its focus, while the
tree it feeds changes, that a program edit keeps what the user set, and that a failed component is
listed. `tools/arch/boundaries.test.ts` refuses any import from
`@acorn/*` or outside lang-core, Solid, and Zod, and
[package boundaries](../../architecture/packages.md#a-renderer-built-to-publish) states the rule.

**Decisions and deviations.**

- lang-core is pinned at 1.0.0, not 1.0.1. Its source is identical to 1.0.1, which only adds the
  conformance runner and a README, and 1.0.1 isn't old enough for the repository's seven-day release
  age until October 22. Take 1.0.1 or later as an ordinary upgrade.
- lang-core's install script only sends an install event to OpenUI's analytics. `pnpm-workspace.yaml`
  denies it in `allowBuilds`. Runtime telemetry stays off unless `OPENUI_RUNTIME_TELEMETRY_ENABLED` is
  set.
- The evaluated tree is reconciled into a Solid store by position, which is how React keys its
  children. The store gets a copy, because `reconcile` edits the objects it adopts and an evaluated
  tree shares objects with the parser's cache.
- Programs reach Acorn whole, so the runtime parses with `createParser`, not the streaming parser.
  The program runner still checks the streaming cases both ways, as OpenUI's runner does.
- Spike apps ran in a pane of the dev build, not as transcript cards, because cards are phase 3's.
  The managed sessions read the guide from a file and wrote apps into the task's folder, standing in
  for `app_guide` and the app file tools.

**Verify-before-building answers.** The package's runner reads cases as OpenUI's two reference
runners do. Comparison rules, summaries, and the test library's reactive props are copied from them.
`pnpm dev:agent` works as local development describes, with one trap: `--vite` still serves the
staged renderer, so a renderer edit needs `--reuse` and a restart, about 35 seconds.

**For phase 3.** The verdict's list in [Results](#what-phase-3-must-add-first) is the first slice.
Beyond it:

- A bound prop must be marked with `reactive()`. Without the mark, the field writes form state instead
  of the `$` variable, and nothing reports it.
- A binding's top-level `cond ? a : b` runs once in Solid. Use `Show` or JSX for anything that depends
  on props. The spike's `List` and `Stack` bindings drew stale branches until they did.
- The app pane must declare a layout, `single` at least. A bare component pane gets no focus region in
  the terminal client, and keys can't enter it.
- The terminal client leaves bare imports to Node at run time. Bundle `@openuidev/` there the way
  `apps/tui/vite.config.ts` bundles Zod.
- The lang-core chunk on the Node is about 85 KB minified. The service budget had 290 bytes of headroom
  on this branch, so the chunk must load on the first app tool call, never at boot.
- An agent in a task session can edit plugin source to make a plan validate. One did, in prompt 7, to
  make a model field chartable. The app tools keep apps out of the worktree, but nothing stops that
  session from changing the repository.

## Goal

Answer the question the app half of the programme depends on: for requests a panel can't serve, can an
agent write a useful OpenUI program in one or two tries? Build the Solid renderer first, because the
spike needs it to draw anything, and answer four plumbing questions along the way.

## The renderer package

Build the package [the design](./design.md#the-renderer-package) describes, as a workspace package with
`private: true`:

1. It binds `@openuidev/lang-core` to Solid: the renderer, a store that exposes `$` variables as
   signals, form validation, and action dispatch. The host passes in tools, receives action events,
   and can read and seed the `$` variables.
2. It imports nothing from `@acorn/*`. Add the architecture rule that enforces it.
3. It has no renderer target, so the desktop app and the terminal client each compile it for their
   own renderer.
4. Its tests run OpenUI's conformance cases at both levels, copied from OpenUI's `spec/fixtures/1.0`
   folder with its license: 58 program cases and 12 interaction cases at commit `8d9c4c3`.

**Checkpoint.** Every conformance case passes in the package's own test run.

## The spike

Use what ships, phase 1's panel tools, and the renderer package, with a managed Claude session in a
`pnpm dev:agent` window.

1. Define a spike library: the kit components that suit apps, as OpenUI components with Zod schemas
   and descriptions, bound through `@acorn/plugin-api/ui`, plus `Panel` bound to the dashboard views.
2. Give it tools: each app plan as a query tool that runs through the dashboard run route, and
   handlers for `@ToAssistant` and a row-action mutation.
3. Write a guide: the prompt `generateSystemPrompt` builds from the library, the plan instructions
   from `panel_guide`, and four worked examples. Take the example shapes from Lemma's widgets: a table
   you can narrow, one record and its history, a measure beside the records behind it, and a
   checklist that keeps state.
4. Build a throwaway harness: a pane in the dev build that draws a program and its plans from a folder
   and lists their errors, and a script that prints the same errors for the agent.
5. Pick ten prompts from real tasks that a single panel can't serve, for example:
   - "Show the open review comments on this PR grouped by file, with a button to jump to each."
   - "A checklist for this migration's steps that remembers what I ticked."
   - "My open pull requests with failing checks, each with a button that asks you why."
   - "A form that fills in the fields of a Linear issue and puts the text in the composer."
6. For each prompt, the agent writes a program and its plans following the guide. Count the tries
   until the owner calls the result useful, up to three.
7. Record for each attempt: tries, errors by code, the components, props, and functions it wanted and
   could not find, and whether a panel from phase 1 would have done the job after all.

## The four plumbing questions

Answer each with a small proof, not a design:

1. **One renderer, two clients.** Draw the spike's programs in the desktop app and in the terminal
   client, with `@acorn/plugin-api/ui` resolving to each host's kit. Do focus and keyboard work in
   both? Does `Panel` fall back to its one line in the terminal?
2. **Inputs from a program into a plan.** Can a `$` variable, such as a date range the owner picks,
   change what a plan reads through the run route, without the program rewriting the plan?
3. **The Node side.** Parse, validate, evaluate against query defaults, and generate the prompt on the
   Node, without loading any UI. Can `lang-core` build the library's spec from the schemas alone? What
   does it add to the Node service when loaded on the first app tool call?
4. **Client cost.** Measure the size of `lang-core` and the renderer when loaded with the first card,
   against the renderer roster limit in `apps/desktop/scripts/check-renderer-budget.mjs`. Open a
   transcript with ten app cards and record memory and run-route load, on desktop and in the terminal
   client.

## Exit criteria

- **Go** if every conformance case passes, at least seven of ten prompts reach a useful result within
  two tries, and the plumbing questions have answers that do not need a new host primitive.
- **Go with changes** if the misses cluster on a few missing components, functions, or plan inputs.
  List them. Adding them is the first slice of phase 3.
- **Stop** if fewer than five of ten succeed, or most successes could have been a panel from phase 1.
  Then the programme ends at phase 1, and `panel_guide` stays the agent's answer to "show me". See
  [refused](./refused.md#panels-only-with-no-apps). On a stop, delete the renderer package unless
  someone wants to publish it alone.

## Results

Run on October 19, 2026. An agent ran the spike and made every call below, including whether each
result was useful. Nobody else has checked them. The programs and plans are in
[the appendix](#appendix-the-spikes-programs-and-plans), so the owner can check each call.

### How it ran

- **The writer.** A managed Claude Code session (Claude Code 2.1.303, Opus 5.5, high effort, auto
  mode) in a `pnpm dev:agent` window, on a task that works in the project folder. Each prompt got a
  fresh session. The message was the prompt plus one line that pointed at the guide and said to write
  under `spike/<name>/` and run the check.
- **The library.** Eighteen components: `Stack`, `Card`, `Heading`, `Text`, `Badge`, `Link`, `Alert`,
  `Empty`, `Button`, `Checkbox`, `Input`, `Textarea`, `Select`, `SelectItem`, `Form`, `ListItem`,
  `List`, and `Panel`. Each has a Zod schema and a description, and the client binds it through
  `@acorn/plugin-api/ui`. `Panel` draws a plan through the phase 1 panel card. There is one custom
  action, `@Compose(text)`. Each plan is a query tool, and `rowAction` is the one mutation tool.
- **The guide.** About 44 KB: lang-core's `generateSystemPrompt` output for the library, the output of
  `panelGuide`, and four worked examples. The examples are a task list you narrow by status and
  search, one task with its agent turns, this month's cost beside the turns behind it, and a release
  checklist that keeps its ticks.
- **The check.** A script that ran the checks `app_show` will run, rules 1 to 7 in the design, and
  logged every run. Plans were checked against each source's live description.
- **The harness.** A pane in the agents plugin read `spike/` from the task's folder through the
  editor's routes, drew the selected app, listed its errors, and saved its `$` variables.
- **The data.** The dev Node has core tasks, sessions, usage, branches, and worktrees, plus two
  worktree tasks I made with uncommitted files. It has no GitHub or Linear account.

### Per prompt

"Tries" counts results shown to the owner. An agent's own runs of the check before it said "ready"
don't count, because `app_show` will refuse those runs without drawing anything.

| # | Prompt | Tries | Useful | Check errors by code | Wanted and not found | A phase 1 panel instead? |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | A checklist for the steps in the phase 3 doc that remembers what I ticked | 1 | Yes | None | Nothing | No. It needs state. |
| 2 | A form that fills in a Linear issue's fields and puts the text in the composer | 1 | Yes | None | Team and labels as Linear's own choices, which need an account | No. It's a form. |
| 3 | My open pull requests with failing checks, each with a button that asks you why | 1 | No | Source unreadable, once, from a placeholder account | An account ID for the plan | The list, yes. Not the ask button. |
| 4 | The open review comments on a pull request, grouped by file, with a button to jump to each | 2 | No | None | A review comments source, and grouping live rows | No. No source has the data. |
| 5 | Tasks with uncommitted changes, grouped by project, each with a button that asks you to commit or stash | 1 | Yes | None | Grouping live rows, worked around with a second plan | The grouped list, yes. Not the buttons. |
| 6 | My agent sessions: the ones waiting on me first with a pick-up button, the rest with how long since they did anything | 1 | Yes | None | Nothing | One list, yes. Not two sections with buttons. |
| 7 | This month's AI spend by model as a chart, beside the five costliest tasks, each with an ask-why button | 2 | No | Column type mismatch once, chart axis once | A bar chart over a text field | The chart alone, if it could be drawn. |
| 8 | A standup note builder: tick the tasks I worked on, add blockers, put the note in the composer | 1 | Yes | None | A `$` variable that holds a set of ticked row IDs | No. It's a form. |
| 9 | Compare two of my tasks side by side: branch, uncommitted files, and agent cost | 1 | Yes | None | Nothing. My `Stack` binding drew the cards stacked, not side by side | No. It needs inputs. |
| 10 | A release readiness page: branches with work, dirty worktrees, and a checklist that remembers | 1 | Yes | None | Nothing | No. It needs state. |

Seven of ten were useful on the first try. The check logged 14 runs, including one for prompt 2 in a
session I discarded and one on a throwaway copy in prompt 4. Eleven passed. All three failures were
in plans: an unreadable source in prompt 3, then a column type and a chart axis in prompt 7. No run
failed on the language itself. There were no parse errors, unknown components, missing props, or
runtime errors.

How I judged each one:

1. A card per step in the phase 3 doc, with each checkpoint's test as its hint, and a count. I ticked
   two, restarted the app, and both stayed ticked.
2. I filled the form and pressed **Put in composer**, and the composer held the issue text. Team and
   labels are free text. That's weaker than Linear's own choices, but it does what was asked.
3. The program is sound, but its plan can't run. No agent tool lists accounts, so the plan names
   `GITHUB_ACCOUNT_ID`, and the source refuses it. The agent said so and asked for the ID. The dev Node
   has no GitHub account, so the third try couldn't happen.
4. No source carries review comments. On the first try I named a pull request that doesn't exist,
   which was my mistake. On the second, the agent wrote a snapshot from the `gh` command-line tool,
   and the pull request I named had no comments. A snapshot goes stale, so the person would ask again.
5. Two tasks under their project, each with a **Commit or stash** button that passes the task's ID,
   branch, and worktree path.
6. Two sections, with the idle time worked out in the plan. Nothing was waiting during the run, so
   the top section showed its empty state.
7. On the first try, spend by model came back as a table, because the usage source describes `model`
   as text and a bar chart needs an enum or person axis. I asked for the chart. The agent changed the
   usage source and the plan validator, which I reverted, and it said the app needs a restart. The
   person asked for a chart twice and didn't get one.
8. It works. I ticked two tasks, added a blocker, and the note reached the composer. It's capped at
   eight fixed slots, and a tick belongs to a position, not a task. The agent said both. That's
   usable for a daily note, if not for long.
9. Picking a task in each dropdown fills that card, and each card's cost panel reads the picked task
   through a plan input.
10. Three sections. The release steps are the agent's guesses, which it said and offered to replace.

None of the seven successes could have been a phase 1 panel. Each needs state, a form, per-row
buttons that ask the agent, inputs, or several views on one screen. Three of the misses can't run
for a reason outside the language: a missing account, a missing source, and a missing chart axis.

### The four plumbing questions

1. **One renderer, two clients.** Yes, with no change to the renderer. The ten bundled apps drew in
   the desktop app and in the terminal client from the same program and the same bindings, with
   `@acorn/plugin-api/ui` resolving to each host's kit. In the terminal, the keys entered the pane, the
   select opened and picked an app from the keyboard, and Space ticked a checkbox, which updated the
   count. `Panel` drew as its one line: "AI spend by model, this month: One row per Model…". Three
   things need fixing in phase 3. Bundle lang-core into the terminal client, which leaves bare imports
   to Node. Declare the app pane with a layout. Fix the terminal kit's `Checkbox`, which draws its hint
   over its label.
2. **Inputs from a program into a plan.** Yes. A plan writes
   `{ "address": { "from": "input", "name": "taskId", "pointer": "" } }` where a literal would go.
   `Query("plan", {taskId: $picked}, …)` and `Panel("plan", {taskId: $picked})` pass the value, and the
   plan text never changes. Prompt 9 drew each task's cost from its dropdown that way. The `input`
   address already exists in the protocol's data bindings. The dashboard run route doesn't resolve it,
   though. `resolvePlanContexts` resolves only `context` addresses, so the spike swapped inputs for
   literals on the client before calling the run route. Phase 3 should send the inputs with the run
   and resolve them on the Node, beside `context`.
3. **The Node side.** Yes. The check and the guide ran in plain Node with no UI. `createLibrary` builds
   the spec from Zod schemas with `component: null`, and the check parsed, validated, and evaluated
   against query defaults. lang-core bundles to about 85 KB minified on the Node (29 KB compressed).
   Loading it took about 23 ms, and a first parse plus prompt build about 5 ms. The service budget had
   290 bytes of headroom, so the chunk has to load on the first app tool call.
4. **Client cost.** lang-core and the renderer bundle to about 64 KB minified (22 KB compressed), and
   the renderer is 6.4 KB of that. Loaded with the first card, the chunk sits outside the renderer's
   startup and roster lists, so the 340,000-byte roster limit doesn't change. No transcript with ten
   app cards exists before phase 3, so I mounted all ten apps in one pane instead. On the desktop, the
   web content process grew 1.8 MB, from 209.6 MB to 211.4 MB, going from one app to ten. In the
   terminal, garbage collection swamped any difference: 225 MB on the Agent pane just after start, and
   176 MB minutes after mounting the ten. Mounting made one run-route call per query, 10 in all. Most
   took 250 to 500 ms. The local-branches plan took 9.4 seconds warm and 30 seconds cold, because that
   source does git work. `Panel` runs go through the panel card's own route and aren't in that count.
   No app refetched on its own. A query runs again only when a `$` variable in its arguments changes,
   or on `@Run`.

### Verdict: Go with changes

Every conformance case passes, seven of ten prompts were useful on the first try, and no success
could have been a panel. That meets **Go** on the numbers. It's **Go with changes** because every
miss, and two of the workarounds, land on one short list, and phase 3 needs that list before its
cards are worth showing.

#### What phase 3 must add first

1. **An account for a plan.** Give agents the account IDs a source can use: `data_sources_list`
   returns, for each source that needs one, the person's connection IDs and labels. The panel guide
   already tells agents to take the ID from there, but no tool returns one. This blocks every GitHub
   and Linear plan, for panels as well as apps. It caused prompt 3's miss and prompt 2's free-text
   team field.
2. **Plan inputs on the run route.** The dashboard run takes an `inputs` object and resolves
   `{ from: "input", name, pointer }` addresses from it, beside `context`. Validation checks that every
   input a plan reads is passed. Without it, every app that narrows a plan by a `$` variable depends
   on client-side substitution.
3. **A set of row IDs as state.** Two library functions over a `$` variable that holds a list:
   `@Includes(list, value)` and an action `@Toggle($list, value)`. A row's `Checkbox` then binds to
   whether its ID is in the set. Prompt 8 used eight fixed slots without them. This needs a library
   function, a library action, and a store that accepts arrays, not a language change.
4. **Grouping live rows.** Either `@GroupBy(rows, field)`, returning `[{ key, rows }]`, or a query tool
   result that carries the run's existing `groups`. Prompts 4 and 5 needed it, and prompt 5 worked
   around it with a second plan.
5. **A bar chart over a text field.** The chart view accepts a text column as its axis when the plan
   summarizes by it, so the axis has a bounded set of categories. Prompt 7 missed on this, and panels
   share the limit.
6. **A compose hook for hosts.** A client call that puts text in the task's composer. The spike used
   `sendReferenceToAgent`, which adds a leading `@`. `@ToAssistant` and `@Compose` both need the plain
   version.
7. **`Card` in a row.** `Stack(…, "row")` must draw its cards at their own width, through the kit
   card's `fit`. Prompt 9's side-by-side cards drew stacked.

A review comments source, which prompt 4 needed, is GitHub plugin work, not part of this list.

## Appendix: the spike's programs and plans

Plans are shortened. Each shows its sources (plugin and source ID, with any scope beyond the
workspace), its columns with their types, its stages, its sort, and its view. Prompt 4's program is
the second try's snapshot. Prompt 7's plan `spendByModel` is as the agent left it on the second try:
a bar chart over `model` typed as enum. It fails the check against the unchanged usage source. The
first try's passing version typed `model` as text and drew a table.

### Prompt 1: inline-cards-checklist

```openui-lang
root = Stack([Heading("Phase 3: apps as inline cards"), step1, step2, step3, step4, step5, progress, finish], "column", "stack")
$c1 = false
$c2 = false
$c3 = false
$c4 = false
$c5 = false
$c6 = false
done = @Count(@Filter([$c1, $c2, $c3, $c4, $c5, $c6], "", "==", true))
step1 = Card("1. Host plugin, storage, and tools", [Checkbox("c1", "Checkpoint 1: create, write, and show an app by hand through MCP", $c1, "A heading above a Panel draws as a card. Files sit under the data root, none in the worktree.")])
step2 = Card("2. Validation", [Checkbox("c2", "Checkpoint 2: five bad programs each fail with a code and hint", $c2, "Unknown component, missing prop, unknown plan, sets $placement, single Panel (points to panel_show). No card appears.")])
step3 = Card("3. Revisions", [Checkbox("c3", "Checkpoint 3: three revisions, only the third is interactive", $c3, "Show v1 draws read only. Restore v1 makes v4 with v1's files.")])
step4 = Card("4. What a program can reach", [Checkbox("c4", "Checkpoint 4: actions stay inside their limits", $c4, "@ToAssistant fills the composer only. A row action confirms. file: URLs are refused; HTTPS shows the full URL first.")])
step5 = Card("5. An agent builds one", [Checkbox("c5", "Checkpoint 5: a managed Claude chat builds, revises, and defers to panel_show", $c5, "Review comments by file, then a change collapses v1. A single chart goes to panel_show."), Checkbox("c6", "Checkpoint 6: the same flow in the terminal client", $c6, "Run it in the isolated PTY driver.")])
progress = Text(done + " of 6 checkpoints done", "muted")
finish = done == 6 ? Button("Tell the agent phase 3 is checked", @ToAssistant("Every phase 3 checkpoint is ticked."), "solid") : null
```

### Prompt 2: linear-issue-form

```openui-lang
root = Card("New Linear issue", [form, preview, actions])
$title = ""
$team = ""
$priority = "3"
$labels = ""
$description = ""
form = Form("issue", [title, team, priority, labels, description])
title = Input("title", "Title", $title, "What needs doing?")
team = Input("team", "Team", $team, "Team name or key, e.g. ENG")
priority = Select("priority", "Priority", [SelectItem("1", "Urgent"), SelectItem("2", "High"), SelectItem("3", "Medium"), SelectItem("4", "Low"), SelectItem("0", "No priority")], $priority)
labels = Input("labels", "Labels", $labels, "Comma separated, e.g. bug, frontend")
description = Textarea("description", "Description", $description, 6)
priorityName = $priority == "1" ? "Urgent" : $priority == "2" ? "High" : $priority == "3" ? "Medium" : $priority == "4" ? "Low" : "No priority"
text = "Create a Linear issue.\nTitle: " + $title + "\nTeam: " + $team + "\nPriority: " + priorityName + "\nLabels: " + $labels + "\nDescription:\n" + $description
ready = $title != "" && $team != ""
preview = ready ? Text(text, "mono") : Alert("Add a title and a team to fill the composer.", "muted")
actions = Stack([compose, clear], "row", "row")
compose = ready ? Button("Put in composer", @Compose(text), "solid") : null
clear = Button("Clear", @Reset($title, $team, $priority, $labels, $description), "ghost")
```

### Prompt 3: failing-prs

```openui-lang
root = Stack([header, list], "column", "stack")
prs = Query("failingPulls", {}, {rows: []})
header = Stack([Heading("My pull requests with failing checks"), Badge(@Count(prs.rows) + " failing", "danger"), Button("Refresh", @Run(prs), "ghost")], "row", "row")
list = List(@Each(prs.rows, "p", ListItem(p.title, p.repository + " #" + p.number, [Badge("Checks failed", "danger")], [Button("Why?", @ToAssistant("Why are the checks failing on " + p.repository + " #" + p.number + "? Find the failing jobs, read their logs, and tell me the cause.", {url: p.url, repository: p.repository, number: p.number, checks: p.checkStatuses}), "solid"), Button("Open", @OpenUrl(p.url), "ghost")])), "None of your open pull requests have failing checks.")
```

Plan `failingPulls`: {"title": "My open pull requests with failing checks", "sources": ["github/pull-requests {\"connectionId\":\"GITHUB_ACCOUNT_ID\"}"], "columns": ["title:text", "repository:text", "number:number", "checks:enum", "checkStatuses:text (hidden)", "state:enum (hidden)", "author:person (hidden)", "updatedAt:datetime", "url:link"], "stages": ["filter /state eq \"open\"", "filter /author eq context.viewer/login", "filter /checks eq \"FAILURE\""], "sort": ["updatedAt desc"], "view": {"kind": "list"}}

### Prompt 4: pr-review-comments

```openui-lang
root = Stack([header, summary, body], "column", "section")
header = Stack([Heading("Open review comments on #38"), Badge("Merged", "accent"), Button("Open on GitHub", @OpenUrl(pr.url), "ghost")], "row", "row")
summary = Text(pr.title, "muted")
body = @Count(files) == 0 ? Card(null, [Empty("No open review comments. The only review is " + pr.approvedBy + "'s approval."), refresh]) : Stack([@Each(files, "f", Card(f.path, [List(@Each(f.comments, "c", ListItem(c.author + " · line " + c.line, c.body, [], [Button("Jump to it", @OpenUrl(c.url), "solid")])))])), refresh], "column", "stack")
refresh = Button("Rebuild from GitHub", @ToAssistant("Rebuild the review comments app for jamesmacfie/acorn pull request 38 from GitHub."), "ghost")
pr = {title: "fix(shell): only name the routed project in the breadcrumb under a project-scoped source", url: "https://github.com/jamesmacfie/acorn/pull/38", approvedBy: "jamesmacfie"}
files = []
```

### Prompt 5: dirty-tasks

```openui-lang
root = Stack([header, groups], "column", "stack")
tasks = Query("dirtyTasks", {}, {rows: []})
projects = Query("dirtyProjects", {}, {rows: []})
header = Stack([Heading("Tasks with uncommitted changes"), Badge(@Count(tasks.rows) + " tasks", "warn"), Button("Refresh", Action([@Run(tasks), @Run(projects)]), "ghost")], "row", "row")
groups = @Count(projects.rows) == 0 ? Empty("No task has uncommitted changes.") : Stack(@Each(projects.rows, "p", Card(p.project, [List(@Each(@Filter(tasks.rows, "project", "==", p.project), "t", ListItem(t.title, t.branch + " · " + t.modifiedCount + " modified, " + t.untrackedCount + " untracked", [], [Button("Commit or stash", @ToAssistant("The task " + t.title + " has uncommitted changes on " + t.branch + ". Look at them, then commit or stash them, and ask me which if it isn't clear.", {taskId: t.taskId, project: t.project, branch: t.branch, worktreePath: t.worktreePath}), "solid")])))])), "column", "stack")
```

Plan `dirtyProjects`: {"title": "Projects with uncommitted changes", "sources": ["core/tasks"], "columns": ["project:text", "worktreeChanged:boolean (hidden)"], "stages": ["filter /worktreeChanged eq true", "summarize by project measure count=count()"], "sort": ["project asc"], "view": {"kind": "table"}}

Plan `dirtyTasks`: {"title": "Tasks with uncommitted changes", "sources": ["core/tasks"], "columns": ["title:text", "project:text", "branch:text", "modifiedCount:number", "untrackedCount:number", "worktreePath:text", "updatedAt:datetime", "worktreeChanged:boolean (hidden)"], "stages": ["filter /worktreeChanged eq true"], "sort": ["updatedAt desc"], "view": {"kind": "list"}}

### Prompt 6: agent-inbox

```openui-lang
root = Stack([header, waitingCard, restCard], "column", "section")
sessions = Query("sessions", {}, {rows: []})
waiting = @Filter(sessions.rows, "waiting", "==", "yes")
rest = @Filter(sessions.rows, "waiting", "==", "no")
header = Stack([Heading("Agent sessions"), Badge(@Count(waiting) + " waiting on you", @Count(waiting) > 0 ? "warn" : "ok"), Button("Refresh", @Run(sessions), "ghost")], "row", "row")
waitingCard = Card("Waiting on you", [List(@Each(waiting, "s", ListItem(s.title, s.provider + " · waiting " + (s.idleMinutes < 60 ? @Floor(s.idleMinutes) + " min" : s.idleMinutes < 1440 ? @Floor(s.idleMinutes / 60) + " h" : @Floor(s.idleMinutes / 1440) + " d"), [Badge(s.attention, "warn")], [Button("Pick it up", @ToAssistant("The agent session \"" + s.title + "\" is waiting on me (" + s.attention + "). Read it, tell me what it needs, and help me answer it.", {sessionId: s.id, taskId: s.taskId}), "solid")])), "Nothing is waiting on you.")])
restCard = Card("Everything else", [List(@Each(rest, "s", ListItem(s.title, s.provider + " · last active " + (s.idleMinutes < 60 ? @Floor(s.idleMinutes) + " min" : s.idleMinutes < 1440 ? @Floor(s.idleMinutes / 60) + " h" : @Floor(s.idleMinutes / 1440) + " d") + " ago", [Badge(s.state, s.state == "failed" ? "danger" : "neutral")])), "No other sessions.")])
```

Plan `sessions`: {"title": "Agent sessions", "sources": ["agents/sessions"], "columns": ["title:text", "provider:text", "state:enum", "attention:enum", "updatedAt:datetime (hidden)"], "stages": ["filter /state ne \"archived\"", "{\"op\":\"compute\",\"columns\":[{\"id\":\"waiting\",\"label\":\"Waiting on me\",\"expression\":{\"kind\":\"choice\",\"column\":\"attention\",\"cases\":{\"permission\":\"yes\",\"question\":\"yes\",\"workflow_gate\":\"yes\"},\"otherwise\":\"no\"}},{\"id\":\"idleMinutes\",\"label\":\"Minutes since last activity\",\"expression\":{\"kind\":\"duration\",\"start\":{\"kind\":\"column\",\"column\":\"updatedAt\"},\"end\":{\"kind\":\"clock\",\"name\":\"now\"},\"unit\":\"minutes\"}}]}"], "sort": ["updatedAt desc"], "view": {"kind": "list"}}

### Prompt 7: spend-by-model

```openui-lang
root = Stack([Heading("AI spend this month"), body], "column", "section")
top = Query("costlyTasks", {}, {rows: []})
tasks = Query("tasks", {}, {rows: []})
body = Stack([Card("By model", [Panel("spendByModel")]), Card("Five most expensive tasks", [list])], "row", "section")
list = List(@Each(top.rows, "t", ListItem(@Count(@Filter(tasks.rows, "taskId", "==", t.taskId)) > 0 ? @First(@Filter(tasks.rows, "taskId", "==", t.taskId)).title : t.taskId, "$" + @Round(t.cost, 2) + " this month", [], [Button("Why so much?", @ToAssistant("Why did this task cost $" + @Round(t.cost, 2) + " in AI spend this month? Break down which sessions, models and turns drove it.", {taskId: t.taskId, costUsd: t.cost}), "ghost")])), "No AI spend this month.")
```

Plan `costlyTasks`: {"title": "Five most expensive tasks, this month", "sources": ["agents/usage-records"], "columns": ["at:datetime (hidden)", "taskId:text", "costUsd:number"], "stages": ["filter /at gte context.calendar.startOfMonth", "summarize by taskId measure cost=sum(costUsd)"], "sort": ["cost desc"], "limit": 5, "view": {"kind": "table"}}

Plan `spendByModel`: {"title": "AI spend by model, this month", "sources": ["agents/usage-records"], "columns": ["at:datetime (hidden)", "model:enum", "costUsd:number"], "stages": ["filter /at gte context.calendar.startOfMonth", "summarize by model measure cost=sum(costUsd)"], "sort": ["cost desc"], "view": {"kind": "chart", "shape": "bar", "x": "model", "aggregate": "sum", "field": "cost"}}

Plan `tasks`: {"title": "Task titles", "sources": ["core/tasks"], "columns": ["title:text"], "stages": [], "view": {"kind": "list"}}

### Prompt 8: standup-note

```openui-lang
root = Card("Standup note", [Text("Tick what you worked on since yesterday.", "muted"), taskList, more, blockersField, Text(ticked + " ticked", "muted"), buttons])
$blockers = ""
$c1 = false
$c2 = false
$c3 = false
$c4 = false
$c5 = false
$c6 = false
$c7 = false
$c8 = false
tasks = Query("recentTasks", {}, {rows: []})
r = tasks.rows
taskList = @Count(r) == 0 ? Empty("No tasks changed since yesterday.") : Stack([task1, task2, task3, task4, task5, task6, task7, task8], "column", "row")
more = @Count(r) > 8 ? Alert((@Count(r) - 8) + " more tasks changed. Only the first 8 by title are listed.", "muted") : null
task1 = @Count(r) > 0 ? Checkbox("c1", r[0].title, $c1, r[0].project + " · " + r[0].branch) : null
task2 = @Count(r) > 1 ? Checkbox("c2", r[1].title, $c2, r[1].project + " · " + r[1].branch) : null
task3 = @Count(r) > 2 ? Checkbox("c3", r[2].title, $c3, r[2].project + " · " + r[2].branch) : null
task4 = @Count(r) > 3 ? Checkbox("c4", r[3].title, $c4, r[3].project + " · " + r[3].branch) : null
task5 = @Count(r) > 4 ? Checkbox("c5", r[4].title, $c5, r[4].project + " · " + r[4].branch) : null
task6 = @Count(r) > 5 ? Checkbox("c6", r[5].title, $c6, r[5].project + " · " + r[5].branch) : null
task7 = @Count(r) > 6 ? Checkbox("c7", r[6].title, $c7, r[6].project + " · " + r[6].branch) : null
task8 = @Count(r) > 7 ? Checkbox("c8", r[7].title, $c8, r[7].project + " · " + r[7].branch) : null
blockersField = Input("blockers", "Blockers", $blockers, "None")
ticked = @Count(@Filter([$c1, $c2, $c3, $c4, $c5, $c6, $c7, $c8], "", "==", true))
line1 = $c1 && @Count(r) > 0 ? "\n- " + r[0].title : ""
line2 = $c2 && @Count(r) > 1 ? "\n- " + r[1].title : ""
line3 = $c3 && @Count(r) > 2 ? "\n- " + r[2].title : ""
line4 = $c4 && @Count(r) > 3 ? "\n- " + r[3].title : ""
line5 = $c5 && @Count(r) > 4 ? "\n- " + r[4].title : ""
line6 = $c6 && @Count(r) > 5 ? "\n- " + r[5].title : ""
line7 = $c7 && @Count(r) > 6 ? "\n- " + r[6].title : ""
line8 = $c8 && @Count(r) > 7 ? "\n- " + r[7].title : ""
note = "Since yesterday I worked on:" + (ticked == 0 ? "\n- nothing tracked" : "") + line1 + line2 + line3 + line4 + line5 + line6 + line7 + line8 + "\nBlockers: " + ($blockers == "" ? "none" : $blockers)
buttons = Stack([Button("Put it in the composer", @Compose(note), "solid"), Button("Clear", @Reset($c1, $c2, $c3, $c4, $c5, $c6, $c7, $c8, $blockers), "ghost")], "row", "row")
```

Plan `recentTasks`: {"title": "Tasks touched since yesterday", "sources": ["core/tasks"], "columns": ["title:text", "project:text", "branch:text", "updatedAt:datetime (hidden)"], "stages": ["filter /updatedAt gte context.calendar.startOfDay -P1D"], "sort": ["title asc"], "view": {"kind": "list"}}

### Prompt 9: compare-tasks

```openui-lang
root = Stack([Heading("Compare two tasks"), sides], "column", "section")
$a = ""
$b = ""
tasks = Query("tasks", {}, {rows: []})
taskA = @First(@Filter(tasks.rows, "taskId", "==", $a))
taskB = @First(@Filter(tasks.rows, "taskId", "==", $b))
sides = Stack([sideA, sideB], "row", "section")
sideA = Card("First task", [Select("a", "Task", @Each(tasks.rows, "t", SelectItem(t.taskId, t.title)), $a), detailA])
sideB = Card("Second task", [Select("b", "Task", @Each(tasks.rows, "t", SelectItem(t.taskId, t.title)), $b), detailB])
detailA = $a == "" ? Empty("Pick a task.") : Stack([Text(taskA.project, "muted"), Text(taskA.branch, "mono"), Text(taskA.modifiedCount + " modified, " + taskA.untrackedCount + " untracked files"), Panel("taskCost", {taskId: $a})], "column", "row")
detailB = $b == "" ? Empty("Pick a task.") : Stack([Text(taskB.project, "muted"), Text(taskB.branch, "mono"), Text(taskB.modifiedCount + " modified, " + taskB.untrackedCount + " untracked files"), Panel("taskCost", {taskId: $b})], "column", "row")
```

Plan `taskCost`: {"title": "Agent cost so far", "sources": ["agents/usage-records"], "columns": ["costUsd:number", "taskId:text (hidden)"], "stages": ["filter /taskId eq $input.taskId"], "view": {"kind": "stat", "aggregate": "sum", "field": "costUsd"}}

Plan `tasks`: {"title": "Active tasks", "sources": ["core/tasks"], "columns": ["title:text", "project:text", "branch:text", "modifiedCount:number", "untrackedCount:number", "updatedAt:datetime", "status:enum (hidden)"], "stages": ["filter /status eq \"active\""], "sort": ["updatedAt desc"], "view": {"kind": "list"}}

### Prompt 10: release-readiness

```openui-lang
root = Stack([header, summary, branchCard, worktreeCard, checklist], "column", "section")
$merged = false
$clean = false
$lint = false
$tests = false
$desktop = false
$notes = false
$tag = false
branches = Query("unmergedBranches", {}, {rows: []})
worktrees = Query("dirtyWorktrees", {}, {rows: []})
branchCount = @Count(branches.rows)
worktreeCount = @Count(worktrees.rows)
done = @Count(@Filter([$merged, $clean, $lint, $tests, $desktop, $notes, $tag], "", "==", true))
header = Stack([Heading("Release readiness"), Button("Refresh", Action([@Run(branches), @Run(worktrees)]), "ghost")], "row", "row")
summary = Stack([Badge(branchCount + " branches ahead of main", branchCount == 0 ? "ok" : "warn"), Badge(worktreeCount + " dirty worktrees", worktreeCount == 0 ? "ok" : "warn"), Badge(done + " of 7 steps done", done == 7 ? "ok" : "neutral")], "row", "row")
branchCard = Card("Branches with work not on main", [List(@Each(branches.rows, "b", ListItem(b.name, b.aheadDefault + " commits ahead of main · " + (b.upstream == null ? "never pushed" : b.aheadUpstream + " unpushed to " + b.upstream), [], [Button("Merge or drop", @ToAssistant("The branch " + b.name + " is " + b.aheadDefault + " commits ahead of main. Tell me what's on it and whether it should merge before the release or be dropped.", {branch: b.name}), "ghost")])), "Every local branch is on main.")])
worktreeCard = Card("Worktrees with uncommitted changes", [List(@Each(worktrees.rows, "w", ListItem(w.branch == null ? w.path : w.branch, w.modifiedCount + " modified, " + w.untrackedCount + " untracked · " + w.path, [], [Button("Commit or discard", @ToAssistant("The worktree " + w.path + " has uncommitted changes. Look at them and tell me whether to commit or discard them before the release.", {path: w.path, branch: w.branch}), "ghost")])), "Every worktree is clean.")])
checklist = Card("Release steps", [Checkbox("merged", "Merge or drop every branch ahead of main", $merged, branchCount + " left"), Checkbox("clean", "Commit or discard changes in every worktree", $clean, worktreeCount + " left"), Checkbox("lint", "pnpm lint passes", $lint), Checkbox("tests", "pnpm test passes (the full gate)", $tests), Checkbox("desktop", "pnpm --filter @acorn/desktop test passes", $desktop), Checkbox("notes", "Update docs/release-notes.md", $notes), Checkbox("tag", "Push a v* tag so CI builds the Node archives", $tag), Text(done + " of 7 done", "muted"), finish])
finish = done == 7 ? Button("Tell the agent it's ready", @ToAssistant("The release checklist is done."), "solid") : null
```

Plan `dirtyWorktrees`: {"title": "Worktrees with uncommitted changes", "sources": ["core/local-worktrees {\"parameters\":{\"project\":\"83235ff7-4d62-4f38-a0ae-ecaef94c0e06\"}}"], "columns": ["path:text", "branch:text", "modifiedCount:number", "untrackedCount:number", "lastCommitAt:datetime (hidden)"], "stages": ["filter (/modifiedCount gt 0 any /untrackedCount gt 0)"], "sort": ["lastCommitAt desc"], "view": {"kind": "list"}}

Plan `unmergedBranches`: {"title": "Local branches ahead of main", "sources": ["core/local-branches {\"parameters\":{\"project\":\"83235ff7-4d62-4f38-a0ae-ecaef94c0e06\"}}"], "columns": ["name:text", "aheadDefault:number", "upstream:text", "aheadUpstream:number", "lastCommitAt:datetime (hidden)"], "stages": ["filter /aheadDefault gt 0"], "sort": ["lastCommitAt desc"], "view": {"kind": "list"}}

## Verify before building

- OpenUI's conformance runner, so the package's runner reads the cases the same way.
- That `pnpm dev:agent` works as [local development](../../local-development.md) describes.
