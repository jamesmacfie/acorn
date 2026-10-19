# Phase 8: build the acorn-analytics plugin

Date: October 19, 2026. Status: proposed. Needs phases [1](./01-dynamic-ui-fit.md) to
[6](./06-session-marks.md). Uses [phase 7](./07-message-links.md) when it exists.

## Goal

A loaded plugin, `acorn-analytics`, in its own repository at `../acorn-analytics`, beside this
checkout. It judges each recent agent session as **OK**, **Watch**, or **Struggling**, with the
reasons in plain words. It lists the sessions that need a look in the workspace's left rail, with
panels beside the list, and marks struggling sessions and tasks where the person already looks.

It holds opinions only. Every number it judges comes from the agents sources of
[phase 3](./03-agent-sources.md). It stores nothing, ships no client bundle, and spends no model tokens.

## Starting point

- `npm create acorn-plugin <name> -- --data-source` writes a derived source package with Vite,
  Vitest, `src/source.ts`, `src/index.ts`, and a build that bundles `dist/node.js` and rewrites the
  manifest's inputs ([derived sources](../../plugin-authoring/derived-sources.md)).
- A derived source's inputs are read with `all()`, up to 5,000 records, and filtered with equality
  only.
- A loaded plugin invokes its own sources through `ctx.dataSources.invoke`, and reads another plugin's
  only as an input of a derived source ([data sources](../../data-sources.md#operations-and-transport)).
- `acorn-session-meter`, in its own repository, shows what one task's live sessions are doing.
  This plugin looks back across the workspace instead. The two don't overlap.

## What the plugin contributes

All of these are declarations the host draws, served by the plugin's Node half:

| Contribution | What the person sees |
| --- | --- |
| Derived source `session-health`, **Agent session health** | One row per session, judged. Its starter panels, and any panel a person or agent builds on it |
| Rail source **Agent analytics**, `workspaceScoped` | This workspace's sessions that need a look in the last seven days, worst first, with panels beside the list |
| Extension on `agents:session` | A **Watch** or **Struggling** mark on a session, with its reasons as detail |
| Extension on `core:task` | A mark on a task in the rail while one of its sessions is struggling |

The plugin has no pane, settings page, command, or client file. Everything above draws in the terminal
client too, apart from the panels.

## The judgment

`src/health.ts` holds the rules as a pure function from one **Agent session totals** record to a
health, a main reason, and a list of reasons. Each rule names its threshold as a constant, and the
README lists them:

| Fact | Watch at | Struggling at | Reason text |
| --- | --- | --- | --- |
| `longestFailureRun` | 3 | 5 | "5 failed tool calls in a row, in turn 12" |
| `repeatedCalls` | 1 | 3 | "Repeated the same call 4 times, in turn 7" |
| `failedTurns` | 1 | 2 | "2 turns ended in an error" |
| `filesRewritten` | 2 | none | "Rewrote 3 files three or more times in one turn" |
| `contextPeak` | 90% | none | "Context reached 96%" |

`repeatedCalls` counts from the third identical call, so 1 means three in a row.

A session's health is its worst reason's level, and **OK** with no reasons. The main reason is the
first reason at that level, in the table's order. Time spent waiting on the person isn't a reason,
because it describes the person, not the agent. The panels show it instead.

The outcome is a second, separate judgment from the task's status and the session's change requests:

| Outcome | When |
| --- | --- |
| **In progress** | The task is active |
| **Finished with a change request** | The task is archived, and this session attached at least one change request |
| **Finished without one** | The task is archived, and this session attached none |
| **Cancelled** | The task was cancelled |

"Finished with a change request" doesn't claim the change merged. The README says so.

## The source

`session-health` reads one input, `agents:session-totals`. Each row has:

- `title`, the session's title, with the `title` role.
- `health`, a choice of `ok`, `watch`, and `struggling`, with tones and ranks, and the `status` role.
- `mainReason`, a choice of `failures`, `repeats`, `errors`, `rewrites`, and `context`, or null.
- `reasons`, the reason texts joined into one line.
- `outcome`, a choice of the four outcomes.
- `taskTitle`, `projectName`, `provider`, `costUsd`, `activeMinutes`, `turns`, and `lastActive`, with the
  `updated` role, copied from the input.

Each row opens the input record, so pressing it opens the session in its task.

The input reads the newest 5,000 sessions in the query's scope. A workspace past that gets an
incomplete page, as the host reports it. Its starter panels:

| Starter | View |
| --- | --- |
| Sessions that need a look this week | List, health not **OK**, `lastActive` in the last seven days, worst first |
| What goes wrong, last 30 days | Bar by `mainReason`, count |
| Health by project this month | Bar by `projectName`, stacked by `health` |
| How sessions end this month | Bar by `outcome`, count |
| Cost by outcome this month | Bar by `outcome`, sum of `costUsd` |

## The routes

`src/index.ts` serves the source, two marks routes, and the rail's items route.

- **The rail.** `GET /v1/p/acorn-analytics/needs-a-look?workspace=` invokes `session-health` scoped to
  that workspace, keeps the rows that aren't **OK** from the last seven days, and answers up to 50 rail
  rows. Each row carries the session title, `fields` of task title and main reason, `severity` `warn`
  or `danger`, and the session's task, so `onSelect` `openTask` opens it. The source's `panels` region
  accepts `acorn-analytics:session-health`, `agents:turns`, `agents:session-totals`, and
  `agents:usage-records`, up to six panels.
- **Session marks.** `POST /v1/p/acorn-analytics/session-marks` answers marks for the visible session
  keys. The text is the health and the main reason, such as "Struggling: 5 failed tool calls in a row".
  The detail lists every reason in Markdown. With phase 7, each reason that names a turn links to the
  call where the run started, as `acorn://this/t/<task>?pane=agent&item=<session>&at=<seq>`. Without
  it, the reason names the turn and links nowhere.
- **Task marks.** `POST /v1/p/acorn-analytics/task-marks` marks a task `danger` while one of its
  sessions is **Struggling**, with the session's title in the text. **Watch** doesn't mark a task,
  because the rail is busy enough.

Marks requests carry session or task ids and no workspace, so both marks routes read from one Node-wide
invocation of `session-health`, windowed to sessions active in the last 14 days, and held in memory.
An older session gets no mark. The plugin drops the held read when `plugin:agents:turn-facts` arrives,
and asks the host to read its marks again, at most once every five seconds. A held read also expires
after five minutes, so a missed event costs at most five minutes of staleness.

## The manifest

- `requires.plugins` names `agents` with the major that ships phase 3's sources.
- `permissions.events` lists `plugin:agents:turn-facts`.
- `permissions.node` grants nothing: no core facets, no network, no `exec`, and no secrets.
- `contributions.dataSources` holds `session-health` with its one input, which the trust prompt words as
  reading agent session totals from Agents.
- `contributions.railSources` holds **Agent analytics**, with `workspaceScoped`, `panels`, an
  `emptyState` of "No sessions need a look this week.", and `showInRailByDefault` left at its default.
- `contributions.extensions` holds the two marks routes.

## The repository

```text
acorn-analytics/
  acorn-plugin.json        the manifest, rewritten by the build
  package.json             vite, vitest, and acorn-plugin-sdk
  README.md                what it does, the thresholds, install, and limits
  src/health.ts            the judgment, pure
  src/health.test.ts       one test per rule, threshold edges, and the outcome table
  src/source.ts            the derived source and its starters
  src/source.test.ts       rows from fixture totals, through acorn-plugin-sdk/testing
  src/marks.ts             both marks routes and the held read
  src/marks.test.ts        mark text, detail with and without links, the 14-day window
  src/rail.ts              the rail's items route
  src/index.ts             the Node entry: serves the source and routes, and subscribes
  scripts/manifest.mjs     from the scaffold
```

The repository is its own Git repository, as `acorn-session-meter` and `acorn-advisor` are. It
publishes to npm only when the owner decides to.

## Steps

1. Run the scaffold in the folder above this checkout and initialize the repository.
2. Write `health.ts` and its tests first, from hand-written totals records.
3. Write the source, its starters, and their validation test.
4. Write the rail and marks routes, the held read, and the event subscription.
5. Write the README: what it judges and why, the thresholds, the outcome table, what it leaves out, and
   how to install it.
6. Install it on a dev Node and run the acceptance below.

## Acceptance

Run these in `pnpm dev:agent`, with the plugin installed from its folder
([install a hand-written package](../../plugin-authoring/installing-a-hand-written-package.md)):

- A session that ran a failing command five times in a row is **Struggling**. Agent Center shows the
  mark, its detail names the turn, and with phase 7 its link opens the first failing call.
- **Agent analytics** in the rail lists that session. Pressing it opens its task. The panel region
  offers the five starters, and each one publishes and draws.
- Switching workspace switches the list and the region's panels.
- The task's rail row shows a `danger` mark until the session's next turns bring it back to **Watch**
  or **OK**.
- In the terminal client, the rail list and the marks show, and the region reads that panels draw in
  the desktop app.
- `npm test` passes in the plugin's repository, and `pnpm --filter @acorn/arch-tests test` passes in
  this one after the docs change.
