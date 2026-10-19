# Agent analytics

Date: October 19, 2026. Status: proposed. Implementation not started.

This programme plans what core needs so a plugin can show how a workspace's agents spend time and
money, and where they struggle. Its last phase builds that plugin, `acorn-analytics`, in its own
repository at `../acorn-analytics`. Read this page before you pick up a phase.

[agentsview](https://github.com/kenn-io/agentsview) is the inspiration, cloned at
`references/agentsview`. It reads 20-odd agents' log files into one archive and draws dashboards,
costs, and session health over them. This programme takes a few of its ideas and builds them from
what Acorn already knows: tasks, projects, change requests, and the agents plugin's own record of
every managed session. It doesn't copy agentsview's features or its vocabulary.

## What the person gets

Everything is scoped to one workspace, because the workspace is the only scope whose left rail spans
several projects. When every phase ships, a person in a workspace can:

- Open **Agent analytics** from the left rail and see the sessions that need a look this week, each
  with a reason, such as "5 failed commands in a row".
- Read panels beside that list: spend by day stacked by model, spend by project, when agents work
  across the hours of the week, and how long agents waited on them.
- See a mark on a session in Agent Center, and on a task in the rail, when its agent is struggling.
  Focusing the mark lists the reasons, each naming the turn, and with phase 7 linking to the call
  where the trouble started.
- Ask an agent "graph what my agents cost this month by project" and get a panel drafted in the
  conversation over the same data, through dynamic UI's `panel_show`.
- Add any of these panels to a Home tab.

## Starting point

The checkout at `3d92153ef` already holds most of what this needs:

- The agents plugin records every managed session in a ledger: typed tool calls with status and exit
  code, file changes with patches, subagents, usage, and requests with their creation and resolution
  times. The tables are in `plugins/agents/src/node/schema.ts`.
- The agents plugin serves two data sources. `usage-records` has one row per usage event, priced from
  the person's preferences (`plugins/agents/src/shared/usageSource.ts`). `sessions` has one row per
  unarchived session (`plugins/agents/src/shared/sessionSource.ts`). Both take a workspace scope.
- Dashboards draw stat, list, table, board, and chart views, with median and percentile measures and
  day, week, and month buckets ([views](../../dashboards/views.md)). Home boards belong to a workspace.
- A plugin can reserve a dashboard region beside its rail list or its pane
  ([plugin regions](../../dashboards/placements.md#plugin-regions)), serve a derived source over
  other plugins' sources ([derived sources](../../data-sources/derived-sources.md)), and put marks on
  tasks through `core:task` ([task annotations](../../plugins/rows-and-annotations.md#task-annotations)).
- Core links change requests to tasks, and records which session attached each one
  (`tasks.changeRequests` in `packages/plugin-types/src/contracts/coreTasks.ts`).

The `dynamic-ui` branch at `af24f84d9` holds dynamic UI phases 1 to 3. This programme assumes all
eight phases have merged. [Phase 1](./01-dynamic-ui-fit.md) checks that they give this programme what
it needs.

Six gaps stand in the way:

- `usage-records` reads the oldest 5,001 usage events and filters them afterwards, so a "this month"
  panel on a large history comes back empty and marked incomplete.
- No source has one row per turn or per session with the numbers a person asks about: active time,
  failures, repeated calls, rewrites, context, waiting on approval, and cost.
- Dashboards have no heatmap, no stacked bars, and no hour or weekday buckets.
- A plugin region's panels are shared by every workspace, while the panels in them read one workspace.
- A loaded rail source can ask for the routed project, but not the workspace.
- Nothing can put a mark on a session, and no link opens a session at a message.

## The phases

| Phase | What changes |
| --- | --- |
| [1](./01-dynamic-ui-fit.md) | Check that dynamic UI fits. Key plugin regions by workspace, let **Add to dashboard** reach plugin regions, and confirm added views reach panel cards and apps without library changes. |
| [2](./02-turn-facts.md) | The agents plugin records one row of numbers for each finished turn, backfills history, and keeps the numbers after history removal. |
| [3](./03-agent-sources.md) | Two agents sources over those rows, **Agent turns** and **Agent session totals**, that push time windows into SQL, plus the same fix for `usage-records`. |
| [4](./04-heatmaps-and-stacked-bars.md) | A `heatmap` view, stacked bars, and `hour` and `weekday` buckets, taught to the studio and to agents. |
| [5](./05-workspace-rail-sources.md) | A rail source can declare `workspaceScoped`, and the host passes the active workspace to its routes. |
| [6](./06-session-marks.md) | An `agents:session` annotation point, drawn on Agent Center rows, the task's session list, and the Agent pane header. |
| [7](./07-message-links.md) | `acorn://` links that open a session at one message, and **Copy link to message**. |
| [8](./08-analytics-plugin.md) | The `acorn-analytics` plugin in `../acorn-analytics`. |

Phases 1, 4, 5, 6, and 7 don't depend on each other, and can run in parallel. Phase 3 needs phase 2.
Phase 8 needs phases 1 to 6. It uses phase 7's links when they exist, and works without them.

## What holds across every phase

- Core records facts, and plugins hold opinions. A fact is a number anyone would agree on, such as
  "three failed calls in a row". A judgment, such as "this session is struggling", belongs to a
  plugin, so two plugins can disagree and core never has to.
- Facts hold numbers and identifiers, never prompt text, tool input, tool output, or file content.
  A session's facts can be shown to anyone who can see its task.
- Every view a person opens is scoped to one workspace: the rail list, its panels, and Home. A mark
  describes one session or one task, and an annotation request names no workspace, so the plugin
  answers marks from a Node-wide read of recent sessions and shows each session only its own facts.
- A chart is a dashboard panel. No phase adds a chart component to the kit or to a plugin.
- The facts don't change the transcript, the ledger, or any harness driver.
- When a phase ships, document the behavior in the owning reference page and trim this plan.

## What this leaves out of agentsview

agentsview solves problems Acorn doesn't have, and Acorn already covers others. These are left out
on purpose:

- **Other agents' log files.** agentsview's parsers for Claude Code, Codex, Cursor, Gemini, and the
  rest are most of its code. Acorn runs the agents itself, and its ledger already holds structured
  events. Sessions run outside Acorn stay out of scope.
- **Guessing a session's project from folder paths.** Half of agentsview's own vocabulary is about
  this. In Acorn, a session belongs to a task, and a task to a project.
- **Database mirrors.** Pushing to PostgreSQL, ClickHouse, or DuckDB for team dashboards belongs to
  the cloud team plans ([cloud](../cloud/README.md)).
- **Search and memory.** Acorn has transcript search, the `agent_session_*` tools that let an agent
  read other sessions, and the memory library with its review flow. agentsview's semantic search and
  Recall entries would duplicate them.
- **A score out of 100 with letter grades.** A penalty model with 10 weights invites arguing about
  weights. The plugin says **OK**, **Watch**, or **Struggling**, and lists the reasons.
- **Session archetype names**, such as quick, deep, and marathon. A panel can bucket duration
  without names that need explaining.
- **Model-written reports about sessions.** They spend tokens nobody asked for and send tool output
  to a model. The `acorn-advisor` plugin already reviews turns when a person wants that.
- **A recent edits feed.** The task's diff, Git, and the transcript's file cards already show what
  changed.
- **Compaction counts.** Neither harness reports a compaction as data: Codex sends a sentence, and
  Claude Code sends nothing. Peak context covers the same worry.
- **A spend chip in the top bar, a status line, and a usage CLI.** Panels cover spend. A chip needs
  range filters on derived inputs, which [later](#later) lists.

## Decisions for the owner

These belong to the owner. Each phase names the default it assumes:

1. Facts outlive transcript history. The retention pass removes a session's events after its task
   has been archived for the chosen time, and the facts stay, because they hold numbers only. A
   deleted task's facts go with it.
2. Facts are written when a turn finishes. A turn still running shows nothing until it ends, so a
   40-minute turn that is failing shows its mark when it settles. Facts for a running turn would mean
   a writer per streamed event.
3. The plugin's thresholds are constants in its code, named and documented in its README. A settings
   page waits until someone wants different numbers.
4. "Did the work land" means the session attached a change request and its task was archived, not
   cancelled. Whether the change request merged lives with the code host, and [later](#later) lists it.
5. The plugin ships a node half and declarations only, with no client bundle. Every surface it needs
   is host-drawn: a rail list, a panel region, and marks. So it has no client trust prompt and works in
   the terminal client, apart from panels.

## Later

- **Panels in the terminal client.** The terminal draws a panel as one line. Dynamic UI leaves this
  open, and the heatmap's terminal rendering in [phase 4](./04-heatmaps-and-stacked-bars.md) is
  written for when it's picked up.
- **Range filters on derived inputs.** A derived source's `where` takes equality only, so a derived
  source can't ask for "turns since midnight" and would read the newest 5,000. A spend chip needs it.
- **Merged state.** A relation from the session totals source to the code host's change request
  source would let a panel say "merged".
- **A tool calls source.** One row per tool call allows charts of tool use by name. At about 40,000
  calls in a measured database, it needs its own design for volume.

## Why

Computing the numbers once in core beats each plugin rebuilding them. A plugin can't read history
from the ledger, and shouldn't. Each analytics plugin would otherwise subscribe to live frames, miss
whatever happened while it was reloading, and work out the same counts differently. A row per turn
keeps the computation in one tested place, beside the ledger it reads.

Data sources beat a capability. Dashboards, `panel_show`, apps, and derived sources all read data
sources already. A capability would need its own paging, scoping, and trust copy, and only plugins
could use it.

The plugin stays small on purpose. Its value is its opinion, so it's the part people will want to
change or replace.
