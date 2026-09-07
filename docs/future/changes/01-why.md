# Why: the pane reviews the work but does not land it

Part of [docs/future/changes/](./README.md). Status: proposal, 2026-09-07.

## What the pane is for

A task in acorn is a branch with a worktree, and most of what changes in that worktree is written by
an agent. The Changes pane exists so the person can read what the agent did before it goes anywhere.
It does that part well: the diff column stacks every file's hunks, review notes go back to the agent
as one prompt, and another plugin's marks land under the same lines.

What happens after the reading is where it stops. The plugin has stage, unstage, discard, commit, and
push on the node, and the pane exposes them as three hover buttons per row, two more on each group
header, a one-line `Input` that appears only once something is staged, and two buttons in the footer.
It has no fetch and no pull, so a branch that fell behind main is invisible until the push fails.
It has no ahead count, so "did I push that" is a question for the terminal. It has no amend, so a
typo in a message is a terminal round trip too. Untracked files sit in the "Changes" group beside
edits with the same visual weight. A conflicted file is reported as a modification.

None of that is a bug. The pane's list was written as a navigator for the diff, and the git actions
were added at the smallest size that let the reviewed work be committed. The result is that the
last step of every task, landing the work, is the one the app does worst.

## What Zed gets right

Zed's git panel is a single column that answers, top to bottom, the questions a person asks in the
order they ask them: what changed and how much, what is staged, where the branch is relative to its
remote, and what to say about it. Four things in it are worth copying exactly:

- **A checkbox is staging.** One control per row, one per group, one per folder in tree view, and
  tri-state when a folder is partly staged. It replaces three hover buttons with one visible one and
  it maps onto the keyboard for free.
- **The primary remote button is contextual.** It says **Publish** when the branch has no upstream,
  **Pull** when behind, **Push** when ahead, **Fetch** when in sync. The count beside it is the
  reason for the label. Everything else is in the menu next to it.
- **Committing with nothing staged commits tracked changes.** The common case is "commit what the
  agent did", and Zed makes that one click without hiding what staging is for.
- **The commit options are a menu, not a row of buttons.** Amend, sign-off, and skip hooks are rare
  enough to live behind a chevron, and amend gets the chord.

Two things in it are not worth copying, and [refused.md](./refused.md) has the arguments: the branch
picker, because a task is its branch; and the per-hunk staging Zed does in its project diff, because
acorn's diff viewer is unified and shared with the PR pane.

## Why the list side of the existing pane

The Zed panel is a dock beside an editor whose "View Diff" opens the project diff as a separate
buffer. acorn already has that diff open: it is the detail column of a `list-detail` pane, and the
list column is the exact rectangle the Zed panel occupies. Making the panel a new pane would put the
checkbox that stages a file and the diff of that file in two panes. Making it a rail surface is not
on offer; the rail takes marker data and nothing else, on the record.

So this programme is a rewrite of three regions, `list-header`, `list`, and `list-footer`, over the
one model the host already builds per task, plus the node calls those regions need. The detail column
and the diff source do not change.

## Why not more

Every phase here is a control the kit has drawing a fact git already reports. The temptation is to go
on: a commit graph, a stash list, a branch picker, hunk staging. Each one is either a second surface
for something the terminal does well, or a kit node that has to be admitted with a terminal rendering
first. The panel is done when a person can land a task's work without leaving it. It is not a git
client.
