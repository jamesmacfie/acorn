# Workflow checks

Run these checks when changing workflow authoring, execution, children, schedules, or data sources.
The numbers retain their original acceptance-check IDs.

## Authoring and the run pane

The next six are the workflow editor's and the run pane's, owed since each shipped and **not yet
run**. The draft rules have a unit suite, the inspector and the run pane have jsdom ones, and none of
them can see what a person building and watching the owner's first workflow actually goes through.
Run them on the desktop and in `acorn` in a terminal.

48. Open Workflows in the left rail with a project chosen. Press **+ New**, then build the owner's
    first workflow from the empty definition using only the editor: two agent nodes with no
    predecessor, a `terminal:command` node, a third agent node waiting on both investigators, and a
    human gate after it. Declare an input, put it in a prompt from the chip row, and rename one of the
    investigators. Every reference to the old name follows it, and the footer reads valid. Press
    **Save**, reload the surface, and the same nodes come back.
49. From the same definition, press **Save to repo** on a task with a checkout. The file appears at
    `.acorn/workflows/<slug>.toml` in that worktree. Open it from the rail: it draws the same nodes
    read-only, with **Make an editable copy** where Save was. Start a run from it and the repo trust prompt
    appears, because the snapshot now covers the file.
50. Press **Run** in the editor. The dialog asks for the declared input and for a task, refuses to
    confirm until the required one is filled, and starts the run. Then run the same definition from
    ⌘K → **Run a workflow**: it opens the same dialog rather than starting with an empty input. In the
    terminal client, the definition list is in the Browse panel, the editor is in the main one with
    its node list beside its inspector, and the dialog is a modal the keys stay inside.
51. Start that run on a task and open the **Workflows** pane on it. Both investigators show running at
    once, with the same indentation the editor drew. Select one, while it is still working: its
    transcript is here, following the newest turn, with the node's toolbar staying put above it and the
    composer staying put below. The composer says a turn sent now runs after the step. The command
    node's output tails as it runs and folds away with its exit code when it stops.
    Then press **Show in Agent pane** and put the two panes side by side on that session: both
    transcripts move together, a file attached in one appears in the other, and the "Workflow: …" chip
    in the Agent pane's header comes back to this pane at that node. Last, run one with child dispatch or a
    worktree-isolated agent step and check the conversation you get is the child task's.
52. Let the run reach the gate. The bell rings, and the row in it lands on the gate node with Approve
    and Reject in front of you; the inbox has the same row and it stays there until you answer.
    Approve, and the run finishes and keeps a notice.
53. Make one node fail, by pointing its command at something that exits non-zero. The pane offers
    **Retry**, and an agent node also offers **Edit prompt and retry**; both put the run back to
    running from that node. Then check the pane is not there at all on a task that has never run a
    workflow, and that the agents pane draws no workflow step rows anywhere. In **Agent Center**, the
    workflow session's row carries a **Run** chip: the row body opens the session and the chip opens
    the run at that node.

The next two are the start-from-an-item flow's ([workflows.md](../workflows.md) § Starting a run).
Three lists moved onto one registry, and the only way to see that they still offer what they used to
is to open all three menus.

54. Open the row menu on a Rollbar error, a Linear issue and a GitHub pull request. Each has **Create
    task** at the top doing exactly what it did before — a Rollbar row opens the promote modal, a
    pull makes or finds the pull's task with its Linear links — and **Start workflow…** under it. On a
    row with nothing to promote, and on a source whose click already makes a task, no menu appears at
    all.
55. Press **Start workflow…** on a Rollbar error. Pick the owner's first workflow: the `issue` input
    arrives filled with the error's title and its facts, editable, and the button reads **Create &
    run** and refuses while a required input is empty. Press it; the task opens on the Workflows pane
    with both investigators running. Do the same from a pull request that already has a task: it runs
    on that task rather than making a second one.

Next is the graph view's ([ui-design.md](../ui-design.md) § The closed kit). A canvas is the one kit
node whose whole point is what it looks like, so a suite can check the geometry and nothing else.

56. Open the owner's first workflow and press **Graph**. It draws two roots joining into the
    synthesis node, with the list column still beside it. Drag a card: it lands on the grid and its
    wires follow. Drag from one card's bottom port onto another: the second now waits on the first,
    and the footer agrees. Press the `×` on that wire and it goes. Select a card and press Backspace:
    it is removed, and the same edit is in the JSON tab. Reload the surface and the cards are where
    you left them. Then start a run and press **Graph** in the pane's Runs header: a card recolours
    as its step starts and finishes. In the terminal client, both **Graph** views are the indented
    list, the arrows walk the cards, and the editor's has a picker under it that draws an edge out of
    the selected card.

Next is the editor's **Generate** button
([workflows.md](../workflows.md) § Generating one from a description). A pure suite pins the prompt
and drives the reader from a table, and neither can see whether the teaching worked on a real model.

57. With nothing to generate with, no key and no agent CLI, the editor toolbar has no **Generate**
    between the tab strip and **Undo**. Add one in Settings, under AI models, reopen a workflow
    row, and press it.
    Describe the owner's first workflow in words: two agents investigate one issue from different
    angles at the same time, a third reads both and writes the synthesis, and somebody approves
    before anything is pushed. The dialog counts seconds while it works, and a couple of minutes is
    normal. What lands has two roots, a step whose `after` names both of them, and a human gate.
    That is the check the rest of the item hangs off: a straight chain of five steps means the prompt
    failed to teach the graph. Read the footer, press **Save**, then **Run**, and watch it
    in the run pane. Press **Undo** once and the draft you had comes back whole. Then generate again
    from a description that asks for a `code-review` step kind, which no node has: the definition
    still applies, and the alert above the node list says what was taken out of it. Last, open a
    committed file from the rail and confirm there is no **Generate** on that toolbar at all.

## Child workflow state

The next five items are the workflow-task release checks. They were not run in this worktree because
the app requires the main checkout's environment and port. The workflow, integration, and host tests
cover the corresponding state and rendering contracts.

65. Run a workflow whose child stops at a human gate. Confirm the parent is gated, the child card says
    approval is required, and opening it lands on the child gate. Approve it, then use the child
    run's parent and root links to return to the original run.
66. Map three structured items so one child succeeds, one fails, and one waits for approval. Confirm
    the progress and failure counts update, every task and run link opens the right child, and the
    parent waits for all three before failing. Check each bounded result and compare the root's tree
    usage with each child's own usage.
67. Cancel a running mapped workflow and confirm the dialog says it cancels the run tree. Check that
    admitted child runs and managed sessions settle before the parent does, while the child tasks
    remain available. Retry a failed map and confirm it reuses those tasks and runs instead of
    creating replacements.
68. Disconnect the active Node while viewing a parent and child, let both advance, then reconnect.
    Confirm the run list, selected steps, child progress, gates, failures, and usage reconcile without
    relying on the missed frames.
69. On two Nodes, create fixtures with the same task and run IDs and different titles. Switch between
    the Nodes and confirm navigation and history stay with the active Node. Then run one mapped child
    workflow and one static inline workflow reference to confirm both behave as
    documented.

## Provider-backed schedules and queries

The next six are workflow v2's release checks ([workflows.md](../workflows.md) § Typed data and
conditions, § Record processing history, § Scheduled roots). Controlled provider fixtures cover them
in the suites, but they need connected GitHub, Linear, and Rollbar test accounts and a configured
model provider, and none had been run against real accounts when the programme shipped. Build each of
the first four by hand, then again through **Generate**, and compare the resolved queries and
bindings rather than the prose.

73. Query open pull requests by one author in a real repository and preview them. Publish Find records
    → For each → a review workflow. A closed pull request is left out whatever its merge readiness,
    numbers stay numbers in the bindings, and each selected pull request gets one child task.
74. Query Linear issues by project, exact state, and **Updated in last 24 hours**. The child fetches
    details, sets a typed **Requires work** boolean, and starts an analysis grandchild only when it is
    true. A false value creates no task and is not a failure.
75. Query Rollbar error groups first seen since midnight in a named timezone. An older group with a
    fresh occurrence is left out. Each child fetches the stack trace through **Get record details**.
76. Save one of those queries, then use it from a workflow and a dashboard panel. Editing the panel's
    display changes no source state. Publishing a change to the shared query updates the panel and
    marks the workflow's schedule for review.
77. Schedule the Linear workflow with **Start tracking from now**. After an issue changes, the next
    check starts one child for it, the record history links its task and run, and **Run now** during
    an active run is skipped with a link to that run.
78. Build and schedule a workflow using only the keyboard in the desktop window: open the editor, pick
    fields, publish, and activate the schedule. Focus stays visible and returns to its trigger when
    each dialog closes.

## Dashboard checks

The dashboards backlog keeps its own once-only verification pass in
[docs/future/dashboards/README.md](../future/dashboards/README.md) § 0, because its items gate that
folder's remaining work rather than a release.

Workflow-v2 dashboard checks are split by owner:
`packages/dashboards-core/src/typedProjection.test.ts` covers nested projection and independent exact-status mappings;
`packages/node-core/src/server/dashboards/*.test.ts`
uses migrated temporary SQLite stores for revision and publication behavior; and
`packages/client-core/src/features/dashboards/dashboardEditorModel.test.ts` plus `dashboardRecovery.test.ts`
cover local display semantics and device recovery. Real-window checks still exercise the composed
editor and placement because those interactions are not proved by pure tests.
