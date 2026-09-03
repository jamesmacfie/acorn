# Phase 4: migrate compiled plugins onto the graph

Planned 2026-09-03 at `7d62e3ec`. Shipped 2026-09-03.

## Status

- Priority: P2
- Effort: large
- Risk: medium; each migration reuses an existing typed client path, but shortcut and pane-intent
  parity span both hosts.
- Depends on: phases 2 and 3

## Purpose

Register the approved commands owned by compiled plugins, migrate terminal/workflow dynamic rows and
the two specialist file finders, and prove plugin disable/reload disposal over the new graph. Do not
turn every pane button into a command; use [command-catalog.md](./command-catalog.md) as the admission
decision.

## Prerequisites

- The shared search/input/setting session and core hierarchy are complete.
- Read each compiled plugin's client entry point, pane/source contributions, client API, retained
  pane intents, shortcuts, and tests before migrating it.
- Run a registry census for `ctx.commands`, `registerCommands`, `paletteRows`,
  `createOverlayPalette`, and palette-shaped slots; update the list below if the tree changed.

## Behavioural changes

- Plugin-owned commands are grouped and searchable by breadcrumb at the root.
- Terminal targets/layouts and workflows become interactive command providers instead of rows fetched
  by a parallel registry.
- Command-P and the GitHub current-PR file finder enter the unified session directly while retaining
  their chords, ranking, selection, and context gates.
- New compiled searches expose managed sessions, files, pull requests, Docker resources, memory,
  notes, terminal sessions, and workflow runs through their existing data owners.

## Boundaries

### In scope

- Compiled client plugins: agents, changes, context, Docker, editor, GitHub, memory, notes, preview,
  terminal, and workflows.
- Onboarding and browser receive explicit no-command tests/documentation where useful, not invented
  commands.
- Plugin-owned command/search adapters, intents, and focused tests.

### Out of scope

- Loaded manifests and routes, result secondary actions, destructive/context-poor commands, new
  backend data models, and any plugin tier migration.

## Migration steps

### 1. Terminal and workflows: retire the second row vocabulary

- Register a Terminal group with new shell/profile actions, a search for configured run targets, a
  search for layout recipes, and a search for active sessions.
- Preserve the run target's current run/stop decision and error copy. Load target/layout data once on
  frame entry and fuzzy-filter locally; configuration edits appear on the next entry/open as today.
- Register a Workflows group with runnable definitions and active/recent run navigation. Preserve
  start semantics and do not add approve/cancel/kill.
- Remove both plugins' `paletteRows.register` calls only after parity tests pass. Leave the registry
  and compatibility adapter until phase 6 verifies the global count is zero.

### 2. Editor and GitHub: unify private file finders

- Replace the editor `FilePalette` slot with a task-scoped `Go to file` search command. Reuse its file
  source, fuzzy ranking, path display, open intent, and Command-P keybinding.
- Replace GitHub's local finder controller with a current-PR `Find changed file` search command. Keep
  `/` typing exemption, route gating, changed-file order, selected-file update, and `?file=` behavior.
- Retain `createOverlayPalette` exports and the workspace picker; delete only file-finder components
  that have no remaining registration/import.
- Add GitHub `Find pull request`, `Open GitHub`, and `Create pull request` commands using its source,
  project route, and current creation route. The search may call a typed client/provider endpoint but
  must remain project/workspace scoped and capped.

### 3. Agents, Docker, memory, and notes: add real searches

- Agents: open Agent Center, query the existing managed-session search with captured scope, open the
  chosen task/session through the existing retained selection path, and retain Claude/Codex terminal
  commands. Add only the simple settings approved in phase 3.
- Docker: search the plugin's current container/image/volume/network snapshots and open the Docker
  pane with a typed selection intent. Do not attach lifecycle actions to results.
- Memory: call the existing project-visible FTS path, return bounded summaries, and open the owning
  review/context surface. Add an action that opens pending proposals; do not accept/reject inline.
- Notes: combine current task, workspace, and global summary lists under stable scope-qualified IDs.
  Selection emits the existing `notes:open` intent. `Create task note` accepts a title, uses the
  existing default note kind/slug collision rules, and opens the created note.

### 4. Small navigation owners

- Changes and Context register explicit open-pane actions so root search can find them without the
  generic pane wording.
- Preview registers a current-task open action and no configuration commands.
- Onboarding registers nothing. Browser remains node/agent-only. Add no placeholder groups.

### 5. Lifecycle and ownership

- Register through each plugin's `ClientPluginContext` so owner stamping, capability gating, and
  disable disposal are automatic.
- Stable command IDs and parent IDs belong to the plugin. Do not have a plugin inject under a core
  group.
- On plugin disable or node capability loss, close an active frame owned by that plugin, abort its
  provider, and pop/close without invoking a stale result.

## Tests

- Terminal run and stop, layout application, profile/session creation, and provider errors match
  existing palette-row tests.
- Workflow definition launch and error behavior match the old source.
- Command-P and GitHub `/` open the unified session at the named search, preserve ranking, and open
  the selected file.
- Each new search enforces context, caps results, uses stable IDs, opens the correct pane/surface, and
  handles empty/error state.
- Note IDs cannot collide across task/workspace/global scope.
- Plugin disable disposes groups and descendants, aborts an open provider, and leaves no orphaned
  breadcrumb or shortcut target.
- Desktop and TUI render the same plugin search fixtures where the plugin is available.
- Registry census shows no `paletteRows.register` after terminal and workflow migration.

Run every touched plugin's package test from its actual `package.json`, then:

```sh
pnpm --filter @acorn/client-core test
pnpm --filter @acorn/tui test
pnpm --filter @acorn/desktop test
pnpm lint
```

## Exit criteria

- Every initial compiled-plugin command in the catalogue is implemented or explicitly amended there
  with evidence.
- Terminal and workflow behavior no longer enters through `PaletteRowSource`.
- The editor and GitHub file-finder shortcuts use the shared session and have no private palette
  controller.
- Plugin disable/reload leaves no command, child, pending request, or keybinding behind.
- Browser and onboarding remain free of invented user commands.

## Rollback posture

Migrate one plugin or coherent command family per commit. Until a plugin's parity test passes, retain
its old source/overlay but register only one visible entry path at a time to avoid duplicate commands.
Reverting one plugin must not revert the graph or another owner.

## STOP conditions

- A command needs to read another plugin's internal signal or store.
- A search cannot identify and open a result through an existing or plugin-owned intent.
- Migrating a file finder changes its shortcut's typing exemption or selection semantics.
- A deferred destructive action appears necessary only to make a group look complete.
- A TUI loss would require a desktop-only command rather than an honest capability gate.

## Verify before starting

- `git diff --stat 7d62e3ec..HEAD -- plugins apps/tui apps/desktop packages/client-core`
- Re-run the registry/overlay census and compare it with [review.md](./review.md).
- Read the current first-party plugin roster and TUI-loss table.
- Confirm the existing session/open intents used by agents, notes, Docker, editor, and GitHub.
- Run terminal, workflow, editor, GitHub, and plugin-disable tests before the first migration.

