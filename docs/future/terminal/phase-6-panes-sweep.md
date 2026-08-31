# Phase 6: every pane at 80 by 24

Status: **shipped 2026-08-31.**

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

## What shipped, and where it differs

The roster is the whole of it: `apps/tui/src/App.tsx` registers the same twelve client plugins the
desktop does, and eight panes appear in the strip. Everything else in this phase is what that cost.
[findings.md](./findings.md) § What phase 6 did with these has the fifteen findings; these are the
places the plan itself was wrong or short.

- **The `$EDITOR` handoff was already built, and `handoff.ts` was the wrong design.** This file
  described releasing the terminal, spawning `$EDITOR`, waiting, resuming and refetching. The editor
  pane already has a terminal mode — one device preference swaps CodeMirror for a throwaway PTY running
  the reader's own editor on the worktree — and that PTY lives on the node, so in cells it simply
  draws. There is no suspend, no `handoff.ts`, and no host verb.

- **What the two PTY callers moved onto is not the rectangle's handle.** The plan said docker exec and
  the editor's PTY would write to what a `pty` rectangle hands back. They do not, and could not without
  each of them knowing which host it is on: the DOM hands an element and the terminal hands an
  emulator. So the promise moved instead. `attachPty(handle, io)` on `@acorn/plugin-api/ui` takes the
  channel — open at a size, bytes in, bytes out — and the host draws the emulator, an xterm on one side
  and OpenTUI's on the other. Both callers are about fifteen lines now and neither spells xterm. The
  terminal plugin's own drawer surface keeps its copy, because its options are a theme, a font size, a
  WebGL renderer and a Shift+Enter rule, none of which means anything in cells.

- **Two barrels crossed, not one.** Phase 5 left `@acorn/plugin-api/ui/host` and this phase owed it.
  It also owed `@solidjs/router`, which nobody had counted: it reads `window.history.state` at module
  scope, so it cannot be imported in this process at all, and github's own composition reaches it
  eagerly. The host switch has four aliases now rather than two.

- **The prop types are shared rather than mirrored.** With the roster in the same tsc program the
  terminal kit's hand-written prop types failed 135 ways, because four of them had quietly lost a prop.
  `ButtonProps` and four siblings are exported from the DOM kit and imported as types by the terminal
  one, which is the fix rather than a bigger copy.

- **The largest finding is a layout rule, not a pane.** Nothing in the kit may shrink. A pane taller
  than 24 rows is the normal case, and yoga's answer — take the deficit out of every child — walks rows
  onto each other. The kit's block nodes and rows refuse to shrink and the pane's box clips.
  `scrollbox` is refused, with the reason in `chrome/PaneRow.tsx`.

- **Snapshots are strings, not buffers.** `apps/tui/src/panes.test.tsx` names one thing per pane rather
  than pinning every cell, for the same reason the per-node cases do, and waits for that string rather
  than for a fixed time. A whole-buffer snapshot per pane would fail on every spacing decision anybody
  makes afterwards and name no broken promise.

- **Two rows of the plugin table changed and one came off.** `preview` is absent here: its pane asks
  for the `preview` seam and this host installs none, so it is not in the strip rather than in the strip
  and empty. The editor's row is the handoff rather than a read-only view. The terminal's row loses the
  drawer, which is a place between two icon rails. [01-why.md](./01-why.md) says so.

## What this phase deliberately left

Three things, and the third is the one to watch.

- **The read-only text view inside an `editor` rectangle.** The box draws and says the file opens
  there, and `$EDITOR` opens in it. Reading a file without leaving the pane needs a find bar wired to a
  text region that does not exist.

- **A settings surface.** Four plugins register a settings page and nothing here draws one, so
  `workflows` contributes nothing to this host at all. That is chrome, and chrome was phase 4.

- **The no-shrink rule has no test that holds it.** One `flexShrink` left at its default on a pane's
  path brings the interleaving back, and what catches it is a pane suite noticing a string is missing
  rather than a rule saying why. An arch rule over the kit's own boxes would hold it; a rule that reads
  JSX is not one this repo has.
