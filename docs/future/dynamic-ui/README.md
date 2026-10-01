# Agent-built apps

Status: proposed, 2026-10-01. Nothing in this programme is built or scheduled. Where a file here
disagrees with a shipped contract, the owning reference document wins until the implementation
changes that contract.

## What this is

An agent builds a small UI for the task it is working on, drawn in the host's own components. The app
appears inline in the conversation, opens full size in the task's Apps pane, changes when the owner
asks for changes, and archives with the task. A useful one is published to the project, where it opens
from the left rail and can be edited through a draft in any task. One that grows into a product exports
as an ordinary plugin.

It comes from studying how Lemma generates widgets and apps, and from noticing that Acorn already
shipped the hard parts for other reasons: the sandboxed tree tier, dev mode, the transcript tool card,
the embeddable conversation, and typed data sources. For the study, read [research](./research.md).

## Read this programme

| File | What it covers |
| --- | --- |
| [design.md](./design.md) | The model: one package identity, placements, the tools, validation, revisions, remixing, what an app can reach, trust, lifecycle, export, the terminal, cost, and security. |
| [research.md](./research.md) | What Lemma does and what it costs, which Acorn seams exist, and what is missing. |
| [refused.md](./refused.md) | What this programme decided not to build, and when to revisit it. |
| [00-spike.md](./00-spike.md) | Phase 0. Can an agent write a useful tree? Throwaway work that decides whether to go on. |
| [01-inline-cards.md](./01-inline-cards.md) | Phase 1. Task apps shown as cards, with tools, validation, revisions, and app trust. |
| [02-task-pane.md](./02-task-pane.md) | Phase 2. The task Apps pane, the editing drawer, app state, and archive. |
| [03-project-apps.md](./03-project-apps.md) | Phase 3. Publish to the project, the left-rail source, drafts, forks, and deletion. |
| [04-export.md](./04-export.md) | Phase 4. Export an app as a plugin, with its dependencies declared. |
| [05-teams.md](./05-teams.md) | Phase 5. Apps on a team Node, per-device trust, and roles. Waits on the cloud programme. |

## The phases at a glance

| Phase | What the owner gets at the end | Depends on |
| --- | --- | --- |
| 0 | A measured answer to whether agents write useful kit trees, and answers to three plumbing questions. Nothing ships. | Nothing. |
| 1 | "Build me a view of X" produces a card in the conversation, and "change it" produces the next revision. | A **Go** from 0. |
| 2 | An Apps button in the task's right rail, editing beside the app, apps that remember, and apps that archive and restore with the task. | 1. |
| 3 | Apps published to the project, opened from the left rail, and edited through drafts. | 2. |
| 4 | An app exported as a plugin package with `requires.plugins` filled in. | 3. |
| 5 | Project apps shared by a team, with roles and per-device trust. | 4, and [cloud phase 9](../cloud/phases/09-teams.md). |

## The decisions that shape it

These are argued in [design.md](./design.md). They are listed here because each one closes off an
alternative a reader might expect.

- **An app is a plugin package from birth.** Promotion and export change ownership, not format.
- **Cards pin revisions.** Older cards collapse to a line with **Restore** instead of redrawing with
  newer code, which is where Lemma's history stops being true.
- **One Apps button per task, and one Apps source in the left rail.** Never one rail icon per app.
- **Apps reach other plugins through declared data sources, row actions, task context, and compose.**
  Not through every plugin's capabilities.
- **No node half, network, or secrets in an app.** That is the argument for app trust, which lets apps
  run without a prompt per revision.
- **Files through tools, not the agent's own file access.** Apps never appear in a task's diff.
- **Editing a project app needs a task,** because sessions belong to tasks.

## Open questions

- **A whole task to edit an app.** Editing a project app in a new task creates a worktree when the
  session starts. That may be too slow for changing a UI. The options are a lighter task kind with no
  worktree, a session that runs in a scratch folder, or accepting the cost. Phase 3 measures it.
- **The host plugin's name.** "Apps" is the product word, but `apps/` is also the repository's folder of
  runnable programs. Phase 1 picks a code name.
- **Dashboard panels first.** If phase 0 finds most apps are single-source tables and charts, an agent
  tool that creates dashboard panels may be the better first slice. See
  [refused](./refused.md#dashboard-panels-as-the-only-answer).
- **App trust review.** The grant waives per-revision prompts for a narrow profile. Phase 1 cannot ship
  without a security review of that argument.

## Owning documents this programme extends

Before changing code, read [descriptors, trees, rectangles](../../plugins/descriptors-for-facts-trees-for-ui-rectangles-for-pixels.md),
[activation](../../plugins/activation.md), [security](../../security.md),
[cooperative extension points](../../plugins/cooperative-extension-points.md),
[data sources](../../data-sources.md), [dashboards](../../dashboards.md), [panes](../../panes.md),
[frontend](../../frontend.md), and [workspaces and tasks](../../workspaces-and-tasks.md).

## Verify before building

Recheck the shipped contracts named above before each phase, and each phase's own verify list. Do not
describe a proposal in this folder as shipped.
