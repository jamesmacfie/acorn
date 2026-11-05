# Clone a project from a Git URL and run a workflow on it

Date: November 6, 2026. Status: in progress. [Phase 1](./01-clone-runs.md) landed November 6, 2026.

## What this is

Today a project reaches a Node in one of two ways. You pick a folder that already exists, or a code
host importer (GitHub, GitLab, or Bitbucket) clones a repository from your account's list. This
programme adds a third way. You paste any Git URL, HTTPS or SSH, and the Node clones it into a folder
you name. You can also pick a workflow that starts as the new project's first task.

The case that shaped the design is a security review of a repository you don't own. You clone it and
a workflow of your own runs scanners and an agent over it before anyone opens the code. That
repository is untrusted. Nothing it ships may run on the Node: no setup script, no committed run
target or workflow, and no agent hook or instruction file.

## Decisions

Taken November 6, 2026, with James:

| Decision | Choice |
| --- | --- |
| Trust for a URL clone | It starts **untrusted**. Agents in it ignore the repository's own settings, hooks, MCP servers, and instruction files until the owner trusts the project. |
| Which workflow runs after a clone | A default from a Node setting, which the clone form fills in. You can change or clear it for each clone. |
| Where the folder goes | The form asks for the parent folder every time. It remembers the last one typed for each Node, as the importers do. |
| The importers | GitHub, GitLab, and Bitbucket move onto the core clone service in this programme, so every clone gets the same URL checks and background progress. |
| Duplicate repositories | No check. Two checkouts of one repository are a fair thing to want, and refusing a non-empty target folder already stops a clash on disk. |
| Who starts the post-clone run | The Node, through a route in the workflows plugin. A client that closes mid-clone can't strand the run, and core never imports a plugin. |

## Rules no phase may break

| Rule | Why |
| --- | --- |
| Core never imports the workflows plugin. The post-clone run is the workflows plugin calling core, not the reverse. | The plugin boundary checks in `tools/arch/boundaries.test.ts`. |
| A clone route accepts only a device principal. Task and service tokens are refused. | An agent with a task token must not be able to fetch code onto the Node. |
| An untrusted project runs nothing its repository ships, on any path: task setup, run targets, committed workflows, agent settings, agent hooks, and project MCP servers. | That is the whole promise of the security-scan case. One missed path breaks it. |
| A harness that can't be locked down is refused on an untrusted project, with a reason. It never starts open. | The same rule [keeping agents out of the data folder](../../managed-agents/read-block.md) uses for harnesses that can't block a path. |
| Existing projects, folder adds, and importer clones keep working exactly as they do today, and stay trusted. | The trust value is additive. |
| `/v1` routes don't change meaning in place. New behavior is new routes or new optional fields. | Older clients keep working ([versioning](../../api-reference/versioning.md)). |
| The post-clone picker never offers a workflow committed in the cloned repository, and the run names its definition by explicit ID. | A repository workflow beats a user one with the same ID ([definitions](../../workflows/definitions.md#database-definitions)), so a hostile repository could otherwise replace your scan. |

## The phases

| Phase | What it delivers | Depends on |
| --- | --- | --- |
| [1. Clone runs](./01-clone-runs.md) | A core service that clones a URL in the background, with URL checks, a route pair, a plugin facet, and a CLI command | Nothing |
| [2. Project trust](./02-project-trust.md) | A trust value on each project, enforced on setup, committed config, committed workflows, and every agent launch path | Phase 1 for the first untrusted rows, though it can land first |
| [3. Clone from URL](./03-clone-from-url.md) | The **Clone from URL** control on the empty Node screen and Settings, in the desktop and terminal clients | Phases 1 and 2 |
| [4. Importers](./04-importers.md) | GitHub, GitLab, and Bitbucket clone through phase 1 and show progress | Phase 1 |
| [5. Run after clone](./05-run-after-clone.md) | The default post-clone workflow, the picker in the clone form, the Node route that clones and then starts the run, and the end-to-end check | Phases 1 to 3 |

Phase 3 must not ship before phase 2. Without trust, a URL clone is an ordinary project, and an agent
in it would load the repository's hooks.

## Owning documents to update

When a phase ships a contract, update its owning page in the same change:

| Contract | Owning page |
| --- | --- |
| Adding a project, the clone form, trust | [Projects and workspaces](../../workspaces-and-tasks/projects.md) |
| What the committed config can do in an untrusted project | [Project configuration](../../workspaces-and-tasks/project-config.md) |
| The clone route pair | [Archive in the background](../../workspaces-and-tasks/background-archive.md) is the pattern. Add the clone routes beside the project routes in the API reference. |
| The CLI command | [Workspaces, projects, and tasks](../../cli/workspaces-projects-tasks.md) |
| Agent lock-down per harness | [Harnesses](../../managed-agents/harnesses.md) and [security diagnostics](../../security/security-diagnostics.md) |
| Importer clones | [GitHub integration](../../github-integration.md) |
| Post-clone runs | [Starting runs](../../workflows/starting-runs.md) |

## Rules for the work

- Run `pnpm lint` and the tests for each package you touch, and `pnpm test` before a phase is done.
- Each phase ends with a checkpoint someone runs by hand and records, with the date, in the phase
  file. A skipped checkpoint is written down as skipped, with the reason.
- Settle each phase's **Verify before building** items before writing its code, and record the answer
  in the phase file.
- When a phase lands, cut its file down to what is left, as [remote-access](../remote-access/README.md)
  did, and point at the owning pages.
