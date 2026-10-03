# Starting runs

This page covers starting a workflow from an integration's row, and the workflows plugin's palette
rows.

<a id="starting-a-run-from-an-item"></a>

## Starting a run

A Rollbar error, a Linear issue and a GitHub pull request each have **Start workflow…** in their row
menu, under **Create task**. It picks a workflow, fills its inputs from the item, makes a task or
attaches to one, starts the run, and lands on the run pane.

The workflow picker excludes unpublished database drafts and definitions with known problems.
Repository and user-file workflows remain available without a database publication. If no runnable
workflows remain, the dialog closes and directs the user to create and publish one in the Workflows rail.

All three menus are the context-menu registry's `item.row` location
([plugins.md](../plugins.md) § Context menus), so this is one contribution rather than three. The
target the row is handed carries the item's `title`, its `body`, a `link` to it, and the provider's
own row untouched.

**What the item fills in.** By input name, in `plugins/workflows/src/client/startFromItem.ts`: an
input named `issue`, `item` or `context` gets the title and the body one blank line apart, and one
named `link` or `url` gets the external link. Every other name is left for the person, because
guessing at `focus` or `depth` from an error title puts words in a prompt nobody chose. The rule is
in the workflows plugin rather than in each integration, so a new tracker gets it for free.

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
