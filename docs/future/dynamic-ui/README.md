# Agent-built apps

Status: proposed, 2026-10-01. Revised 2026-10-19: apps are OpenUI Lang programs. Nothing in this
programme is built or scheduled. Where a file here disagrees with a shipped contract, the owning
reference document wins until the implementation changes that contract.

## What this is

An agent builds a small UI for the task it is working on. It writes the UI in OpenUI Lang, a short
language for model-written UI, and Acorn draws it with the host's own components. The app appears
inline in the conversation, opens full size in the task's Apps pane, changes when the owner asks for
changes, and archives with the task. A useful one is published to the project, where it opens from
the left rail and can be edited through a draft in any task. One that grows into a product is rebuilt
as an ordinary plugin by an agent.

It comes from studying how Lemma generates widgets and apps, and how OpenUI specifies a language for
the same job. Acorn already shipped most of the rest for other reasons: a kit that draws in both
clients, the transcript tool card, the embeddable conversation, and typed data sources. For the study,
read [research](./research.md).

## Read this programme

| File | What it covers |
| --- | --- |
| [design.md](./design.md) | The model: programs, the OpenUI library and renderer package, placements, the tools, validation, revisions, what an app can reach, lifecycle, turning an app into a plugin, the terminal, cost, and security. |
| [research.md](./research.md) | What Lemma does and what it costs, what OpenUI specifies and ships, which Acorn seams exist, and what is missing. |
| [refused.md](./refused.md) | What this programme decided not to build, and when to revisit it. |
| [00-spike.md](./00-spike.md) | Phase 0. A Solid renderer for OpenUI, then a spike: can an agent write a useful program over the kit? Decides whether to go on. |
| [01-inline-cards.md](./01-inline-cards.md) | Phase 1. Task apps shown as cards, with the library, tools, validation, and revisions. |
| [02-task-pane.md](./02-task-pane.md) | Phase 2. The task Apps pane, the editing drawer, app state, and archive. |
| [03-project-apps.md](./03-project-apps.md) | Phase 3. Publish to the project, the left-rail source, drafts, forks, and deletion. |
| [04-export.md](./04-export.md) | Phase 4. Turn an app into a plugin through an agent session, with its dependencies declared. |
| [05-teams.md](./05-teams.md) | Phase 5. Apps on a team Node, with roles. Waits on the cloud programme. |

## The phases at a glance

| Phase | What the owner gets at the end | Depends on |
| --- | --- | --- |
| 0 | A Solid renderer for OpenUI that passes OpenUI's conformance cases, a measured answer to whether agents write useful programs over the kit, and answers to three plumbing questions. Nothing ships in the app. | Nothing. |
| 1 | "Build me a view of X" produces a card in the conversation, and "change it" produces the next revision. | A **Go** from 0. |
| 2 | An Apps button in the task's right rail, editing beside the app, apps that remember, and apps that archive and restore with the task. | 1. |
| 3 | Apps published to the project, opened from the left rail, and edited through drafts. | 2. |
| 4 | **Turn into a plugin**, which starts an agent session that rebuilds an app as a plugin package with `requires.plugins` filled in. | 3. |
| 5 | Project apps shared by a team, with roles. | 3, and [cloud phase 9](../cloud/phases/09-teams.md). |

## The decisions that shape it

These are argued in [design.md](./design.md). They are listed here because each one closes off an
alternative a reader might expect.

- **An app is an OpenUI Lang program.** The host interprets it, so nothing the agent writes runs as
  code, and no device prompts to trust an app.
- **Acorn writes the Solid renderer for OpenUI as its own package.** It imports nothing from Acorn,
  passes OpenUI's conformance cases, and stays private until phase 0 says **Go**. Publishing it is a
  separate decision after that.
- **One library over the kit draws in both clients.** Its prop order is frozen once programs use it.
- **Cards pin revisions.** Older cards collapse to a line that can show their own revision read only,
  instead of redrawing with the newest one, which is where Lemma's history stops being true.
- **One Apps button per task, and one Apps source in the left rail.** Never one rail icon per app.
- **Programs reach Acorn only through host tools:** data sources, row actions, task context, compose,
  and links. Not through every plugin's capabilities.
- **Programs go through tools, not the agent's own file access.** Apps never appear in a task's diff.
- **Editing a project app needs a task,** because sessions belong to tasks.
- **An app that outgrows the language becomes a plugin through a rebuild.** It isn't exported as-is.

## Open questions

- **A whole task to edit an app.** Editing a project app in a new task creates a worktree when the
  session starts. That may be too slow for changing a UI. The options are a lighter task kind with no
  worktree, a session that runs in a scratch folder, or accepting the cost. Phase 3 measures it.
- **The host plugin's name.** "Apps" is the product word, but `apps/` is also the repository's folder of
  runnable programs. Phase 1 picks a code name.
- **The renderer package's name and home.** It could be published unscoped from this repository, or
  offered to OpenUI's repository as its Solid renderer. OpenUI's Vue, Svelte, and Angular renderers
  trail its core by a major version, which argues for keeping it here. Decide after phase 1.
- **Library functions.** OpenUI has no built-in for grouping or joining rows. Phase 0 lists the pure
  functions agents reach for, and phase 1 adds the ones that recur.
- **Dashboard panels first.** If phase 0 finds most apps are single-source tables and charts, an agent
  tool that creates dashboard panels may be the better first slice. See
  [refused](./refused.md#dashboard-panels-as-the-only-answer).
- **Security review.** Phase 1 cannot ship without a review of the interpreter and the tool mapping.
  See [no trust grant](./design.md#no-trust-grant).

## Owning documents this programme extends

Before changing code, read [descriptors, trees, rectangles](../../plugins/ui-tiers.md),
[security](../../security.md), [cooperative extension points](../../plugins/cooperative-extension-points.md),
[data sources](../../data-sources.md), [dashboards](../../dashboards.md), [panes](../../panes.md),
[frontend](../../frontend.md), [workspaces and tasks](../../workspaces-and-tasks.md), and
[published packages](../../plugins/publishing.md). Phase 4 also reads [activation](../../plugins/activation.md).

The UI extension programme shipped other plugins' contributions around files, messages, links, and
detail views on October 10, 2026, and deliberately left apps out. The path it kept open is an outer
companion region that the Apps host reserves. The region binds app identity, revision, placement,
and task or project scope, and mounts each contributor with its own permissions. Regions inside
generated content need an explicit declaration and a separate host-controlled mounting design. Don't
add placeholder app points, grant arbitrary capabilities, or let generated content into chrome.

## Verify before building

Recheck the shipped contracts named above before each phase, and each phase's own verify list. Do not
describe a proposal in this folder as shipped.
