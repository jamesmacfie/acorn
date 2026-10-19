# Agent-built panels and apps

Status: proposed, 2026-10-01. Revised 2026-10-19: agent-made dashboard panels come first, apps are
OpenUI Lang programs, and every agent-built UI reads its data through dashboard plans. Nothing in this
programme is built or scheduled. Where a file here disagrees with a shipped contract, the owning
reference document wins until the implementation changes that contract.

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
| [01-agent-panels.md](./01-agent-panels.md) | Phase 1. An agent drafts a dashboard panel in the conversation, and **Add to dashboard** puts it on Home. |
| [02-renderer-and-spike.md](./02-renderer-and-spike.md) | Phase 2. A Solid renderer for OpenUI, then a spike: can an agent write a useful app for what a panel can't do? Decides whether to go on. |
| [03-inline-cards.md](./03-inline-cards.md) | Phase 3. Task apps shown as cards, with the library, tools, validation, and revisions. |
| [04-task-pane.md](./04-task-pane.md) | Phase 4. The task Apps pane, the editing drawer, app state, and archive. |
| [05-project-apps.md](./05-project-apps.md) | Phase 5. Publish to the project, the left-rail source, drafts, forks, and deletion. |
| [06-apps-on-dashboards.md](./06-apps-on-dashboards.md) | Phase 6. Project apps on Home tabs, beside ordinary panels. |
| [07-plugin-from-app.md](./07-plugin-from-app.md) | Phase 7. Turn an app into a plugin through an agent session, with its dependencies declared. |
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

- **Plans that take inputs from an app.** A date range or repository the owner picks in an app should
  change what its plan reads. Phase 2 finds out whether the run route can take those inputs from a
  program, or whether plans need a way to declare them.
- **Panels in the terminal.** The terminal client draws no dashboard panels, so panel cards and
  `Panel` components show one line there. A terminal view for the dashboard's five views would fix
  both, and isn't scheduled in this programme.
- **Where Add to dashboard can put things.** Phase 1 offers Home tabs only. Plugin regions constrain
  panels by source, field role, and view, and could be added for panels later. App cells can't go
  there until regions understand an app's plans.
- **A whole task to edit an app.** Editing a project app in a new task creates a worktree when the
  session starts. That may be too slow for changing a UI. The options are a lighter task kind with no
  worktree, a session that runs in a scratch folder, or accepting the cost. Phase 5 measures it.
- **The host plugin's name.** "Apps" is the product word, but `apps/` is also the repository's folder of
  runnable programs. Phase 3 picks a code name.
- **The renderer package's name and home.** It could be published unscoped from this repository, or
  offered to OpenUI's repository as its Solid renderer. OpenUI's Vue, Svelte, and Angular renderers
  trail its core by a major version, which argues for keeping it here. Decide after phase 3.
- **Security review.** Phase 3 cannot ship without a review of the interpreter and the tool mapping.
  See [no trust grant](./design.md#no-trust-grant).

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
