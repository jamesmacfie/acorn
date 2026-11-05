# Phase 5: run a workflow after a clone

Date: November 6, 2026. Status: proposed. Depends on phases 1 to 3.

## Goal

The clone form can name a workflow. When the clone finishes, the Node creates the project's first
task and starts that workflow on it, whether or not a client is still open. A Node setting names a
default workflow, which the form fills in and you can change or clear for each clone. The motivating
use is a security scan of a repository you don't own.

## Starting point

- **Git history's launch** is the closest flow. The client creates a task at a commit, then starts a
  run through `POST /v1/p/workflows/tasks/:id/workflows` with `{ defId, inputs, launchId }`. A replay
  with the same `launchId` returns the same run ([starting runs](../../workflows/starting-runs.md#from-git-history)).
  The route is in `plugins/workflows/src/server/routes/workflow.ts`, and it calls the bridge's
  `startById`. The client half is `plugins/workflows/src/client/GitLaunchDialog.tsx`, offered to the
  Git plugin as the `WORKFLOW_GIT_LAUNCH` capability (`plugins/workflows/src/contract/gitLaunch.ts`).
- **Triggers create tasks on the Node.** `plugins/workflows/src/server/triggers/occurrences.ts` calls
  `core.tasks.createRoot(projectId, seed, intendedTaskId)`, and core refuses to replay an intended
  task ID with a different seed. That makes a retry safe.
- **Definitions come from three layers**: the project's committed files, `~/.acorn/workflows`, and
  database rows. A repository ID beats a user ID beats a row ID
  ([definitions](../../workflows/definitions.md#database-definitions)). A row with no project can run
  on any task in its workspace.
- **Settings → Workflows** is a Node-scoped page registered in `plugins/workflows/src/client/index.ts`.
- Phase 2 already skips setup and locks agents down on an untrusted project, so the first task needs
  no flags of its own.

## Design

### Who does what

The workflows plugin owns the whole launch on the Node. Core's clone service knows nothing about
workflows, and the plugin boundary stays one-way.

```
client form ──POST──▶ workflows: clone-launch ──▶ core.projects.clone
                                │                   (phase 1 run)
                                ▼
                       core.tasks.createRoot
                                ▼
                       startById(task, defId, inputs, launchId)
```

### The route pair

Device principal only.

`POST /v1/p/workflows/clone-launches` takes `{ clone: { url, parentDir, name?, workspaceId? }, defId,
inputs, launchId }` and answers 202. Before it clones anything, it:

1. Refuses a `defId` that starts with `repo:`. Only `user:` files and database rows are allowed.
2. Resolves the definition and checks `inputs` against it, so a missing input fails before a
   10-minute clone, not after.
3. Checks that a database row can reach the target workspace. With workspaces off, every new project
   gets its own new workspace, so only `user:` definitions can.

Then, in the background:

1. Start a phase 1 clone run with `trusted: false`, and wait on it.
2. Create the root task with `createRoot`, with an intended task ID made when the launch started,
   the title `<workflow name> · first run`, and origin `workflows:clone`.
3. Start the run with `startById` and the caller's `launchId`.

`GET /v1/p/workflows/clone-launches/:launchId?waitMs=20000` answers with the stage
(`cloning`, `starting`, `started`, or `failed`), and `projectId`, `taskId`, and `runId` as each one
exists. A failure names its stage and the Node's message. The record lives in memory for 10 minutes
after it settles, like a clone run.

A second `POST` with the same `launchId` joins a running launch. For a failed one, it retries from
the stage that failed, reusing the project and the intended task ID. A clone that succeeded is never
cloned again.

### The default

Settings → Workflows gets an **After a clone** section with one select: **None** or a workflow from
the eligible list. It stores the definition ID as a Node preference of the workflows plugin. A
default that no longer resolves shows as missing in the select and isn't filled into the form.

### The picker in the clone form

Client-core can't import the workflows plugin. So client-core owns a small capability ID and type for
"a follow-up after a clone", in `packages/client-core/src/features/workspaces/cloneFollowUp.ts` (new),
and the workflows client provides it. With no provider, phase 3's form is unchanged.

When the capability is there, the form shows:

- **Then run.** A workflow select, filled from the default. **None** is always an option.
- The selected workflow's required inputs, drawn the way `StartFromItemHost` draws them.

**Clone** becomes **Clone and run** when a workflow is selected. Pressing it calls the capability,
which posts the launch with a fresh `launchId` and follows it. On `started`, the form calls
`onImported([projectId])` and the client opens the task at `?pane=workflows&item=<runId>`. On
`failed` after the clone, the form shows the message and a **Retry** button that posts the same
`launchId` again.

The select lists only `user:` files and database rows with no project in the target workspace,
without unpublished drafts or definitions with problems, the same filter as the item picker.

### CLI

`acorn project clone` from phase 1 gets `--workflow <defId>` and repeatable `--input name=value`.
With them, it calls the workflows route instead of the core one and prints the task and run IDs.

## Steps

1. Write the launch service and route pair in the workflows plugin, with the three checks.
2. Add the **After a clone** setting.
3. Add the client-core capability, the workflows client's provider, and the picker in the form.
4. Add `--workflow` and `--input` to the CLI command.
5. Update [Starting runs](../../workflows/starting-runs.md) and
   [Projects and workspaces](../../workspaces-and-tasks/projects.md#add-a-project).

## Acceptance

- Route tests: a `repo:` ID is refused before cloning, a missing required input is refused before
  cloning, a row from another workspace is refused, and a replayed `launchId` returns the same run.
- A start that fails after the clone keeps the project and the task, and **Retry** starts the run on
  that same task without cloning again.
- The end-to-end checkpoint below passes and is recorded with the date.

### End-to-end checkpoint

Build a hostile fixture repository. Each item tries to write its own marker file under a temporary
folder:

- `.claude/settings.json` with a `SessionStart` hook.
- `.mcp.json` with a stdio server.
- `CLAUDE.md` and `AGENTS.md` telling the agent to write a marker.
- `.acorn/config.toml` with a setup script and a run target.
- `.acorn/workflows/security-scan.toml`, using the same ID as the user workflow below.
- `package.json` with a `postinstall` script.

Write a user workflow, `~/.acorn/workflows/security-scan.toml`, with one command step that only reads
(`git ls-files`, or `gitleaks` if it's installed) and one Claude agent step that reviews the code for
secrets.

Set it as the **After a clone** default. Clone the fixture through **Clone and run** in `dev:agent`.
Confirm that:

- the task opens on the run pane,
- the run used the user definition, not the repository's,
- the agent step finished, and
- no marker file exists.

Record which markers the agent mentioned seeing. That shows whether the instruction files reached it.

## Risks

- **A workflow can still run the repository's code.** A command step that runs `npm install` or
  `make` runs whatever the repository put there. Untrusted only stops the repository from configuring
  things. It doesn't make your own workflow safe. The **After a clone** section should say: "This runs
  on code you haven't reviewed. Pick a workflow that only reads it."
- **A Node restart mid-launch** loses the record. The project or task may exist, so a retry with the
  same `launchId` fails on the non-empty folder. The client then offers **Open project** instead,
  and the run can start from the task the usual way.
- **The picker's view of eligible workflows can go stale** between opening the form and pressing
  **Clone and run**. The Node's checks in step 1 of the route are what count.

## Verify before building

- That a client-core capability ID, provided by a plugin, passes `tools/arch/boundaries.test.ts`.
  If core may not own one, use a registry like `projectImporterRegistry` instead.
- How a built-in plugin stores a Node-scoped preference, and whether the workflows plugin already has
  one to copy.
