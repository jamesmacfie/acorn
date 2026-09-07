# Changes: a commit panel beside every task

Status: proposal, 2026-09-07. Nothing here has started.

This folder is the plan for making the Changes pane's left column into a working git panel, modelled
on the git panel in the Zed editor. Today that column is a file list with three hover buttons per row
and a one-line commit field that only appears once something is staged. There is no fetch, no pull,
no amend, no ahead or behind count, and untracked files sit in the same group as edits. The reader
who has just watched an agent finish a task has to leave the pane, or the app, to land the work.

After this programme the column reads top to bottom the way Zed's does: a header with the change
totals and a view menu, groups of files with a checkbox per row for staging, a bar naming the branch
and how far it is from its upstream with one contextual button for the next remote action, and a
multi-line commit editor with the commit options behind a menu. The diff stays where it is, in the
right column, which is the one thing Zed opens separately and acorn already shows.

Nothing about how acorn draws plugin UI changes. Every control is a node the closed kit already has
(`docs/ui-design.md` § The closed kit), the panel stays a `list-detail` pane whose regions the host
mounts (`docs/panes.md` § Layout model), and every git call keeps going through the one git seam
(`packages/node-core/src/server/core/git.ts`). The two hooks the plugin already declares,
`before-commit` and `before-push`, stay the only way another plugin takes part, and each gains one
boolean.

## Where this came from

The owner used Zed's git panel for a while and asked for the same shape beside acorn's tasks, with
seven screenshots of it. [02-zed-survey.md](./02-zed-survey.md) is the record of those screenshots
mapped onto what acorn has, control by control. [01-why.md](./01-why.md) is the argument that came out
of it, and it is short.

Where this folder and an owning doc under `docs/` disagree after a phase ships, the owning doc wins.

## The goals, in the order they appeared

1. **Land the work without leaving the pane.** Stage, write a message, commit, push, and see the
   result, all in the column the diff sits beside. The terminal stays for everything else.
2. **The list tells the truth about the tree.** Conflicts, tracked edits, and untracked files are
   three different situations and read as three groups. A deletion reads as a deletion. Every row
   says how much changed.
3. **The remote is visible.** Which branch, whether it has an upstream, how many commits each way,
   and one button whose label is the thing to do next.
4. **The commit editor is an editor.** Multi-line, remembers a draft across a relaunch, expands when
   the message is long, and offers amend, sign-off, and skip-hooks without three more buttons.
5. **Someone else can write the message.** A connected model provider drafts one from the staged
   diff, through the seam the database plugin already uses for SQL.

## Decisions taken

These were decided with the owner and are settled. A phase file may not reopen them.

| Decision | Why | What it forecloses |
| --- | --- | --- |
| The panel is the **list side of the existing Changes pane**, not a new pane and not a rail surface. | The Zed panel is a dock beside an editor; acorn's equivalent is the `list`, `list-header`, and `list-footer` regions beside the diff. A new pane would put staging and the diff of what is staged two clicks apart. The rail takes marker data only (`packages/client-core/src/host/registries/extensionPoints/slots.ts` says why `tabrail.task-row` went). | No second git surface. The rail keeps its dirty marker and gains nothing else here. |
| **No new kit node.** Every control is a node the kit has: `Checkbox`, `Textarea`, `Menu`, `Fold`, `TreeRow`, `ConfirmButton`, `Modal`. Zed's split buttons become a button beside a menu trigger. | A node arrives with a support row, a focus role, and an 80 by 24 sentence (`docs/ui-design.md` § Every node at 80 by 24), and nothing in this panel needs a shape those nodes cannot draw. | No split button, no hunk-staging gutter. Hunk staging is in [refused.md](./refused.md). |
| **One status read** answers everything the panel shows: changes, branch, upstream, ahead, behind, and whether a merge or rebase is mid-flight. | It is one `git status --porcelain=v2 --branch` call, which core already runs for the rail. Two reads would disagree for a poll interval. | No separate branch route, no separate remote route. |
| **Commit with nothing staged commits tracked changes**, and the button says so. | Zed's rule, and it removes the most common extra click. The hook chain sees the same payload either way. | The old "commit is hidden until something is staged" behaviour. |
| **Force push is `--force-with-lease`, armed to confirm, and vetoable.** | The lease refuses to overwrite a commit the node has not seen. `ConfirmButton` is the prompt on every host. `before-push` gains `force` so a branch-protection plugin can say no. | Bare `--force`. A confirm dialog. |
| **Branch switching is not in the panel.** | A task is its branch, and a worktree is keyed by it (`docs/workspaces-and-tasks.md` § Worktrees and setup). Checking out another branch inside a task's worktree is the exact state the `worktree-stale` refusal exists to catch. | Zed's branch picker. The branch name in the bar is a label. |
| **Preferences are device state, drafts are device state, everything else is git.** | View mode, sort, and grouping are about the person; a commit draft is losable by the recorded drafts decision (`docs/state-ownership.md` § Scope rules). Nothing in this panel writes a row anywhere except the git repository. | No new table in the changes plugin's database. |

## The files

Supporting documents, readable in any order:

| File | What it holds |
| --- | --- |
| [01-why.md](./01-why.md) | The argument, condensed. Read this first if you were not in the room. |
| [02-zed-survey.md](./02-zed-survey.md) | The seven screenshots, control by control: what Zed does, what acorn does, and take, adapt, or leave. |
| [03-anatomy.md](./03-anatomy.md) | The panel's regions, the one model behind them, the status shape, the node calls, the hooks, how it refreshes, the keyboard, and the terminal projection. |
| [refused.md](./refused.md) | What was considered and refused, with the argument. |
| [docs-migration.md](./docs-migration.md) | Every document under `docs/` that changes, which phase changes it, and how. |
| [prototype/panel.html](./prototype/panel.html) | A self-contained HTML prototype of the panel in every remote state, for the implementer to click through. Open it in a browser; it needs no server. |

## The phases

| Phase | File | What it delivers | Waits on |
| --- | --- | --- | --- |
| 0 | [phase-0-status-and-rows.md](./phase-0-status-and-rows.md) | The status shape with branch, upstream, ahead, behind, operation, and conflicts; a checkbox per row; three groups; batch staging; the totals header | Nothing |
| 1 | [phase-1-view-and-tree.md](./phase-1-view-and-tree.md) | The view menu: list or tree, sort by path or name, group by none, tracked and untracked, or staged and unstaged; folder checkboxes; remembered per device | Phase 0 |
| 2 | [phase-2-commit-editor.md](./phase-2-commit-editor.md) | A multi-line editor with a device-local draft, expand to a modal, commit tracked when nothing is staged, amend, sign-off, skip hooks, and the two chords | Phase 0 |
| 3 | [phase-3-remote-bar.md](./phase-3-remote-bar.md) | The branch bar with ahead and behind, the contextual primary button, fetch, pull, pull with rebase, push, force push with lease, and the in-progress banner with abort | Phase 0 |
| 4 | [phase-4-generated-message.md](./phase-4-generated-message.md) | A commit message drafted by a connected model provider from the staged diff | Phase 2 |
| 5 | [phase-5-after-push.md](./phase-5-after-push.md) | A `changes:push-actions` remote point under the bar, and the GitHub plugin's "Open pull request" in it | Phase 3 |

## The order of work

Phase 0 is the foundation and every later phase reads its status shape. Phases 1, 2, and 3 are
independent of each other and can land in any order or in parallel; 3 is the one users will notice
first, 2 is the one they will use most. Phase 4 needs the editor from phase 2 to put its text in.
Phase 5 needs the bar from phase 3 to sit under, and it is the one phase that could be dropped
without the panel being worse at what it is for.

## How to work a phase

Each phase file has the same sections as the other programmes in this folder's parent: goal, why
now, scope, design detail, code touched, tests, docs owed, doors left open, done when, verify before
building. The same two rules apply:

- **Verify before building.** File and line references were checked against the tree on 2026-09-07.
  Paths rot. Run the verify list at the end of each phase file before writing code.
- **Update the owning doc in the same change.** [docs-migration.md](./docs-migration.md) says which
  document owns each behaviour afterwards. A phase is not done until that document says the new true
  thing.

## What this folder is not

- It does not add hunk or line staging. The diff viewer renders unified rows and has no gutter
  for it; [refused.md](./refused.md) has the argument and the door.
- It does not add a commit history view. `git_log` is an agent tool, and the PR pane shows commits
  once there is a PR.
- It does not give agents write tools for git. An agent has a terminal.
- It does not build a filesystem watcher. The panel refreshes the way the rail does, and
  [03-anatomy.md](./03-anatomy.md) § Refresh says what that costs.
- It does not schedule anything.
