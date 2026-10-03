# Run targets

A run target is a declared command, such as a dev server, that the terminal plugin starts as a
terminal session. This page covers the process broker every child process goes through, the trust
gate and ordering for run targets, the two workflow step kinds, and the palette rows. The service is
`RuntimeService` in `plugins/terminal/src/server/runtime.ts`.

## Process broker

Terminal, agents, workflows, Docker, database helpers, and command variables start processes through
`CoreServices`' process broker. It confines a process to the task's worktree, passes only allowlisted
environment variables, ends the whole process group, bounds captured output, and enforces deadlines.
Direct `spawn` and `execFile` are limited to the reviewed `CHILD_PROCESS_OK` set in
`tools/arch/boundaries.test.ts`.

## Trust and execution

Run targets merge the repository's `.acorn/config.toml`, personal defaults, and project settings
([project configuration](../workspaces-and-tasks/project-config.md)). Core returns `repoConfigHash`
with the targets, from the same captured file bytes. Before a repository-authored start or restart,
the terminal plugin passes that hash to `projects.assertConfigTrusted`, which needs both an
acknowledgement and an exact match. A missing or changed snapshot returns `needs-trust`. Personal and
project-settings targets run without the gate.

A running instance keeps the command, URL command, stop command, and folder it started with. Status
and URL discovery use that captured URL command after the file changes. Fixed URLs work without a
running instance. acorn doesn't allocate or proxy arbitrary ports. Preview uses the declared target
and the authenticated tunnel when it needs one.

Another plugin gets a turn before a process starts. `terminal:before-run-target` runs in
`RuntimeService.start`, after the trust gate and before the spawn. A veto stops the start, and the
reason reaches the caller prefixed with the vetoing plugin's ID. It can observe and veto, not
transform, because a hook payload holds scalars and arrays of scalars, which can't express an
environment map ([hooks](../plugins/hooks.md#hooks)).

Operations are serialized per task and target before any await. Adjacent **Start** calls join one
admission. **Stop** and **Restart** keep their place in the queue, and other targets run concurrently.
A fallback restart starts an absent target, but a failed stop script prevents the replacement. A
discovered URL is checked against the same live instance after its script finishes. A disposed service
can't run queued work, and a process that exits at once can't become a running instance.

## Workflow steps

The plugin contributes two step kinds to `workflows:step-kind`
([contributed step kinds](../workflows/step-kinds.md)), because the broker's environment rules, the
checkout resolution, and the run target service are here.

**`terminal:command`** runs one command as `/bin/sh -c` in the task's checkout, through
`core.proc.runProcess` with the environment `buildSessionEnv` builds. Its fields are `command`,
`timeoutMs` (1,000 to 600,000, default 120,000), `allowFailure`, and `env`, one `KEY=value` per line.
A workflow file is committed, so don't put a secret in `env`. The output is
`{ exitCode, stdout, stderr, truncated }`, and stdout becomes the step's handoff note. Output streams
as `stdout` and `stderr` events through the `onStdout` and `onStderr` callbacks on `ProcSpec`. A
non-zero exit fails the step unless `allowFailure` is set. A timeout fails it, and an abort cancels it.
It captures output instead of opening a terminal, because clean stdout from a PTY is lossy and a
headless Node would have to hold the terminal open.

**`terminal:run-target`** starts a declared run target as its own step. Its fields are `target`,
whose choices come from `GET /v1/p/terminal/tasks/:taskId/run-targets`, and `waitForUrl`, on by
default, which gives the target 60 seconds to report a URL. The output is
`{ targetId, sessionId, url }`. The trust gate applies, because it calls `RuntimeService.start`.

Both kinds use a local mirror of the workflows contribution type in
`plugins/terminal/src/contract/workflowSteps.ts`, because importing the workflows package here would
make the package graph cyclic. A test in the workflows plugin checks the mirror.

## From the command palette

The plugin registers three searches under its own **Run** group, `terminal.run`
(`plugins/terminal/src/client/commands.ts`):

| Row | What it finds | What picking one does |
| --- | --- | --- |
| Run a target | Run targets in the task's configuration, matched on ID and command | Starts the target and opens the drawer, or stops it if it's running |
| Apply a layout | The configuration's layout recipes | Replaces the pane layout, starts the recipe's target, and points the browser pane at its URL |
| Focus a terminal | Live sessions in this task, with exited ones badged | Shows the drawer, selects that tab, and focuses it |

All three are task-scoped and gated on the terminal plugin. A parse error in the configuration shows
as a badged row at the top, and Enter on it repeats the message. Rows come from one read when the
palette opens, filtered locally (`localSearch.ts`). Focusing a terminal fetches nothing, because the
roster is already a signal. Picking a target decides run or stop from a fresh read, not the drawn
label.

Other terminal commands live elsewhere. The shell owns `task.terminal.new-shell` and the drawer toggle
under its Terminal group (`apps/desktop/src/client/TaskView.tsx`). The agents plugin owns
`task.terminal.new-claude` and `task.terminal.new-codex`. The drawer's open behavior and text size
are on **Settings → Terminal**, read and written through `plugins/terminal/src/client/terminalPrefs.ts`.
Killing sessions stays in the drawer.
