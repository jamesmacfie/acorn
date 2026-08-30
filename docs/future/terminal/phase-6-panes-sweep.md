# Phase 6: every pane at 80 by 24

Status: not started. Waits on phase 4. Runs beside phase 5.

## Goal

Every first-party pane read at 80 by 24 against the plugin table in [01-why.md](./01-why.md), each
row's "crosses" column true and each "does not" column drawn as a `<Fallback>` or a placeholder that
says what is missing. The three handoffs that make the terminal better than a subset: the PTY
(phase 2), `$EDITOR`, and docker exec.

## Why this phase, and why now

Phases 1 and 2 make every pane mount. Mounting is not reading. A pane can be built from `full` nodes
and still be unusable in 24 rows because it puts the thing you need on row 30. This is the sweep that
finds those, and it waits on chrome because a pane's rows are what is left after the chrome's four.

## Scope

In, one row per plugin, each a checklist item:

- **agents**: sessions list, the transcript as a `Timeline` with `follow`, tool cards, the composer
  with slots, approvals as a `Modal`. Image attachments show a filename and a size.
- **github**: list, overview, checks, conversation, the diff with `DiffLine` annotations, merge.
- **changes**: stage, diff, notes, commit, push.
- **editor**: file tree, search, read-only text with find. `$EDITOR` handoff: the renderer suspends,
  the editor runs on the file in the worktree, the renderer resumes and the pane refetches.
- **terminal**: done in phase 2; verify with a TUI agent inside it.
- **docker**: containers, info, logs with find, stats as bars, exec as a PTY region.
- **context, memory, notes**: all of it.
- **http, linear, rollbar**: all of it; inline images as filenames.
- **database**: SQL in a text region without completions, results as a `Table` with column
  truncation named in the header.
- **preview, browser**: URL, run state, capture filenames; the page as a placeholder offering the
  system opener.
- Where a pane is unreadable, the fix is to the pane through the kit, never to the TUI: a `<Fallback>`
  child, a `Fold` closed by default, a shorter `Row` subtitle.

Out: any node or layout change (those go back to phases 1 and 2 as findings), any pane that does not
exist yet.

## Design detail

**The handoff.** `apps/tui/src/handoff.ts` (new): release the terminal (restore the main screen,
show the cursor, stop reading stdin), spawn `$EDITOR` (or `$VISUAL`, or `vi`) with the file path,
wait, resume the renderer, redraw, and tell the editor pane to refetch. Used by the editor pane's
"Edit" action on the TUI, and available to any pane through a host verb so a plugin can ask for it
without knowing there is a terminal.

**Reading at 80 by 24.** Each pane is opened at exactly 80 by 24 with the chrome present, and someone
answers: can I find the thing this pane is for in the first screen, can I act on it with the footer's
bindings, and does the narrow projection tell me where the rest went. A "no" is a finding against the
pane, filed on the plugin and fixed in the plugin.

**Snapshots.** One buffer snapshot per pane at 80 by 24 with a fixture task, kept in `apps/tui/`, so
a pane change that breaks the terminal fails a test in the plugin's own CI run.

## Code touched

- `apps/tui/src/handoff.ts` (new), one host verb in `apps/tui/src/platform.ts`.
- `plugins/editor/src/client/EditorPane.tsx`: the "Edit" action asks the host for a handoff when the
  host offers one.
- Per-pane fixes in `plugins/*/src/client/`, each small.
- `apps/tui/test/panes/*.test.ts` (new): snapshots.

## Tests

- One snapshot per pane at 80 by 24.
- The handoff: a fake `$EDITOR` that writes a marker; the pane shows the marker after resume.
- Docker exec: the PTY region opens, `ls` output appears, Escape leaves.
- Approvals: an agent approval opens a `Modal` that owns the layer; accept reaches the node.

## Docs owed

- `docs/first-party-plugins.md`: a "terminal" note per plugin where something is reduced or handed
  off.
- `docs/terminal.md`: the editor handoff and docker exec on the TUI.
- [01-why.md](./01-why.md)'s table moves to `docs/tui.md` (new) in phase 8; this phase keeps it true.

## Doors left open

- Sixel or Kitty graphics for attachments, if a terminal that supports them turns out to be common
  among users. Refused as a phase; noted as a door.

## Done when

Every row of the plugin table is checked, every pane's snapshot exists, and a person can review a
pull request, drive an agent, edit a file in `$EDITOR`, and exec into a container from `acorn` at 80
by 24.

## Verify before building

- The plugin table in [01-why.md](./01-why.md) still matches the plugins in `plugins/`.
- `plugins/editor/src/client/EditorPane.tsx` still mounts Monaco through a `Rectangle`.
- `plugins/docker/src/client/DockerExecTerminal.tsx` still mounts through a `Rectangle`.
