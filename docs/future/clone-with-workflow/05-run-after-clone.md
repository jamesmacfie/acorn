# Phase 5: run a workflow after a clone

Date: November 6, 2026. Status: landed, except the checkpoint. Depends on phases 1 to 3.

## Completion note

November 6, 2026. **Clone from URL** can start a workflow as the new project's first task, and the
Node does the whole launch. [Starting runs](../../workflows/starting-runs.md#after-a-clone) owns the
contract. [Clone a Git URL](../../workspaces-and-tasks/clone-runs.md#clone-from-url), [Projects and
workspaces](../../workspaces-and-tasks/projects.md#add-a-project), and the CLI page point at it.

What landed:

- `plugins/workflows/src/server/runs/cloneLaunch.ts`, behind `lazyRouter` at `/clone-launches`
  (`server/routes/cloneLaunches.ts`). `POST /v1/p/workflows/clone-launches` answers 202,
  `GET .../:launchId?waitMs=` follows the launch, and `GET .../workflows?workspaceId=` lists what the
  form may offer. All three are device only. Records live in memory for 10 minutes after they settle.
- The checks before cloning: a `repo:` ID, a saved definition with no named workspace, one from another
  workspace, one bound to a project, an unpublished or broken one, and missing or unknown inputs. Core's
  URL and folder refusals come back as 400s too.
- The background run clones with `trusted: false`, calls `createRoot` with a task ID made when the
  launch started, the title `<workflow name> · first run`, and origin `workflows:clone`, then calls
  `startById` with the caller's `launchId`. A replayed `launchId` with the same body joins. A different
  body gets 409. A failed launch retries from the stage that failed, reusing the project and task.
  Posts with one launch ID are admitted one after another, so two at once can't clone twice.
- `trusted?: false` on the plugin facet's `ProjectCloneInput`. A plugin can only lower trust.
- `CLONE_FOLLOW_UP` in `packages/client-core/src/features/workspaces/cloneFollowUp.ts`, re-exported from
  `@acorn/plugin-api/client`. The workflows client provides a lazy **Then run** picker
  (`client/CloneLaunchPicker.tsx`). The desktop form and the terminal client's clone step draw it under
  **Folder name**. The submit button reads **Clone and run**, then **Retry** after a failed start.
- Settings → Workflows → **After a clone**, stored in the Node pref `workflows_clone_default`
  (`PrefKeys.workflowsCloneDefault`). A default that no longer resolves shows as missing and isn't
  filled in.
- `acorn project clone URL --into ABSOLUTE --workflow ID [--inputs-file FILE|-]`.
- Site pages updated and marked checked: start-and-schedule-runs, workspaces-and-projects, and
  settings/automation.

Decisions and deviations:

- **`--inputs-file`, not repeatable `--input name=value`.** The CLI's parser holds one value per
  option, and `workflow start` already takes inputs this way, typed values included.
- **A saved definition needs a named workspace.** Without a `workspaceId` the Node can't tell where the
  project lands, so the route allows only `user:` files. The client fills in the Default workspace on a
  Node that groups projects, so saved definitions still work from the desktop. A Node with workspaces
  off offers only files.
- **The picker owns its list route.** `defsList` needs a workspace and includes committed files, so the
  Node lists the eligible definitions itself, with the same rule the POST checks.
- **The CLI's idempotency key is fresh on each run.** With `--request-id` as the key, the Node would
  answer a retry from its idempotency cache instead of resuming the launch. The launch ID makes a repeat
  safe on its own.
- **A restart answers 404.** The form says the Node lost the launch and to start the workflow from the
  project's task. It doesn't offer **Open project**, because the record that knew the project is gone.
- **No frame table entry.** Plugin routes aren't in the frame table, so the new routes need no
  classification there.
- `boundedValues` moved out of `startBody` in `server/routes/workflow.ts`, so both routes parse inputs
  the same way.
- client-core's entrypoint cap went from 219 to 220 for `cloneFollowUp.ts`.

Verify before building, answered:

- A client-core capability ID provided by a plugin passes `tools/arch/boundaries.test.ts`.
  `changeRequestLinesId` already works that way, and the arch suite passed with the new key.
- A built-in plugin stores a Node preference through `savePref` with a key in `PrefKeys` that isn't a
  device key, as `startupContextInjection` does. The workflows plugin had none to copy.

Checkpoint: skipped. `pnpm dev:agent` builds the Node service, and that build fails the boot budget,
so the hostile-fixture walk couldn't run. Route and service tests cover the refusals, replay, and
retry. Run it once the ceiling is raised.

Bundle sizes:

- The Node service boot graph is 1,948,993 bytes, 700 over the 1,948,293 base and 1,993 over the
  1,947,000 ceiling. The bytes are the lazy route's registration. The service and routes load on the
  first request.
- The desktop renderer's startup scripts are 1,013,051 bytes, 248 over phase 3's 1,012,803, under the
  1,030,000 ceiling. The picker and the settings section load lazily.
- The terminal client's startup closure is 805,544 bytes, 176 over phase 3's 805,368, under the
  820,000 ceiling.
- No stylesheet changed.

For later phases:

- A launch path that creates a task and starts a run must keep naming its definition by explicit ID.
  `startById` with a bare name resolves a database row, and a `repo:` name would load the cloned
  repository's file.
- `StartFromItemHost` passes a file's bare ID to `startWorkflow`, which resolves it as a database row.
  That is outside this phase and wasn't changed.


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
