# Project-first workspaces

This plan makes a fresh install project-first. Each project gets its own workspace, the app calls it
a project, and the Default workspace is never created. Read this page before you build a phase. It
holds the research and the decisions the phase files depend on.

Date: October 8, 2026. Status: all six phases implemented; combined validation in progress.

The phase completion notes record the implementation and review decisions. Shipped behavior is
documented in [projects](../../workspaces-and-tasks/projects.md),
[Settings](../../frontend/settings.md), and [terminal chrome](../../tui/chrome.md).
The research below describes the code as it stood when the plan was written on October 7, 2026.

## Goal

People who never group projects end up with every project in the Default workspace. The whole UI is
scoped to a workspace, so their rail, Home, notes, and Agent Center mix every project together.

After this plan:

- A fresh install treats each project as its own scope. The topbar picks a project, and the rail,
  Home, notes, Agent Center, workflows, and Linear and Rollbar links follow it.
- Under the hood, each project has its own workspace. Default is never created and never shown.
- A Node with no projects shows a full-screen prompt to add one.
- The first-run wizard asks whether you want to group projects into workspaces. If you do, you get
  today's behavior.
- Installs that already have projects keep today's behavior.

## Terms

_Workspaces on_ is today's behavior: a workspace groups any number of projects.

_Workspaces off_ means one project per workspace, and the UI says "project" where it said
"workspace". The Node enforces it.

The mode is fixed per Node once it's set. Switching after first run is deferred. See
[refused alternatives](./refused.md).

## Why this works without a second scope

Most of the app is already project-shaped. The URL names a project (`/p/:projectId/...`) or a task
(`/t/:taskId`), never a workspace. `workspaceForProject` in
`packages/client-core/src/features/workspaces/activeWorkspace.ts` derives the active workspace from the
routed project, or from the active task's project.

The workspace widens the scope only in these places:

- The rail lists every task in the workspace (`packages/client-core/src/features/tabs/TabRail.tsx:111`).
- The topbar always shows the workspace picker, and shows the project picker only on project-scoped
  sources: GitHub, workflows, and memory (`apps/desktop/src/client/App.tsx:463`).
- Data the Node stores against a workspace ID:
  - Home dashboards, in `packages/node-core/src/server/dashboards/schema.ts`.
  - Saved queries, in `packages/node-core/src/server/queries/schema.ts`.
  - Workflow definitions, in `plugins/workflows/src/node/schema.ts:97`.
  - Workspace notes, in `plugins/notes/src/shared/api.ts:12`.
  - Linear and Rollbar links, in `workspace_external_projects`.
  - Datasets.
- The Agent Center list filter (`plugins/agents/src/client/center/AgentCenter.tsx:49`).
- The view memory for each workspace, and Cmd+;, which goes back to the last workspace.

A workspace with exactly one project already scopes every one of these to that project. So workspaces
off needs no new scope in any store. It needs a rule that keeps each workspace to one project, and
wording that says "project".

## Facts from the code

These are the facts the phases rely on. Paths are hints, not promises. Check them before you build.

**Where Default comes from.** Nothing at boot creates a workspace. `createProject` falls back to
`defaultWorkspaceId`, which creates Default on first use (`packages/node-core/src/server/projects.ts:155`
and `:182`). `createProjectRef` does the same for deferred GitHub projects (`:334`). The workspace
delete route and `POST /v1/core/workspaces/bootstrap` call `ensureDefault`
(`packages/node-core/src/server/routes/projects/workspaces.ts:93`).

**Every way a project gets created.**

| Caller | Path | Workspace it passes |
| --- | --- | --- |
| Desktop folder picker | `packages/client-core/src/features/workspaces/addProject.ts:21` | The active workspace |
| Settings → Overview | `packages/client-core/src/features/workspaces/WorkspaceProjectAssignments.tsx:85` | None |
| First-run wizard | `plugins/onboarding/src/client/OnboardingWizard.tsx:154` | None, then a patch from the naming step |
| Terminal setup | `apps/tui/src/chrome/Setup.tsx:101` | The one picked in its workspace step |
| GitHub import | `plugins/github/src/server/routes/repos/import.ts:70` | None |
| CLI `project add` | `apps/cli/src/coreWrites.ts:106` | Required `--workspace` |
| Dev seed | `apps/desktop/scripts/agent/seed.ts:77` | None |

**Moving a project.** Settings → Overview can move projects between workspaces (`ProjectTable.tsx:236`,
`patchProject` in `projects.ts:263`). The workspace's own data doesn't follow the project.

**Deleting a workspace.** The delete route (`workspaces.ts:148`) moves the workspace's projects to
Default, deletes its external project links and datasets, and deletes the row. Home dashboards, saved
queries, notes, and workflow definitions stay, pointing at a workspace that no longer exists.

**Deleting a project.** `deleteProject` (`projects.ts:295`) deletes the project row, its tasks, and
its task links. It never touches the disk.

**Preferences.** Prefs are stored per owner on the Node in the `prefs` table
(`packages/node-core/src/server/db/schema.ts:26`). The Node reads them server-side: the telemetry
switch is read through `core.prefs.read` in `apps/node/src/composition/runtime.ts:216`. Clients read
the same rows through `prefsOptions`, as `telemetryOn` does in
`packages/client-core/src/features/settings/telemetrySetting.ts:19`.

**The topbar contract.** `TopbarProps` is a public chrome contract in
`packages/protocol/src/chrome/surfaces.ts:55`. A plugin can replace the topbar
([replacing core surfaces](../../plugins/replacing-core-surfaces.md)), so a change to the props is a
plugin-facing change.

**Plugin access.** Plugins get workspace helpers through `packages/plugin-api/src/client.ts:184`.

**First run.** The wizard is a plugin. `shouldShowOnboarding` in `plugins/onboarding/src/client/gate.ts`
opens it once, when the Node has no projects and the `onboarded` preference is unset. It never opens
again after Finish or Skip, and it isn't there at all when the plugin is off.

## Decisions

Each decision names the code it follows, or says why it's new.

1. **One Node preference holds the mode.** Its key is `core.workspaces`, with the value `on` or `off`.
   A pure function in `packages/protocol` turns the stored value into the mode, so the Node and every
   client use the same rule. This follows the telemetry switch, which is one preference read on both
   sides. The function lives in `protocol` rather than beside `telemetryOn` in `client-core`, because
   the Node needs it too.
2. **The first-run question sets the mode, and the first project is the fallback.** The wizard and the
   terminal setup ask the question and write the preference before any project exists. If the
   preference is still unset when a project is created, the Node writes it in the same transaction:
   `on` if the Node already has projects, `off` if it has none. So installs with projects stay
   grouped, and an install where the wizard was skipped starts project-first. There's no Settings
   toggle.
3. **The Node enforces one project per workspace while workspaces are off.** It answers 409 with the
   code `workspaces_off` and a message that says what to do instead. That applies to creating a
   workspace, moving a project to another workspace, deleting a workspace directly, and creating a
   project with an explicit workspace. `/bootstrap` stops creating Default. This follows the project
   order route, which refuses a stale order with 409 at the route (`workspaces.ts:140`), so every
   client, the CLI, and plugins get the same rule.
4. **A new project gets its own workspace.** While off, creating a project with no workspace creates a
   workspace named after the project, in the same transaction. Renaming the project renames its
   workspace, so every place that prints a workspace name stays right without changes.
5. **Deleting a project deletes its workspace.** While off, project delete also runs today's
   workspace-delete steps: links, datasets, and the row, with no move to Default. Extract those steps
   from the workspace delete route into one function that both routes call. Home dashboards, saved
   queries, notes, and workflow definitions are left behind, the same as a workspace delete today. The
   confirmation says so.
6. **The zero-project screen is core.** It shows in both modes whenever the Node has no projects and
   the wizard isn't open. It can't live in the onboarding plugin, because the wizard opens once and can
   be turned off, so it never sees "you deleted your last project". It fills the window under the
   topbar, so Node switching and Settings stay reachable.
7. **One helper picks the word.** It returns "project" or "workspace" from the mode. It lives in
   `packages/client-core/src/features/workspaces/` and is exported through `plugin-api`, beside the
   workspace helpers plugins already import, so core, first-party plugins, and the terminal client
   share it.
8. **The topbar contract carries the mode.** `TopbarProps` gains it, so a replacement topbar can label
   itself. In a fleet where Nodes have different modes, the label follows the active Node.

## Implementation order

Build the phases in this order. Each file states its dependencies, deliverable, steps, and acceptance
checks, and each one updates the docs for the behavior it changes.

| Phase | Deliverable | Dependencies |
| --- | --- | --- |
| [01: Node switch](./01-node-switch.md) | The mode preference, the creation rule, the refusals, project delete cleanup, the CLI changes, and a seed flag. | None |
| [02: desktop chrome](./02-desktop-chrome.md) | The topbar, folder picker, and Settings follow the mode. | 01 |
| [03: no-projects screen](./03-no-projects-screen.md) | A core full-screen prompt when the Node has no projects. | 01 |
| [04: first-run question](./04-first-run-question.md) | The wizard asks whether to group projects. | 02 |
| [05: wording](./05-wording.md) | Core and first-party plugins say "project" while workspaces are off. | 02 |
| [06: terminal client](./06-terminal-client.md) | The terminal setup, topbar, and zero-project state follow the mode. | 01, 04, 05 |

[Refused alternatives](./refused.md) records what this plan decided not to do, and why.

## Combined acceptance

Run these after phase 06:

1. Start a fresh session with `pnpm dev:agent -- --session pw-off --workspaces off`. The topbar picker
   says **Project**, and no workspace wording appears in the chrome, Settings, or the palette.
2. Add a second project with **Add project…**. It gets its own workspace. Each project has its own
   Home, notes, and Agent Center list.
3. Delete one project. Its workspace is gone from `GET /v1/core/workspaces`.
4. Run `acorn project add --path <folder>` with no `--workspace`. It succeeds. Run
   `acorn workspace create --name Test`. It fails with the `workspaces_off` message.
5. Start a session with `--workspaces on`. Everything behaves as it did before this plan.
6. Start a session with `--onboarding`, answer "group projects", and add two projects. Everything
   behaves as it did before this plan.
7. Repeat steps 1, 2, and 6 in the terminal client with `pnpm dev:tui:agent`.

## Verify before building

- How `createProject` can read an owner preference. Projects are machine-scoped and the function
  takes only the database. Look at `runtime.ACTIVE_IDENTITY`, `ownerId(c)` in the routes, and the
  plugin seam in `packages/node-core/src/server/core/projectRefs.ts`.
- What `Workspace.projects` includes for hidden projects, and how the topbar treats a workspace whose
  only project is hidden.
- Whether the seed's `tui-navigation` fixture already puts each project in its own workspace. Its
  comment at `apps/desktop/scripts/agent/seed.ts:18` says it adds "a second workspace/project".
- Which plugin stores keep a `workspace_id`, beyond the ones listed above. Search `plugins/*/src/node`
  for the column before you write the delete confirmation.
