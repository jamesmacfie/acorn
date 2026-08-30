# Phase 5: your own editor, in a PTY, on the desktop

Status: not started. Waits on phase 4.

## Goal

A person who lives in vim or nano edits in it without leaving acorn: an editor preference whose
terminal mode mounts an ephemeral PTY running `$EDITOR` on the file, inside the same pane, in place
of the graphical editor.

## Why this phase, and why now

The terminal programme already decided the TUI edits by handing the file to `$EDITOR` in a suspended
renderer. This phase is the desktop twin, and the infrastructure is already in the tree twice over:
the terminal protocol's create options carry a `command` override the node happily spawns
(`packages/protocol/src/terminal.ts`, run through the user's shell on the node side), and docker
exec proves the throwaway-PTY shape — its own channel, no drawer tab, no persistence, dies with the
panel (`plugins/docker/src/client/DockerExecTerminal.tsx` says all of this in its header). What is
left is a preference, a mount decision, and a refresh on exit. It waits on phase 4 only because the
preference chooses between two editors and one of them is being replaced there.

## Scope

In:

- A device preference, `editor mode: graphical | terminal`, following the device-prefs pattern
  (`docs/frontend.md`; localStorage before the query cache).
- In terminal mode, the editor pane's file view mounts a `Rectangle kind="pty"` instead of the
  CodeMirror rectangle and runs `$EDITOR <file>` (falling back `$VISUAL`, then `vi`) in the task's
  worktree. When the process exits, the pane returns to its file view and re-reads the file, the
  same refresh the reload-on-focus path already performs.
- The PTY is ephemeral, docker-exec-shaped: its own short-lived channel, no terminal-plugin session
  row, no tmux ring, no drawer tab. Escape-to-leave and Enter-to-enter follow the rectangle contract
  as they do for every PTY.
- Read paths are untouched: the file tree, search, and the diff stay as they are; terminal mode
  changes only what happens when a file is open for editing.

Out: making this the default — graphical stays the default. Out: a per-file or per-language choice;
the preference is one switch. Out: any TUI work; the TUI's handoff suspends the renderer instead of
mounting a nested PTY and is the terminal programme's to build.

## Design detail

**Ephemeral over a terminal-plugin session.** A `create({ command })` session would work today, but
it buys exactly what this pane does not want: a persistent row, a tmux binding, and a drawer tab per
edited file. The docker-exec shape — a client-generated id, a websocket channel, a node-side spawn
that dies with the socket — matches the lifetime of "editing this file right now". The one thing it
borrows from the terminal plugin's server is the spawn-through-shell behaviour, so `$EDITOR` can be
a shell alias or carry flags; the phase decides whether that is a shared helper on the node side or
a third small spawn site, and leans shared helper.

**Exit is the save signal.** No dirty tracking in terminal mode: the editor in the PTY owns the
buffer, and the pane's only contract is "when the process exits, re-read the file". A non-zero exit
leaves the file untouched and says so in an `Alert`.

**The environment is the worktree's.** cwd is the task worktree, env is the session env the
terminal plugin already computes for run targets; `$EDITOR` resolution happens node-side where the
shell profile lives, not in the renderer.

## Code touched

- `plugins/editor/src/client/EditorPane.tsx`: the region that owns the open-file view mounts one
  rectangle or the other on the preference
- A small client channel + node spawn pair in the editor plugin, modelled on docker exec's
  (`plugins/docker/src/client/DockerExecTerminal.tsx` and its ws channel; the node half beside the
  editor plugin's existing server code)
- The device-prefs slice for the preference, and a row in the editor's settings or the pane's
  toolbar to flip it

## Tests

- A node-side test spawns the channel with a fake `$EDITOR` (a script that writes a marker into the
  file and exits) and asserts the pane's re-read sees the marker — the same shape the terminal
  programme's phase 6 promises for the TUI handoff.
- A client test flips the preference and asserts which rectangle mounts.
- A non-zero-exit test asserts the alert and the untouched file.

## Docs owed

- The editor's owning doc (renamed in phase 4) gains the mode and its exit contract.
- `docs/first-party-plugins.md`'s editor row mentions both modes. See
  [docs-migration.md](./docs-migration.md).

## Doors left open

1. The TUI sharing the same preference key, so a person's choice follows them between hosts.
2. Attach-to-running: re-entering a file whose editor process is still alive instead of spawning a
   second one. Skipped now; the ephemeral channel dying with the panel makes the simple thing
   correct first.

## Done when

- With the preference set, opening a file lands in `$EDITOR` inside the pane, `:wq` returns to the
  file view showing the saved content, and the graphical mode is untouched when the preference is
  off.
- `pnpm lint` and the editor and node tests are green.

## Verify before building

- `CreateOpts` in `packages/protocol/src/terminal.ts` still carries `command` and `env`, and the
  terminal server still spawns a command override through the user's shell.
- `DockerExecTerminal.tsx` still opens its own ws channel with a client-generated exec id and calls
  itself independent of the terminal plugin — the pattern this phase copies.
- Phase 4 has shipped: the graphical editor is CodeMirror and the pane root is kit. If not, stop;
  the mount decision this phase adds lands in that root.
