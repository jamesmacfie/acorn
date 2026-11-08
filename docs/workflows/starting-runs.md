# Starting runs

This page covers starting a workflow from an integration's row, from Git history, from the
workflows plugin's palette rows, and from an agent.

## Starting a run

A Rollbar error, a Linear issue and a GitHub pull request each have **Start workflow…** in their row
menu, under **Create task**. It picks a workflow, fills its inputs from the item, makes a task or
attaches to one, starts the run, and lands on the run pane.

The workflow picker lists workflows in the order saved in the Workflows rail
([workflow order](./routes-and-ui.md#workflow-order)), and selects the first one it can run. **Start workflow
here** in Git history uses the same order and default. Both read the order when they open.
The workflow picker excludes unpublished database drafts and definitions with known problems.
Repository and user-file workflows remain available without a database publication. If no runnable
workflows remain, the dialog closes and directs the user to create and publish one in the Workflows rail.

All three menus are the context-menu registry's `item.row` location
([plugins.md](../plugins.md) § Context menus), so this is one contribution rather than three. The
target the row is handed carries the item's `title`, its `body`, a `link` to it, and the provider's
own row untouched.

**What the item fills in.** By input name, in `prefillFromItem` in
`plugins/workflows/src/contract/itemInputs.ts`. A row that carries a typed record fills `record` with
its envelope (`ref`, `data`, and `display`), `item` with the record's data, `issue` and `context` with
its display title, and `link` and `url` with its display link. A row without a record fills `issue`,
`item`, and `context` with the title and the body one blank line apart, and `link` and `url` with the
external link. Every other name is left for the person, because guessing at `focus` or `depth` from an
error title puts words in a prompt nobody chose. The rule is in the workflows plugin rather than in
each integration, so a new tracker gets it for free. A record trigger fills a run's inputs by the same
rule, after its own bindings ([record triggers](./triggers.md#record-triggers)).

Where the body comes from is each tracker's own answer, and none of them makes a second call to fill
a menu nobody opened. Linear asks for the issue description on the list query and caps it at 2,000
characters. Rollbar's list carries no prose at all, because an item's body is its stack trace, so its rows
send the facts they already have: level, environment, occurrence count, and the permalink. GitHub
sends the pull's body when the row's detail is already warmed, and the title alone when it is not.

**The box** is the shared promote-to-task modal
(`packages/client-core/src/features/integrations/PromoteToTaskModal.tsx`). Workflows'
`StartFromItemHost` supplies the picker, editable typed inputs, readiness rule, and **run** action.
The modal supplies the **New task** and **Attach to task** tabs through the source's registered
`promotion`. Its primary button reads **Create & run** or **Attach & run** and is disabled while a
required input is empty. A failed workflow start keeps the created or attached task for retry, so
the next press starts on that same task. Starting the run uses the same route as the editor's **Run**
and the palette. On success the modal closes and the task opens at
`?pane=workflows&item=<runId>`.

The modal is drawn in the shell's `overlay` slot, because the list the row sits on belongs to
somebody else. The terminal client mounts no overlay slot and its descriptor source panel draws no row
menu, so this flow is desktop-only for now ([tui.md](../tui/plugin-losses.md) § What a plugin loses here).

## From Git history

Git commit and local branch-tip menus capture the full commit ID before opening a launch form.
Workflows provides the definition picker and typed required inputs through its client capability;
Git holds only the pinned launch request. The form creates a task branch from that commit through
Core, then starts the selected workflow through the normal start route. The form retains one launch
identity across retries, including a lost response or a delayed trust approval. The device start
route accepts this `launchId` UUID and binds it to the task, definition, and inputs; replay returns
the same run, while changed payload returns a conflict. If start fails, Workflows retains the task
ID and input values for retry on the same task. Dismissal or a Node/project switch stops a pending
task response from starting a workflow or navigating. A task or run that was already created remains
available when the same pinned launch is reopened. **Open task** leaves the failed run attempt
without creating another task. Disabling Workflows removes the launch capability, and Git reports
that the action is unavailable. Both desktop and terminal render the owner-provided form. Loading
and read failures remain visible in that form, with retry and close actions.

The selected definition and effective input values freeze when Submit is pressed, before task
creation completes. Core retains the repository identity seen in the original pinned-commit preview
and checks it again before each workflow start or retry; a project remap preserves the task and
inputs but refuses the run. An uncertain start keeps its launch ID across dismissal and reopening.
After a run is opened, the launch is complete, so selecting **Start workflow here** again begins a
new task and run at the same commit.

## After a clone

[Clone from URL](../workspaces-and-tasks/clone-runs.md#clone-from-url) can start a workflow as the
new project's first task. The Node does the whole launch, so the run starts whether or not a client
is still open. The motivating case is a security scan of a repository you don't own, so the rules
assume the repository is hostile.

The clone form shows **Then run** under the folder name when the workflows plugin is on. It offers
**None**, the files in `~/.acorn/workflows`, and the published rows of the target workspace that
belong to no project, without definitions with problems. It never offers a file committed in a
repository: a repository's ID beats a user's ([definitions](./definitions.md#database-definitions)),
so a hostile repository could otherwise replace your scan. The target workspace is the one the form
names, or Default on a Node that groups projects. A Node with workspaces off gives each new project a
new workspace, so only files are offered there. The selected workflow's inputs appear under it, and
**Clone** becomes **Clone and run**. Client-core owns the capability key, `CLONE_FOLLOW_UP` in
`packages/client-core/src/features/workspaces/cloneFollowUp.ts`, and the workflows client provides the
picker, so core never imports the plugin.

Settings → Workflows → **After a clone** sets the default the form fills in. It stores a definition
ID in the Node preference `workflows_clone_default`. A default that no longer resolves shows as
missing there and isn't filled in. The section says the warning that matters: a workflow can still
run the repository's code. A command step that runs `npm install` or `make` runs whatever the
repository put there, so pick a workflow that only reads it.

`POST /v1/p/workflows/clone-launches` takes `{ clone: { url, parentDir, name?, workspaceId? }, defId,
inputs?, launchId }` and answers 202 with the launch. Before it clones anything, it refuses a `repo:`
definition, a saved definition with no named workspace, one from another workspace, and one bound to
a project. It resolves the definition and checks the inputs against it, so a missing input fails
before a long clone. Core's URL and folder checks run then too. Each refusal is a 400 with the reason.
Then, in the background, the Node clones the URL as an [untrusted](../workspaces-and-tasks/projects.md#untrusted-projects)
project, creates the root task `<workflow name> · first run` with origin `workflows:clone`, and starts
the run with `launchId` as its launch ID.

`GET /v1/p/workflows/clone-launches/:launchId?waitMs=20000` holds for up to 20 seconds and answers
`{ launchId, stage, projectId?, taskId?, runId?, failedAt?, error? }`. `stage` is `cloning`,
`starting`, `started`, or `failed`, and `failedAt` says which stage failed. A 404 means the Node holds
no record: a wrong ID, a restart since, or a launch that settled more than 10 minutes ago.
`GET /v1/p/workflows/clone-launches/workflows?workspaceId=` lists what the form may offer. All three
routes are device only, as core's clone routes are. The code is
`plugins/workflows/src/server/runs/cloneLaunch.ts`, loaded on the first request.

A second `POST` with the same `launchId` and the same body joins the launch. A different body gets a
409. For a failed launch it retries from the stage that failed: a failed clone clones again, and a
failed start reuses the project and the task the launch made, so a clone that finished is never
cloned again. On **Clone and run**, the client opens the task on the run pane. On a failure after the
clone, the form shows the message and **Retry**, which posts the same launch again. A Node restart
mid-launch loses the record. The project or the task may already exist, and the run can start from
the task the usual way.

The CLI's `acorn project clone URL --into ABSOLUTE --workflow ID [--inputs-file FILE|-]` does the
same and prints the project, task, and run IDs. Its `--request-id` is the launch ID, so running it
again with the same one retries a failed start.

## From the command palette

Three rows at the palette root, all registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). **New workflow** is project-scoped: it creates a row
bound to the routed project and opens the editor on it, which is the rail toolbar's verb reached
from ⌘K.

**Find a run** is a task-scoped `search` over this task's runs, newest first, each row naming its
status and how long ago it started. Picking one opens the run pane at it. The row waited for the pane
to exist: a search whose result cannot say where it goes is worse than no search.

**Run a workflow**, registered by this plugin's client half
(`plugins/workflows/src/client/commands.ts`). It is a `search` over every definition the task can
run, which is its repository's committed files, `~/.acorn/workflows`, and this workspace's rows: a
row carries the workflow's name, its step count and its layer, a parse or cycle error is a badged row
at the top of the list rather than a row that is quietly missing, and picking a definition starts it.
There is no group, because one row does not need one.
[command-palette-and-shortcuts.md](../command-palette-and-shortcuts.md) covers how the palette runs a
search, and [plugins.md](../plugins.md) § Command kinds holds the vocabulary.

The command is task-scoped and gated on the terminal plugin, because the runner is a node engine and
these routes answer 503 on a node that does not run terminals. Definitions load once when the frame
opens and are filtered on the device after that, through the same load-once adapter the terminal's
searches use (`client-core/host/registries/commands/localSearch.ts`): no debounce and no minimum
query, because a read of the repository is not something a keystroke moves. Starting sends the id
rather than the definition, so the node resolves it and, for a committed file, hashes the bytes on
disk instead of trusting what the request carried. A refusal keeps the frame open with the node's own
message on it.

A definition that declares a required input with no default opens the start dialog instead of
starting, so nothing runs with an empty input (§ Authoring). The rail goes to Workflows first,
because the dialog is mounted once, in that source's list region, and one mount is what keeps the
editor's **Run** and this row from putting two of them on screen.

A gate with a form keeps its **Approve** beside the values, and disables it while any value fails the
check the node runs, with a line naming each problem. Edits are held per step while the app is open
and saved nowhere, so closing the app loses them and the proposal remains. When another device
answered first, the pane shows "This gate was already answered." and refetches the node. For the
form's contract, see [Workflow execution](./execution.md#human-gates).

Approving a gate, cancelling a run and killing one stay in the run surface. Each needs the run's
status and its consequences in front of the person doing it, and a row in a list carries neither.

## From an agent

A managed agent starts a published workflow with `workflow_run` when you've approved it for agents in
that project. Open the workflow, choose **Agent invocation…** from its overflow menu, and pick the
inputs agents may set, the limits, and the starts each session gets. The run's start reason is
`agent-tool`. It starts after the agent's current turn ends, and the run pane names the agent that
started it. [Workflow tools](../agent-tools/workflow-tools.md#invocation-authority) covers the checks
and the handoff.
