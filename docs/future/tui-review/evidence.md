# Evidence and strengths

Date: 2026-09-27. Status: observed evidence for the terminal UI review.

## Method and limits

I traced the Node, custody, client-core, host kit, layout, and chrome boundaries from
[architecture-overview.md](../../architecture-overview.md), [tui.md](../../tui.md), and the source.
I ran `tui-navigation` in the isolated PTY driver at 80 by 24 and 120 by 40, inspected checkpoints,
then drove the live task, Changes pane, command palette, and help with the UI driver. The fixture
contains two workspaces, two tasks, one stopped agent session, a large diff, and local Docker data.

The first launch failed before a frame with `ERR_MODULE_NOT_FOUND: pg`; declaring the dependency and
linking the already installed local package let the driver start. The navigation flow then passed.
The live frames showed a task opening, an agent session list, a populated Changes pane and diff,
workspace switching, help, and resizing. Searching the command palette for `settings` returned
`No matches.` A Changes toolbar displayed `[object Object]` before the label fix. These observations
come from `.acorn/agent-dev/tui/tui-review/reports/` and `logs/tui.ansi`, which are local and not
committed. The repeatable flow is `apps/tui/scripts/agent/flows/navigation.json`.

After rebuilding with text labels, the same reused fixture drew a frame and the Node listener came
online, but the Agent pane retained `connect ECONNREFUSED 127.0.0.1:62302`. The repeated navigation
flow timed out waiting for `Agents 1`. This is a reproducible failure in the reused session, not yet
a proven first-run failure. The green topbar state did not clear the pane's error.

To reproduce, run the documented TUI agent launcher with `--fixture tui-navigation`, stop its UI
driver, rebuild `@acorn/tui`, and reopen the same session with `--reuse`. Open the first task's Agent
pane, wait for the Node dot to turn green, then inspect the pane and run the navigation flow. The
expected result is `Agents 1` and the stopped fixture session. The observed result was the retained
connection refusal and a flow timeout. Keep the session data isolated when investigating it.

A fresh `tui-review-final` fixture after the text changes passed the navigation flow at 80 by 24
and 120 by 40. Its checkpoint frames showed the agent list and Changes controls with text such as
`View options`, `Refresh changes`, `Copy`, and `Write the commit message`; the toolbar no longer
showed `[object Object]`. The 80-column Changes file rows still clipped paths and actions. The
fresh run confirms the repaired build and basic navigation, while reused-session recovery remains
open.

The final fresh-run commands were `node scripts/agent-tui.mjs --session tui-review-final --fixture
tui-navigation`, `node apps/tui/scripts/agent/flow-cli.mjs --session tui-review-final navigation`,
and `node apps/tui/scripts/agent/ui.mjs --session tui-review-final stop`. The launcher built the
checkout and seeded isolated data. This machine already had `pg` in its pnpm store; a fresh install
from the updated manifest and lockfile is still an acceptance check.

The fixture does not exercise authenticated GitHub, Linear, Rollbar, HTTP, PostgreSQL, a running
agent CLI, a live PTY, pairing, plugin installation, or an empty first run. A component test that
draws those panes is evidence of rendering, not evidence that its whole user journey succeeds.

## What works well

| Area | Evidence and reason to preserve it |
| --- | --- |
| Shared data path | The TUI draws the same task and pane contributions as desktop through client-core and the authenticated Node broker. It does not fork task state or feature requests. |
| Startup and freshness model | Chrome can draw cached data while a local Node starts, and the footer explains node startup or reconnect state. The node owns work and the client owns presentation. |
| Spatial navigation | Menu, Browse, Tasks, pane strip, and pane regions have a consistent reading order. The focused frame and row caret identify where keys land. Tab, Shift+Tab, arrows, `j` and `k`, and Escape have explicit tiers. |
| Help | The footer and `?` sheet read active key bindings. The sheet showed the live workspace, project, pane, rail, and notification chords instead of a static list. |
| Overlay focus | Palette, pickers, inbox, trust, and quit confirmation use modal scopes. Tests cover Tab staying inside and focus returning on dismissal. |
| Large collections | The Changes list and diff stayed bounded in the 120 by 40 live frame. Virtual rows, scrollbars, and the diff segment cache avoid drawing whole large documents. |
| Terminal-native PTY | The rectangle owns keys only while entered; Escape leaves it and a second Escape sends Escape. Resize tests verify the PTY receives the new dimensions. |
| Plugin boundary | Loaded plugin trees draw through the closed kit in a worker. Tests cover a descriptor source, a remote tree, failed workers, trust, and contributed controls. |
| Persistence | Workspace view and selected pane state use the existing Node model; the TUI's own config and cache are separate from the Node data root. |

## Observed problems

| Finding | Evidence | User effect |
| --- | --- | --- |
| Startup dependency | First PTY launch exited with missing `pg`. | A clean TUI cannot open. The package declaration is repaired, but a fresh install must verify it. |
| Hidden action meaning | The old Lucide name table drew arbitrary one-cell substitutes, and icon-only controls used those marks. | Actions such as refresh, expand, and copy were difficult to identify without desktop icon knowledge. The terminal kit now uses text labels. |
| Narrow header competition | After text labels replaced marks, `Reviews` was clipped by `+ New PR` and `Refresh reviews` at 80 by 24. | The user could see actions but not the section identity. The header now puts actions on the next line. |
| Broken commit label | The Changes toolbar printed `[object Object]` for its generate action. | The user could not know what Enter would do. `ConfirmButton` now falls back to its label for a component child. |
| Narrow content clipping | The 80 by 24 Changes list joined path, status, counts, checkboxes, and actions into lines that lost word boundaries. At 120 by 40, file names and diff lines still clipped inside their columns. | The user cannot reliably identify a file or an action before pressing it. |
| Stale pane error after reconnection | On the rebuilt reused PTY session, the Node listened on its recorded port and the topbar was online, while Agent still showed the earlier refusal. The repeat flow failed. | A transient startup race can strand a pane until some other recovery path refreshes it. |
| Missing Settings path | `settings` in the live command palette returned no matches. | A terminal-only user cannot discover the app's configuration and connection paths. |
| Empty source explanation | The fixture opened on Docker with `Select a container` and `Nothing to list here` in Browse. | The three-panel pattern is clear, but the empty Browse box gives no reason the Docker source has no list. |
| Long footer | At 80 columns, the hint line ends in an ellipsis after workspace switching. | A new user sees core keys but not every route. The `?` sheet helps, though the route to setup remains absent. |

## Existing automated evidence

`apps/tui/src` has focused suites for chrome, key tiers and regions, field editing, agent send and
approval, browse and PR controls, source filtering, plugin trees, long lists, long diffs, and basic
pane frames. These are valuable regression guards. They do not test a full terminal-only setup or
all external integrations. Preserve the behavioral tests while changing layout; update snapshots
only after inspecting the rendered cells.

For this review, `pnpm lint` passed all 35 package tasks and the documentation path check passed
three tests. After the final text change, the TUI suite passed 599 tests with two skipped across 50
files. These gates cover code and rendering behavior, while the unrun live journeys above remain
open acceptance work.

The full architecture suite had one failure in `packages/node-core/src/server/plugins/coreFacets.ts`
for naming the `context` plugin. That file was unchanged by this review. Its other 66 tests passed;
the documentation path check was among them. This is a separate repository gate to resolve before
the full acceptance phase.

## Verify before building

- Run the documented PTY fixture with both kitty and legacy keyboard modes.
- Capture a new snapshot after every key transition, including empty, loading, error, and success.
- Pair a real external integration only in an isolated test profile; do not infer its behavior from
  fixture data.
