# Terminal migration and parity

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-TERM`

## Coupling and ownership corrections

| V1 Terminal responsibility/coupling | Required V2 owner/contract |
| --- | --- |
| direct `node-pty`, `spawn`, `execFile`, `execFileSync` authority | core process/PTY broker |
| repo path/config routes and database | core repository mapping/settings |
| lazy worktree create/adopt/remove | core worktree service |
| setup/teardown and task archive | core task lifecycle saga plus Terminal concern capability |
| captured command execution and run targets | core execution/run-target service |
| preview URL script | Preview capability over core execution |
| MCP inspection/starter file | core Agent Tools/MCP service and file broker |
| task context injection callbacks | context-section snapshot broker |
| notes seed and memory review callbacks | owning Notes/Memory event/capability subscribers |
| Agents handoff callbacks/direct Client API | controller-handoff/session-snapshot capabilities |
| Workflow runtime types/callbacks | Workflows calls core execution/display contracts |
| shared `terminal_sessions` core table | isolated Terminal database |
| core imports Terminal wire types | versioned public resource/stream schemas |
| raw long-lived internal API token in environment | short-lived task/session tool handles |

`CUR-TERM-130` Terminal implementation MUST NOT be imported by core, Agents, Workflows, Preview,
Editor, Changes, Notes, Memory, Context, profile packages, or automation services. Composition may
load the system artifact only through its declared system-plugin adapter.

`CUR-TERM-131` Terminal MUST NOT retain forwarding routes for moved generic operations. The
compatibility baseline maps old UX to new owning contracts so future plugins cannot mistake
Terminal for the generic execution platform.

`CUR-TERM-132` V1 data remains untouched. V2 creates new empty Terminal storage and does not attach
to V1 tmux names or import rows, live processes, outputs, repo paths/config, run targets, task
archive state, preferences, or internal API tokens.

## V1 route and stream inventory

The cookie API currently mounts:

| Family | V1 routes |
| --- | --- |
| terminal | `GET /api/terminal/sessions`, `/profiles`, `/task-statuses`; `POST /sessions`, `/sessions/:sid/kill`, `/interrupt`, `/remove`, `/resize`, `/send` |
| repository config | `GET|PUT /api/terminal/repo-path`, `PUT /repo-path/run-targets`, `PUT /repo-path/config` |
| task lifecycle | `POST /api/tasks/:id/preview-url`, `/on-created`, `/use-checkout`, `/archive`; `GET /mcp`, `POST /mcp/starter` |

The V1 bearer operation IDs are `terminal.sessions.list/create/get/interrupt/kill/delete/resize/send`,
`terminal.profiles.list`, `terminal.mcp.inspect/starter`, `terminal.checkout.get/set/run-targets`,
`terminal.worktree.status/create/adopt-checkout/delete`,
`terminal.executions.create/get/cancel`, and
`terminal.run-targets.list/get/start/stop/restart`.

V1 live traffic consists of terminal attach/detach/input, `ready`, output, exit, error and status
notifications on the internal and public WebSocket hubs.

`CUR-TERM-162` All V1 Terminal session/profile functions map to this plugin's V2 catalog. All
checkout/worktree/execution/run-target/task-lifecycle/preview/MCP functions map to the new owners
listed in [Contracts, events, and security](./contracts-events-and-security.md), with no forwarding
compatibility layer.

`CUR-TERM-163` V1 live terminal traffic is replaced by the shared V2 Node stream protocol. No
separate preload/IPC terminal data path may remain; the only Electron-native residue is host UI and
the core-owned folder chooser used by repository setup.

## Fresh-install flow

1. Core verifies/activates the release-locked Terminal system artifact.
2. Terminal detects PTY/tmux and registered Shell/Claude/Codex/Aider profiles without executing
   them.
3. Electron registers topbar toggle, drawer, terminal renderer, settings, commands and shortcuts.
4. Opening a task drawer shows empty state or launches the configured default.
5. First launch resolves repository checkout/task root through the core setup flow, creates the
   worktree if policy permits, obtains a PTY handle, then returns the session tab/stream.

`CUR-TERM-133` First launch MUST NOT silently adopt an arbitrary checkout, import a V1 mapping,
approve repository executable config, expose a Client path as authority, or inherit service
credentials.

## Terminal parity

`CUR-TERM-134` The topbar terminal button appears only in task context, toggles the bottom drawer,
reflects pressed state, and leaves the drawer empty unless a default profile is configured.

`CUR-TERM-135` The drawer remains resizable, task-scoped, maximizable, layout-reserving and
per-device persistent. Task switching restores each task's session set and last active tab without
leaking sessions between tasks.

`CUR-TERM-136` Tabs preserve optimistic launch, title, running/exited/idle/blocked state, active tab,
one-click close, close-last drawer behavior, Ctrl-C, and explicit process exit text/code.

`CUR-TERM-137` The profile menu preserves Shell, Claude Code, Codex and Aider ordering/labels,
unavailable command disabling, missing-tmux durability warning, and raw-terminal fallback.

`CUR-TERM-138` First repository use preserves native folder selection, inline path/setup error,
Node-side validation, lazy worktree creation, retry, and launch into the task root. The dialog is
core-owned in V2.

`CUR-TERM-139` The terminal surface preserves xterm behavior, 15 px default/1.15 line height,
live theme and font changes, fitted dimensions, alternate-screen TUIs, Unicode, WebGL/DOM fallback,
Shift+Enter line-feed, normal Enter submit, and Meta shortcut escape.

`CUR-TERM-140` Attach/reload/tab switching preserves the canonical current screen and concurrent
output ordering without replaying raw history. Window reload does not kill PTY sessions; Node
restart preserves only surviving tmux sessions.

`CUR-TERM-141` Agent silence/prompt heuristics preserve working-to-idle after 10 seconds, shorter
first idle, blocked prompt hints, return to working on output, done on exit, shell unknown, and
explicit heuristic authority.

`CUR-TERM-142` Send-to-agent preserves `draft`, `now`, and `after-ready`, single bracketed-paste
block semantics, embedded marker stripping, pending delivery at the next idle edge, and queue
discard on exit.

`CUR-TERM-143` Default shortcuts preserve focus terminals 1–9, previous/next, pane/terminal
maximize and focused Cmd/Ctrl+W close. Settings preserves default profile, font size and startup
task-context injection.

`CUR-TERM-143A` Desktop parity opens and closes the task drawer with
`Cmd+Shift+T`, displays the chord in Settings/tooltip, honors override/reset
and retains palette access when conflict resolution unbinds it.

`CUR-TERM-144` Task rail/topbar/Agent roster preserves running counts, working/idle/blocked/done
states, focus navigation and content-free edge notifications through public snapshot/events.

## Moved-feature parity

`CUR-TERM-145` Core repository/worktree specifications MUST preserve V1 checkout get/set, task-root
status, lazy create, “use checkout here,” remove guards, missing/dirty state, PR ref fetch, branch
base selection, configured copy/setup behavior, and repair errors.

`CUR-TERM-146` Core task archive MUST preserve running-session and dirty-worktree guards, optional
force, teardown terminal tab/output, teardown failure continue/abort, session stop/drop, worktree
removal, and final archived state. Terminal supplies only session concern/display capability.

`CUR-TERM-147` Core execution/run targets MUST preserve captured command timeout/output truncation/
cancel/status and configured target list/status/start/stop/restart/default URL behavior. A visible
process may request `display-process@2`.

`CUR-TERM-148` Core Agent Tools/MCP MUST preserve known-file inspection, safe parse, environment-key
names without values, absent-file handling, task-root `.mcp.json` starter, exists guard, and no
server launch.

`CUR-TERM-149` Preview MUST preserve configured script URL resolution in the task root, ten-second
deadline, last non-empty stdout line, and no-output/failure messages through the core execution
broker.

`CUR-TERM-150` Notes seeding, Memory review trigger, and task context startup behavior move to
declared events/capabilities and preserve their current visible outcomes without Terminal callbacks.

## Failure, remote, and lifecycle cases

`CUR-TERM-151` Missing profile executable disables that profile; missing tmux degrades compatible
profiles; PTY broker failure disables launch/attach; database failure fails Terminal; one process
failure affects only its session.

`CUR-TERM-152` Remote disconnection immediately disables input/signal/resize, keeps last screen
visibly offline in memory, buffers no keystrokes, and restores through a new canonical attachment.
If the remote ephemeral session died, it becomes exited rather than appearing resumed.

`CUR-TERM-153` A stale/wrong Node/task/session focus or command is rejected. One Electron connected
to several Nodes labels sessions by owning Node where ambiguous and never sends an input frame on a
different Node socket.

`CUR-TERM-154` Task archive during Node restart waits for tmux reconciliation. It cannot remove a
worktree while a surviving Terminal session is missed due to an empty pre-reconcile session map.

`CUR-TERM-155` Plugin update suspends new sessions/input, safely detaches views, switches compatible
metadata/runtime generation, reconciles tmux, and restores attachments. Failed update restores the
previous system generation without inventing output history.

`CUR-TERM-156` Terminal startup failure leaves the shell and non-terminal features usable;
Terminal UI contributions remain recoverable placeholders and managed Agents continue unless they
explicitly request handoff.

## Acceptance gates

`CUR-TERM-157` Release tests cover PTY/profile broker policy, tmux create/attach/kill/reconcile,
metadata transactions, display serialization ordering, alternate screen, output coalescing/
backpressure, idle/blocked heuristics, send queue, stream authorization, UI, accessibility,
disconnect and system-plugin rollback.

`CUR-TERM-158` Security tests prove environment allowlisting, task-root confinement, argv policy,
profile trust, input/escape/paste safety, output non-persistence, secret-log exclusion, controller
exclusivity, revocation and tmux namespace ownership.

`CUR-TERM-159` Boundary tests reject direct process/filesystem/Git/repository-config access, central
core SQL, private routes, cross-plugin imports/callbacks, Electron handles on the Node, and raw
broker-token environment injection.

`CUR-TERM-160` Scripted V1/V2 parity covers empty/default launch, repo setup, all profiles/backends,
tabs, xterm, input/interrupt/resize/close, task switching, restart/reconciliation, settings,
shortcuts, raw-agent status/send, Agents handoff, remote reconnect, and every moved feature listed
above.

`CUR-TERM-161` Terminal migration is complete only when all V1 behavior has a declared Terminal or
new-owner contract, Terminal itself has no generic execution/worktree/config authority, and a
remote Node terminal is fully controllable through the same bounded renderer/stream model.
