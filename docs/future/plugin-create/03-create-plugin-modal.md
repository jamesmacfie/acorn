# Phase 3: the Create plugin modal

Date: November 9, 2026. Status: built. Depends on phases 1 and 2. Context:
[the programme README](./README.md).

## Completion note

November 9, 2026.

### What landed

- `CreatePluginDialog.tsx` in `features/settings/plugins/`, with `variant: 'plugin' | 'data-source'`.
  It holds the fields, the step record, and the Start sequence. Both **Create a plugin** buttons open
  it.
- `starterPrompts.ts` holds `pluginStarterPrompt` and `dataSourceStarterPrompt`. The
  `pluginAuthoring.test.ts` text check reads this file now.
- `scaffoldNodePlugin(request, nodeId)` in `infra/node/nodePlugins.ts`, beside `installNodePlugin`. It
  mints its own `Idempotency-Key`. `corePluginScaffoldRoute` sits beside `corePluginInstallRoute` in
  `pluginState.ts`, so no new protocol entry point.
- Removed: `DataSourcePromptDialog.tsx`, `draftForAgent`, the `sendReferenceToAgent` and
  `activeTaskId` imports in `PluginsSettings.tsx`, and the "Open a task first" error.
- Tests: `CreatePluginDialog.test.tsx` has seven cases. They cover the selects and **Choose…**
  showing and hiding, the ID filled from the name, a relative folder, a full run, **Try again**
  after a failed task step (the scaffold is written once), a not-empty folder, and the data source
  draft. `PluginsSettings.test.tsx` checks that each button opens the dialog with its variant.

### Decisions and deviations

- **Settings closes by event, not by navigating.** Settings is a layer over the router in
  `apps/desktop/src/client/App.tsx`, so `navigate()` alone leaves it open. The dialog emits
  `presentation:close-settings` after navigating, as the schedule's **Open** in
  `SchedulesSettings.tsx` does. That's the only "Settings, then open a place" precedent. No other
  client mounts the settings view.
- **The step record.** Once the scaffold is written, the fields it used lock, so **Try again** makes
  the project from the same folder. A created workspace becomes the select's value, so a retry
  doesn't create a second one. The created task is kept. `createProject` runs on every try, because
  it's idempotent for a path that's already a project.
- **"Closed after the scaffold step".** The dialog can't ask the Node whether a non-empty folder holds
  its own scaffold. A module-level set remembers the folders it wrote this session, and the extra
  "add the folder as a project" sentence shows only for those. It's marked as a `shortcut:`, because
  a reload forgets the set.
- **The agents link** goes to `agent-defaults` (**Harnesses and defaults**), the page where a harness
  is installed and signed in. A bare `'agents'` literal also fails the "core never names a plugin"
  boundary check.
- **One Node for the whole sequence.** A settings page's `scope.nodeId` is always the active Node,
  and `createWorkspace` and `createProject` reach only the active Node. The dialog passes the page's
  Node to the scaffold, the catalog, and `createTask`, so all of them agree.
- **A remote Node.** Only **Choose…** depends on a local Node, through `canAddProjectFromFolder()`.
  Everything else goes through the Node's API. A relative path is refused in the dialog, and a
  Windows drive path counts as absolute.
- **Prompts.** Both prompts tell the agent to run `npm install` first, because the scaffold route
  writes files but installs nothing. The plugin prompt names the kind ("a starter pane" or "a starter
  trigger").
- **Kind** is a `SegmentedControl`, since it has two options.
- The "Task context attached" chip from phase 2 shows on the new session too. It wasn't changed.

### Budgets

| Check | Before (phase 2) | After | Ceiling |
| --- | --- | --- | --- |
| Desktop renderer startup scripts | 1,013,316 B | 1,013,468 B | 1,030,000 B |
| Desktop compiled roster | 356,486 B | 356,601 B | 370,000 B |
| Terminal client startup closure | 805,805 B | 805,805 B | 820,000 B |

The startup growth is `scaffoldNodePlugin` and the route constant, which sit in modules already on
the startup path. The dialog is in the Plugins page's lazy chunk.

### Checkpoint

Run on November 9, 2026, in `pnpm dev:agent -- --session p3-create --workspaces on`, driven with
`pnpm dev:agent:ui`.

- **Ask an agent**, with `/tmp/acorn-plugin-test/hello`, the name "Hello", **New workspace…**
  "Plugins", Codex, and git checked. Start landed on the "Hello plugin" task's agent pane with
  Settings closed. The Codex session "Build Hello" was ready for its first turn. Its composer held the
  draft unsent, starting "I want to extend acorn with a plugin" with no `@`, and ending "What it
  should do: ". The top bar read Plugins › Hello › Hello plugin. The folder held `acorn-plugin.json`
  and one commit, "Start Hello from the plugin scaffold".
- **Build a data source from your connections**, with `/tmp/acorn-plugin-test/board`, the row "A task
  with its pull request", and Tasks and GitHub pull requests picked. It landed on "Task board plugin"
  in the Plugins workspace. The draft listed both inputs by ID and ended "The rules for each row: ".
  The folder held the data source starter and one commit.
- **A non-empty folder.** `/tmp/acorn-plugin-test/hello` again gave "That folder has files in it.
  Pick a new or empty folder. To keep it, add the folder as a project in Settings → Workspaces.",
  because this session had written it. `/tmp/acorn-plugin-test` gave only the first two sentences.
  **Start** became **Try again** both times.
- Not walked by hand: a remote Node, the agents plugin turned off, and no startable agent. The unit
  tests cover hiding **Choose…** for a remote Node. The other two states have no test.

The client-core suite passed apart from `src/host/frames/sdk.test.ts` › "posts one message per
verb", which failed once while the desktop build ran alongside it and passed on its own.

### For later phases

- Phase 4: the button descriptions in `PluginsSettings.tsx` changed. "Ask an agent to write one"
  reads "Writes a starter plugin into a folder of its own and opens an agent there. It writes the
  plugin, and you decide whether to install it." The site's Plugins settings page should match.
- `docs/plugins/agent-install.md` § Teaching the agent still describes the old buttons. The comments
  in `starterPrompts.ts` and `PluginsSettings.tsx` cite it.

## Goal

Both buttons in Settings → Plugins → **Create a plugin** open one modal. **Start** writes the
starter files, makes the folder a project, opens a new task there, and leaves the starter prompt
unsent in the composer of an agent session on the chosen agent. The person lands on that task's agent
pane.

## Starting point

- **The buttons** are in `packages/client-core/src/features/settings/plugins/PluginsSettings.tsx`
  (the section starts at line 318).
  - `draftForAgent` (line 218) sends the prompt to the open task with `sendReferenceToAgent`, which
    prefixes it with `@`.
  - `PLUGIN_STARTER_PROMPT` is at line 55 and `dataSourceStarterPrompt` at line 66.
- **The data source dialog** is `DataSourcePromptDialog.tsx`. It asks what one row is (an `Input`)
  and which data sources it reads (a `Checkbox` per row of `dataSourceCatalogOptions(nodeId)`).
- **The sequence to copy** is Trellis's `turnIntoPlugin` (`plugins/trellis/src/client/pluginExport.ts:57`)
  and its dialog (`TurnIntoPlugin.tsx:33`):
  - It falls back on `workspaces_off`.
  - It invalidates the query keys.
  - It ends with `activateTaskSignals`, then `navigate(pathForTask(task))`.
  - Its **Choose…** picks a parent folder and appends the plugin ID.
- **Folder input:**
  - `canAddProjectFromFolder()` and `pickNodeFolder(nodeId)` are in
    `packages/client-core/src/features/workspaces/addProject.ts:12-19`.
  - The picker exists only for a local Node, so a remote Node shows just the typed field.
  - `NodePathForm.tsx` is a submit form, not a field, so the modal uses a plain `Input`, as Trellis
    does.
- **Workspaces:**
  - `createWorkspace(name)` is at `features/workspaces/workspaceMutations.ts:46`.
  - Workspaces mode is read through `features/workspaces/workspacesMode.ts`, and the active workspace
    through `features/workspaces/activeWorkspaceId.ts`.
  - The select with a **New workspace…** option and an inline name field is in `ProjectTable.tsx:363-421`.
- **Projects and tasks:**
  - `createProject` (`workspaceMutations.ts:47`) is idempotent for a path that's already a project
    (`packages/node-core/src/server/projects/projects.ts:299`).
  - `createTask(seed, nodeId)` is at `features/tasks/taskMutations.ts:16`. With no `branch`, the task
    runs in the project folder.
- **Kit:** `Modal` with `Modal.Body` and `Modal.Actions` (`kit/components/overlays/Modal.tsx`), and
  `Field`, `Input`, `Select`, `Checkbox`, `Button`, and `Alert` from `kit/components/primitives`.
- **A test reads `PluginsSettings.tsx`.**
  `packages/node-core/src/server/agentTools/pluginAuthoring.test.ts:284-293` reads that file as text
  and expects it to name `` `plugin_authoring` ``.

## Design

### The modal

`features/settings/plugins/CreatePluginDialog.tsx`, with `variant: 'plugin' | 'data-source'`.

| Field | Shown | Default |
| --- | --- | --- |
| Project name | Always | Empty. Required |
| Plugin ID | Always | Filled from the name (lowercase, dashes), editable. Hint: "It can't change later." |
| Folder | Always. **Choose…** beside it only when `canAddProjectFromFolder()` | Empty. Hint: "A new or empty folder on the Node's computer." |
| Kind | `plugin` variant | **Pane**. The other option is **Trigger** |
| One row is / Which data | `data-source` variant | Moved over from `DataSourcePromptDialog` |
| Workspace | Workspaces on | The active workspace. **New workspace…** reveals a name field |
| Agent | More than one choice | The first choice |
| Make it a git repository | Always | Checked |

**Start** is enabled when the required fields are filled and at least one agent choice exists.

### On Start

The modal keeps a record of finished steps while it's open, so **Try again** resumes:

1. If **New workspace…** is chosen and none was created yet, call `createWorkspace(name)`.
2. If the scaffold wasn't written yet, call the phase 1 route. If the answer has `git.skipped`, show a
   toast with the reason and carry on.
3. Call `createProject({ path: folder, name, workspaceId })`, with Trellis's `workspaces_off` fallback.
4. If no task was created yet, call `createTask({ origin: 'manual', projectId, title: '<name> plugin' }, nodeId)`.
5. Invalidate `projectsKey`, `workspacesKey`, and `tasksOptions(true).queryKey`.
6. Call `AGENT_SESSION_STARTER.start({ taskId, title: 'Build <name>', choiceId, draft })`.
7. Call `activateTaskSignals(task)`, then `navigate(pathForTask(task))`. Leaving the settings route
   closes Settings.

### The draft

Move the two prompts into `features/settings/plugins/starterPrompts.ts` as functions of
`{ folder, pluginId, name, kind }`, and update the path in `pluginAuthoring.test.ts`. Each prompt:

- Says the folder is the plugin's package and that Acorn wrote it from the scaffold.
- Keeps "Call the `plugin_authoring` tool first."
- Names the install call with the real path:
  `plugin_request { action: "install", source: { path: "<folder>" }, dev: true }`.
- For data sources, drops the "start from `npm create acorn-plugin`" step, keeps the row and inputs,
  and ends with "The rules for each row:".
- For the plain button, ends with "What it should do:".

### What goes away

- `draftForAgent` and the `sendReferenceToAgent` import in `PluginsSettings.tsx`. This also removes
  the stray `@`.
- `DataSourcePromptDialog.tsx` and its test, if any.
- The "Open a task first" error.

### States

| Situation | What the person sees |
| --- | --- |
| Agents plugin off (the capability is missing) | **Start** is disabled. Note: "Turn on the Agents plugin to start a session." |
| No startable agent | **Start** is disabled. Note: "Install or sign in to an agent first", linking to Settings → Agents. |
| Relative path | "Use a full path, such as /Users/you/plugins/hello." |
| Folder not empty, on first try | "That folder has files in it. Pick a new or empty folder." |
| Folder not empty because the modal was closed after the scaffold step | The same message, plus "To keep it, add the folder as a project in Settings → Workspaces." |
| A later step fails | An `Alert` names the step and the reason. **Start** becomes **Try again**. |

## Steps

1. Add `starterPrompts.ts` and update the path in `pluginAuthoring.test.ts`.
2. Add `CreatePluginDialog.tsx` with the fields, the step record, and the sequence.
3. Wire both buttons to it in `PluginsSettings.tsx`. Remove `draftForAgent` and
   `DataSourcePromptDialog`.
4. Write tests:
   - Selects are hidden when workspaces are off and when there's one agent.
   - **Choose…** is hidden for a remote Node.
   - **Try again** after a failed task step doesn't call the scaffold route a second time.
   - The draft names the folder and has no leading `@`.
5. Walk it end to end (below) and record the date and result here.

## Acceptance

1. In `pnpm dev:agent`, open Settings → Plugins → **Ask an agent**.
2. Type `/tmp/acorn-plugin-test/hello`, name it "Hello", pick **New workspace…** "Plugins", pick an
   agent, and leave git checked.
3. Click **Start**.
4. Check that the app lands on the new task's agent pane, with the prompt unsent in the composer and
   no `@` prefix.
5. Check that the folder holds `acorn-plugin.json` and one commit, and that the project sits in the
   "Plugins" workspace.

Then:

- Repeat with **Build a data source from your connections**.
- Repeat with a non-empty folder to see the refusal.

## Risks

- **Startup budget.** The modal must load lazily from the Plugins page, as `DataSourcePromptDialog`
  does today, or it lands in the desktop renderer's startup scripts.
- **Navigating away from Settings.** Check that `navigate(pathForTask(task))` closes the settings
  overlay in both the desktop and web clients. If it doesn't, close it explicitly the way other
  settings actions that open a task do.

## Verify before building

- Does a "Settings, then open a task" precedent exist? Search for settings actions that call
  `pathForTask`, and follow it.
- How does the client tell a remote Node from a local one in the modal? `canAddProjectFromFolder()`
  covers the picker. Check that nothing else in the sequence assumes a local Node.
