# Agent-built panels and apps

Status: proposed, 2026-10-01. Revised 2026-10-19: agent-made dashboard panels come first, apps are
OpenUI Lang programs, and every agent-built UI reads its data through dashboard plans. Phases 1 to 7
were built on October 19 and 20, 2026, and their phase files are deleted. The shipped behaviour is in
[agent-built apps](../../agent-built-apps.md), [dashboards](../../dashboards.md), and
[agent tools](../../agent-tools.md). Phase 8 waits on the cloud programme. Where a file here disagrees
with a shipped contract, the owning reference document wins.

## What this is

An agent builds a small UI for the task it is working on, inline in the conversation.

Most requests are a view of data, such as "graph pull requests over the last month by person." The
agent answers with a dashboard panel, drawn with the dashboard's own views. **Add to dashboard** puts
it on a Home tab, where it stays live, because a panel stores where its data comes from, not the data.

Requests that need state, forms, or several views together get an app: a program in OpenUI Lang, a
short language for model-written UI, that lays out kit components and dashboard panels. An app opens
full size in the task's Apps pane, changes when the owner asks, and archives with the task. A useful
one is published to the project, opens from the left rail, and can go on a dashboard. One that grows
into a product is rebuilt as an ordinary plugin by an agent.

It comes from studying how Lemma generates widgets and apps, how OpenUI specifies a language for the
same job, and what Acorn's dashboards already do. For the study, read [research](./research.md).

## Read this programme

| File | What it covers |
| --- | --- |
| [design.md](./design.md) | The model: one way to fetch, shape, and draw; agent-made panels; apps as programs and plans; the library and renderer package; placements; tools; validation; revisions; what an app can reach; lifecycle; dashboards; turning an app into a plugin; the terminal; cost; and security. |
| [research.md](./research.md) | What Lemma does and what it costs, what OpenUI specifies and ships, what dashboards already do, which Acorn seams exist, and what is missing. |
| [refused.md](./refused.md) | What this programme decided not to build, and when to revisit it. |
| [08-teams.md](./08-teams.md) | Phase 8. Apps on a team Node, with roles. Waits on the cloud programme. |

## The phases at a glance

| Phase | What the owner gets at the end | Depends on |
| --- | --- | --- |
| 1 | "Graph me X" produces a dashboard panel in the conversation, and **Add to dashboard** puts it on a Home tab, live. | Nothing. |
| 2 | A Solid renderer for OpenUI that passes OpenUI's conformance cases, and a measured answer to whether agents write useful apps for what panels can't do. Nothing ships in the app. | 1. |
| 3 | "Build me a checklist for this migration" produces an app card, and "change it" produces the next revision. | A **Go** from 2. |
| 4 | An Apps button in the task's right rail, editing beside the app, apps that remember, and apps that archive and restore with the task. | 3. |
| 5 | Apps published to the project, opened from the left rail, and edited through drafts. | 4. |
| 6 | Project apps on Home tabs, refreshing like any panel. | 5. |
| 7 | **Turn into a plugin**, which starts an agent session that rebuilds an app as a plugin package with `requires.plugins` filled in. | 5. |
| 8 | Project apps shared by a team, with roles. | 5, and [cloud phase 9](../cloud/phases/09-teams.md). |

## What the spike found

Phase 2's spike, on October 19, 2026, ended **Go with changes**. A managed Claude session wrote useful
apps for 7 of 10 prompts a single panel couldn't serve, each on the first try, judged by an agent
rather than the owner. Every miss was a plan or a missing source, not the language: no tool returned
account IDs, no source carried review comments, and bar charts refused a text axis. Phase 3 fixed the
first and third. The ten programs and their plans are in the phase 2 file at commit `619d5aaa9`.

## The decisions that shape it

These are argued in [design.md](./design.md). They are listed here because each one closes off an
alternative a reader might expect.

- **One way to fetch, one way to shape, two ways to draw.** Data sources fetch, plans shape on the
  Node, and either a dashboard view or an OpenUI program draws.
- **Panels come first.** Most "show me" requests are one view of one plan, and phase 1 ships them with
  no OpenUI.
- **An agent drafts, and the owner publishes.** No agent publishes or places a panel or app on a
  dashboard.
- **The chat agent and the studio's AI write plans from one set of instructions and one validator.**
- **Apps never query a data source directly.** An app's queries run its plans through the dashboard
  run route.
- **A chart in an app is a dashboard panel.** The library's `Panel` component draws a plan with the
  dashboard's own views, and the library has no chart of its own.
- **An app is an OpenUI Lang program and its plans.** The host interprets them, so nothing the agent
  writes runs as code, and no device prompts to trust an app.
- **Acorn writes the Solid renderer for OpenUI as its own package.** It imports nothing from Acorn,
  passes OpenUI's conformance cases, and stays private until phase 2 says **Go**. Publishing it is a
  separate decision after that.
- **Cards pin versions.** Older cards collapse to a line that can show their own version, instead of
  redrawing with the newest one, which is where Lemma's history stops being true.
- **One Apps button per task, and one Apps source in the left rail.** Never one rail icon per app.
- **Apps reach Acorn only through their plans and host tools:** row actions, task context, compose,
  and links. Not through every plugin's capabilities.
- **App files go through tools, not the agent's own file access.** Apps never appear in a task's diff.
- **Editing a project app needs a task,** because sessions belong to tasks.
- **An app that outgrows the language becomes a plugin through a rebuild.** It isn't exported as-is.

## Open questions

- **Plans that take inputs from an app.** Settled in phase 3: the run route takes `inputs`, which fill
  a plan's `{ from: 'input' }` comparison values and nothing else.
- **Panels in the terminal.** The terminal client draws no dashboard panels, so panel cards and
  `Panel` components show one line there. A terminal view for the dashboard's five views would fix
  both, and isn't scheduled in this programme.
- **Where Add to dashboard can put things.** Phase 1 offers Home tabs only. Plugin regions constrain
  panels by source, field role, and view, and could be added for panels later. App cells can't go
  there until regions understand an app's plans.
- **A whole task to edit an app.** Phase 5 measured it on October 19, 2026. **Edit in a new task**
  makes a project-folder task, the kind the reference panel's **Create task** makes, so no worktree is
  created at all. From the click, the task was open on its Apps pane with the draft in 1.16 seconds,
  and the editing session was ready for its first message. For comparison, a worktree of this
  repository (6,462 files) takes 1.0 to 1.3 seconds to create with no setup script, so a setup script
  is where a worktree task's real cost is. The open part is the trade: the editing agent runs in the
  project's own checkout. The app tools keep its edits in the data root, but nothing stops it writing
  repository files. A scratch-folder session would close that, and is a product decision.
- **The host plugin's name.** Settled in phase 3: `trellis`, because `apps/` is the repository's folder
  of runnable programs.
- **The renderer package's name and home.** It could be published unscoped from this repository, or
  offered to OpenUI's repository as its Solid renderer. OpenUI's Vue, Svelte, and Angular renderers
  trail its core by a major version, which argues for keeping it here. Decide after phase 3.
- **Security review.** Done in phase 3 and recorded in
  [the October 19 review](../../security/review-2026-10-19.md). One
  finding stays open: lang-core's evaluator can call a built-in function with no arguments, which only
  a change to lang-core removes.

## Owning documents this programme extends

Before changing code, read [dashboards](../../dashboards.md) and its
[placements](../../dashboards/placements.md), [data sources](../../data-sources.md),
[agent tools](../../agent-tools.md), [descriptors, trees, rectangles](../../plugins/ui-tiers.md),
[security](../../security.md), [cooperative extension points](../../plugins/cooperative-extension-points.md),
[panes](../../panes.md), [frontend](../../frontend.md), [workspaces and tasks](../../workspaces-and-tasks.md),
and [published packages](../../plugins/publishing.md). Phase 7 also reads
[activation](../../plugins/activation.md).

The UI extension programme shipped other plugins' contributions around files, messages, links, and
detail views on October 10, 2026, and deliberately left apps out. The path it kept open is an outer
companion region that the Apps host reserves. The region binds app identity, revision, placement,
and task or project scope, and mounts each contributor with its own permissions. Regions inside
generated content need an explicit declaration and a separate host-controlled mounting design. Don't
add placeholder app points, grant arbitrary capabilities, or let generated content into chrome.

## Verify before building

Recheck the shipped contracts named above before each phase, and each phase's own verify list. Do not
describe a proposal in this folder as shipped.
