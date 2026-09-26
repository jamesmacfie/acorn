# Local development

acorn is a pnpm workspace with Turborepo. First-party packages are source-consumed TypeScript
packages; `apps/node` and `apps/desktop` are the composition/build roots. The node's build entries are
in `apps/node/src/entries/` and the boot code they share is in `apps/node/src/composition/`; the
desktop's three processes are `apps/desktop/src/client/`, `src/shell/`, and `src/helper/`.

## Environment

Create `<checkout>/apps/desktop/.env` for local desktop development:

```dotenv
GITHUB_CLIENT_ID=...
SESSION_ENC_KEY=<64 hexadecimal characters>
```

`GITHUB_CLIENT_ID` is only needed when connecting GitHub, and the GitHub plugin owns that
configuration. There is no GitHub client secret. `SESSION_ENC_KEY` is optional: a node without one
generates its own into the data root. For more information, see
[node-distribution.md](./node-distribution.md). Setting it in `.env` pins a stable key across
throwaway data roots, which is why it is listed here.

The data root defaults to `apps/node/.acorn/` and is gitignored. Set `ACORN_DATA_DIR` to isolate a
run. Set `ACORN_PORT` to force a port for tests or a standalone process; otherwise the Node prefers
the last port in `node.json` and falls back to an ephemeral port.

Two variables exist for plugin work. `ACORN_BUNDLED_PLUGINS_DIR` gives a standalone Node a directory
of app-owned plugin packages to reconcile from. The desktop always has one and `pnpm dev:node` does
not, and if the variable is unset the reconcile step does not run at all.
`ACORN_PROMPT_BUNDLED_PLUGIN_TRUST=1` puts the per-bundle trust dialog back for the app's own bundled
packages, which a development build otherwise acknowledges the way a packaged build does. For more
information, see [plugins.md](./plugins.md) § The dev loop.

## Start

```sh
pnpm install
pnpm rebuild:node
pnpm dev
```

`pnpm dev` builds the Node artifact, the bundled plugins, the desktop helper and the injected bridge,
stages them with the pinned Node runtime and the migration chains, then runs `tauri dev` against a
Vite renderer on port 4319. `pnpm dev:node` runs the standalone Node and prints one JSON handshake
line containing endpoint, fingerprint, certificate, Node ID, and device token.

`pnpm dev:no-watch` is the same run with the Rust watcher off. `tauri dev` otherwise rebuilds and
relaunches the app on every change under `src-tauri`, which takes the window away from whoever is
using it, so start this way when somebody is working in the app while the shell is being edited.
Pick the new binary up by stopping it and starting `pnpm dev` again. Renderer hot reload is Vite's
and works the same either way.

### Agent-driven desktop development

An agent on a graphical development host can launch and drive a real Acorn window without using the
normal development profile or signing in to GitHub:

```sh
pnpm dev:agent -- --session my-change
```

The launcher builds an automation-only debug binary and the staged renderer, chooses an unused
loopback port for the embedded WebDriver server, and keeps the Node data, logs, screenshots, and session manifest under
`.acorn/agent-dev/my-change/`. It does not share the normal development data root or participate in
the production shell's single-instance lock, so it can run beside another Acorn checkout. By default
it adds the current checkout as a local project before launch. Pass `--project /absolute/path` to add
a different folder, or `--onboarding` to start with an empty profile and exercise the first-run flow.
Git and GitHub remain optional in either case.

The agent window serves the staged renderer through the same app-scheme file path as a packaged
build. This avoids Vite's cold module burst during automated startup. Pass `--vite` to run the live
Vite renderer when checking hot reload; `pnpm dev` remains the normal live development loop.

Once the launcher prints `ready`, use its small command-line driver from another terminal:

```sh
pnpm dev:agent:ui -- --session my-change snapshot
pnpm dev:agent:ui -- --session my-change click e2
pnpm dev:agent:ui -- --session my-change fill e4 "new value"
pnpm dev:agent:ui -- --session my-change scroll -400
pnpm dev:agent:ui -- --session my-change screenshot after-change.png
pnpm dev:agent:ui -- --session my-change stop
```

Run `snapshot` before an element action and again after the UI changes; its element references belong
to that snapshot. Omit `--session` when exactly one agent session is running. Session names identify
persistent data directories, so a stopped name is not reused accidentally; pass `--reuse` to keep and
reopen its data. For a disposable end-to-end check of the launcher and first-run UI, run
`pnpm dev:agent:smoke`.

`scroll` moves the largest scrolling region and reports where that leaves the reader: the offset, and
the turn the viewport starts in where the content publishes one. With no delta it only looks, which is
what a check across a navigation wants — note the turn, go somewhere else, come back, ask again.
Compare the turn and not the offset, because an offset means nothing once the content above it has
changed height, which is why a transcript's reading place is a turn in the first place
([ui-design.md](./ui-design.md) § Behaviour a pane keeps redoing).

The driver controls the main Acorn renderer through the Tauri webview. It can inspect rendered text,
click and fill elements, scroll, and capture the window. Native menus and dialogs, terminal keyboard fidelity,
and host-owned child webviews still require native computer-use control or the release smoke checklist.
The WebDriver dependency and server exist only behind the `agent-automation` Cargo feature used by
this launcher; normal development and packaged builds do not expose it.

### Agent-driven terminal development

Start an isolated terminal session from the checkout. It seeds the same Node data as the desktop
agent launcher, checks the native Node ABI, builds the Node and TUI, and runs the compiled TUI
inside a PTY with an 80 by 24 terminal by default:

```sh
pnpm dev:tui:agent -- --session tui-check --fixture tui-navigation
```

Keep that terminal open. In another terminal, inspect and drive the live screen:

```sh
pnpm dev:tui:agent:ui -- --session tui-check snapshot
pnpm dev:tui:agent:ui -- --session tui-check press Tab
pnpm dev:tui:agent:ui -- --session tui-check type "search text"
pnpm dev:tui:agent:ui -- --session tui-check paste "pasted text"
pnpm dev:tui:agent:ui -- --session tui-check resize 120 40
pnpm dev:tui:agent:flow -- --session tui-check navigation
pnpm dev:tui:agent:ui -- --session tui-check stop
```

`press` accepts a key or chord such as `Escape`, `Shift+Tab`, or `Ctrl+P`. `type` sends text as
keystrokes; `paste` uses bracketed paste. The default `kitty` keyboard mode exercises the TUI's
enhanced-key parser; `--keyboard legacy` exercises its fallback. Pass `--cols` and `--rows` to the
launcher for a different initial size. `--onboarding` starts with an empty profile. With no fixture,
the launcher adds `--project PATH` or the checkout as a local project. A fixture supplies its own
project and cannot be combined with `--project` or `--onboarding`.

The session manifest, Node data, TUI config, input trace, raw ANSI output, and flow reports live
under `.acorn/agent-dev/tui/<session>/`. A stopped name needs `--reuse` to reopen its data. The
driver listens only on loopback and keeps its control secret in the private session manifest. `stop`
ends the PTY process; the launcher drains its child Node. A text snapshot is the terminal's visible
cells at that size, so take another snapshot after each navigation step or resize.

For a direct comparison, start a desktop window with the same fixture, profile, and seed, then run
the desktop comparison flow:

```sh
pnpm dev:agent -- --session desktop-check --fixture tui-navigation
pnpm dev:agent:ui -- --session desktop-check flow tui-navigation
pnpm dev:agent:ui -- --session desktop-check stop
```

The two launchers keep separate data roots but generate the same scenario. Compare the task roster,
workspace switcher, task panes, Changes, and agent content at 80 by 24 and 120 by 40. The flow
reports and captured text provide repeatable checkpoints; inspect the live screens for focus,
truncation, scrolling, and terminal-specific key behavior. Shared pane content comes from the same
client-core code, while the terminal kit and chrome render it into cells. A different control layout
can be expected; missing task information or unreachable navigation needs investigation.

Working on a loaded plugin is `pnpm dev:plugin <id>` beside one of those. It rebuilds the plugin's
package on every save. [plugins.md](./plugins.md) § The dev loop has the whole loop, including which
target to build into and why the node restarts.

### Large-surface flow

The large-surface fixture puts a very large diff and a long agent transcript in front of the real
window without GitHub ([testing.md](./testing.md) § Large-surface fixture):

```sh
pnpm dev:agent -- --session large-surfaces --fixture large-surfaces --profile scale
pnpm dev:agent:ui -- --session large-surfaces flow large-surfaces
pnpm dev:agent:ui -- --session large-surfaces stop
```

`--fixture large-surfaces` replaces the checkout as the project. The launcher generates a Git
repository under the session directory at `fixture/repo`, commits the base side of every file, and
leaves the head side in the working tree. It then adds that repository as the project, adds a task
that runs in the project folder, and writes the review notes and a stopped agent session into the
Changes and Agents databases through their testkits (`apps/desktop/scripts/agent/seed.ts`).
`--profile` is `small` (the default), `scale`, or `canonical`, and `--seed` picks the data (default
1). The manifest's `fixture` block records the profile, seed, digest, counts, and the task and session
IDs. `--reuse` keeps a session's fixture rather than generating it again. A fixture brings its own
project, so it refuses `--project`, `--onboarding`, and `--smoke`.

`flow NAME` runs the file of that name in `apps/desktop/scripts/agent/flows/`. The `large-surfaces`
flow opens the task's Changes pane cold and sweeps the diff from top to bottom and back. It opens a
comment composer and deletes a note, resizes the window, collapses the file list and a file,
switches to split and back, and jumps to a file. Then it leaves and returns, opens the transcript,
checks it mounted no more than 400 turns, presses **Show earlier** once and checks again, jumps to
its oldest and newest turns, and leaves the task. The transcript counts as mounted when every turn
is drawn or hidden behind **Show earlier**. After each stage it reads the
rendered-surface health snapshot ([telemetry.md](./telemetry.md) § Rendered-surface health). It
waits on health conditions and animation frames, not fixed sleeps.

A flow file is data. Each step is one action from a fixed list (`click`, `fill`, `wait`, `scroll`,
`resize`, `frames`, `checkpoint`, `assert`, `repeat`). It targets controls by role and accessible
name, and names its wait conditions and invariants. A field the runner does not know is refused, so a
flow cannot carry a script. `repeat` is capped at 20 and cannot nest.
`apps/desktop/scripts/agent/flow.mjs` owns the list.

The report is written to `reports/` in the session directory as JSON, named for the flow, the
profile, and the start time, and a short summary is printed. The report holds the environment (OS,
CPU, memory, engine user agent, build), the fixture, each stage's waits in milliseconds, each
checkpoint's snapshot, every invariant with the numbers it was decided on, and the `acorn:` spans on
the performance timeline. The command exits non-zero when an invariant failed, after the whole flow
has run and the report is saved.

The window must stay visible for the whole run, for the reason in
[Timing a task switch](#timing-a-task-switch): a covered window runs no animation frames, so the diff
never draws. The runner checks `document.visibilityState` first and stops with that explanation
rather than timing out.

## Native ABI

`node-pty` is the only native module. SQLite is the runtime's own `node:sqlite`
(`packages/node-core/src/server/storage/sqlite.ts`), so it has no ABI to match. Rebuild once at the workspace
root for the process that loads node-pty. Where the prebuilt binary applies, the rebuild script
detects that and does nothing:

```sh
pnpm rebuild:node
```

There is one ABI to match, because the desktop runs the node under the same pinned Node runtime the
tests use. Do not rebuild per package. All packages resolve the same physical native copy.

## Database workflow

`scripts/db.mjs` finds a chain by the presence of a `drizzle.config.ts`, and every plugin's is one line
re-exporting `plugins/drizzle.shared.ts` (`./src/node/schema.ts` → `./migrations`). A new table-owning
plugin adds that one-line file, plus `migrationsModule: import.meta.url` on its `NodePlugin` so the host
opens and migrates the database for it (docs/data-layer.md § Migrations).

Edit the schema in its owning package, then run:

```sh
pnpm db:generate
pnpm db:check
pnpm db:migrate
```

The launch path applies pending migrations automatically. `pnpm db:locate` prints the active core
database path.

To inspect a disposable installation before a reset, name its actual roots:

```sh
pnpm db:reset -- --node-root /absolute/node/root --tui-root /absolute/tui/config
```

This prints a JSON inventory and changes nothing. The root arguments are always required; the command
never selects a development or home directory from the environment. Stop the Node and terminal client,
then choose a new external recovery directory to execute the selected filesystem reset:

```sh
pnpm db:reset -- --execute --node-root /absolute/node/root --tui-root /absolute/tui/config --recovery-dir /absolute/recovery
```

It checks Node locks and open files, exports each listed file to a private directory, verifies SHA-256
digests, and records each removal in `manifest.json`. Repeating the same command with the same recovery
directory resumes an interrupted reset. Repository files, worktrees, `.env`, arbitrary files, and
external databases are outside the inventory. Restore the snapshot only into an isolated directory
with the old Acorn binary. Retained worktrees are detached until explicitly re-added.

For a desktop installation, first make an empty private recovery directory and run the desktop
binary's host stage after quitting the normal app:

```sh
mkdir -m 700 /absolute/recovery
acorn-desktop --reset-stage --desktop-root /absolute/desktop/custody --recovery-dir /absolute/recovery
pnpm db:reset -- --execute --node-root /absolute/node/root --desktop-root /absolute/desktop/custody --recovery-dir /absolute/recovery
```

The desktop binary opens a dedicated `app://acorn` window without starting its helper or Node. It
exports that origin's local storage and query cache to `desktop-origin.json`, exports the active
`acorn/data-key` keychain or private-file key to `desktop-key.txt` when present, clears the origin and
keychain entry, then writes `desktop-stage.json`. The filesystem command checks that stage's hashes,
private permissions, and exact custody root before removing custody files. A stage failure leaves the
filesystem reset blocked. This checkout's development custody is normally `<node-root>/shell`;
packaged custody uses the application-data directory. Name the private memory root with
`--memory-root` when resetting accepted memory. Never point a reset at the checkout's enclosing data
root without reviewing the inventory.

## Timing a cold start

Four processes, four accounts of their own boot, all of them lines on a stream with a running offset.
Every line carries `+Nms` from that process's start and `(Nms)` for the step alone, so the one step
that cost the boot is the one wide number.

**The node prints its marks unconditionally.** A node that took eleven seconds to bind should say so
without anyone having asked, so `[service:boot]` needs no switch: `login-shell`,
`bundled-packages`, `migrate`, `graph` (the plugin loader importing whatever is installed in the data
root), then one line per plugin per pass (`plugin github init`, `plugin x ready`), then `install`,
`cert`, `bind`, `listener-up`, `scheduler`, the four `reconcile.*` steps, and `teardown`. The per-plugin
lines are there because `install` on its own cannot say which plugin was the slow one.

Two labels need reading with care. `login-shell` is when the `PATH` probe started, not when it
finished: the probe runs behind the boot and the first process the node spawns is what waits for it
([node-distribution.md](./node-distribution.md) § Boot order), so this step is a fraction of a
millisecond even on a packaged macOS build where the probe itself takes half a second. And the
per-plugin lines are wall-clock slices rather than per-plugin costs, because the whole `init` pass runs
at once. A plugin's line says when it finished. Where the two coincide, in the common case of a plugin
whose `init` never awaits anything, the delta is that plugin's own work; where a plugin does await, the
plugin that finished next takes the credit for the gap.

`migrate` is also wider than its name. The step covers `makeRuntime`, which opens and migrates
`core.sqlite` and then builds the rest of the runtime bindings, so a slow `migrate` is not necessarily
a slow migration. Drizzle's `migrate` against an up-to-date journal is one `SELECT`, and on this
machine's data root the whole `openDb` call is 7 ms.

**Everything else is behind `ACORN_PERF=1`**, because those streams are the ones a developer watches
while using the app:

| Process | Set | Prints |
| --- | --- | --- |
| Helper | `ACORN_PERF=1` in the environment the shell was started from | `[helper:boot]` on **stderr** for handshake, plugin-cache sweep, bundled plugins trusted, `service.start`, node adopted, WebSocket bound, ready line. stderr and not stdout: stdout is the line protocol Rust parses |
| Node | same variable | `[perf:request]` per request (method, matched route pattern, status, ms, response bytes, request id), plus `git` and SQLite histograms. The byte count is the response's `content-length`, and `-1` where it declares none, which is what a stream looks like |
| Renderer | `localStorage.setItem('acorn.perf', '1')` and reload | `[renderer:boot]` in the devtools console for script start, node selected, plugins applied, tree built, first paint, `nodeReady`. A `localStorage` switch rather than the variable because a webview has no environment — Rust loads the renderer from a custom scheme rather than spawning it. The `performance.mark`s are made either way, so the devtools performance panel has the same labels with the switch off. With telemetry on, the same marks up to `nodeReady` also go to sinks as a `renderer.boot` span ([telemetry.md](./telemetry.md) § Renderer seams), and every renderer span is also written to the page's performance timeline (§ Timing a task switch) |
| `acorn` | nothing | `[acorn:boot]` on exit for node open, App imported, tasks read, renderer created, first draw. Held rather than printed live, because stderr is the file the renderer draws on while it owns the terminal — a line written mid-session reads as the shell going to garbage. Printed after `renderer.destroy()`, beside the held Node warnings |

The node's histograms count what it does over and over with nothing else counting it: `git status` and
`git diff` spawns as `git.<subcommand>`, and SQLite statements as `sql.<verb>`. They print at drain,
and `kill -USR2 <pid>` dumps and clears them mid-session, so a second dump describes the interval
rather than all time.

`ACORN_PERF=1` is a printer over the telemetry collector rather than a mechanism of its own, so the
switch also turns collection on with no sink and no preference
(`packages/node-core/src/server/telemetry/collector.ts`, [telemetry.md](./telemetry.md) § The
switch). The request line is printed where the request ends rather than from the collector's flush,
because a developer watching a dev server wants it when the request finishes and not in a burst five
seconds later.

Every other line the node writes goes to **stderr** through `createLogger`, including the
`[service:boot]` marks, which used to be on stdout. Stdout is a wire: the standalone entry prints
its handshake JSON there. Two things are still written to stdout on purpose, both from
`apps/node/src/entries/standalone.ts`: that handshake, and the pairing banner.

Reading a desktop cold start end to end means putting three of these together: Rust spawns the helper,
the helper's `[helper:boot] ready line` is the whole of what Rust waited for, and the renderer's clock
starts at its own document's navigation, after Rust created the window. The node's
`[service:boot] listener-up` is not inside that wait. The window opens as soon as the helper is
listening and shows the startup loader, and the node boots behind it. The shell mounts only when the
local node's first status reaches the renderer ([frontend.md](./frontend.md) § Startup readiness). The
two accounts meet at `[helper:boot] service.start`, which is the node reporting that it is listening,
so `ready line` to `service.start` is the node's share of the launch. The loader is on screen for that
interval less the time the window takes to open and load its scripts. `node selected` is the fleet
selection, which lands before the node is up. `nodeReady` is the local node's first status reaching
the renderer, which is when the shell mounts and its first reads go out.

Two things about the node's own account are worth knowing before quoting it. Its clock starts inside
`startServiceRuntime`, so spawning the process and evaluating the service bundle are in front of `+0ms`
and appear in no step. On an M2 Pro that gap is about 100 ms, most of it evaluating the service
chunk, which bundles the node's pure-JavaScript dependencies. And measuring the node by calling
`startServiceRuntime` under `tsx` rather than launching the app inflates `graph` roughly sevenfold,
because the loader then transpiles as it imports.

`graph` also depends on the data root. `apps/desktop/test/boot.test.ts` boots a fresh root, and its
`graph` step takes a few milliseconds. A root that has run the app before holds the bundled loaded
plugins, and `graph` then includes starting an isolated worker for each one with a node half. The
workers start together, and on an M2 Pro the step is about 110 ms for the seven bundled ones. Time a
launch against an established root, such as a `pnpm dev:agent -- --reuse` session, before quoting a
node boot figure.

**`[renderer:boot] first paint` does not print from a background window.** It is a
`requestAnimationFrame` callback, and macOS pauses those while the window is occluded, so a launch
watched from a terminal never records it. Bring the window to the front before reloading, or read
`tree built` instead: that one is printed synchronously when `render` returns, so it fires wherever the
window is, and it is the end of the renderer's own work. The difference between the two is the
compositor, which is the part a background window does not do.

## Timing a task switch

Renderer spans such as `nav.change`, `pane.region`, `pane.model`, and `api.request` go to telemetry
sinks, and the one shipped sink forwards them to Sentry. To read them on your own machine, set
`localStorage.setItem('acorn.perf', '1')`, reload, and turn telemetry on in Settings →
Telemetry. Every span is then also a `performance.measure` named `acorn:<span name>`, with the
span's attributes as its `detail`
(`packages/client-core/src/infra/telemetry/emitter.ts`, `setSpansOnTimeline`). The devtools
performance panel draws them, and `performance.getEntriesByType('measure')` returns them, which is
how a WebDriver script against `pnpm dev:agent` reads a switch without a round trip inside the timed
window. An `api.request` entry carries `responseBytes`, which the node's `[perf:request]` line
cannot give for most routes because it prints `-1` for a response with no `content-length`.

The spans stop at their own seams. `pane.region` ends when a region's content mounts, and
`nav.change` ends on the second animation frame, so neither waits for a pane's data. A pane that
draws from a store rather than a query, such as the agent transcript, fills in after both have
ended. To time a switch to a populated pane, watch the pane's content in the page and take the
moment it stops changing.

Keep the window visible for the whole run. WebKit runs no animation frames for a window that is
behind another window or on a locked screen, so `nav.change` never ends there, virtualized lists
such as the diff rows never draw, and timers slow to about one per second. Synchronous work and
request counts still measure correctly in a hidden window, but a paint does not happen.

## Build artifacts

`apps/node` emits `service.js`, `mcp.js`, `standalone.js`, and chunks. `apps/desktop/scripts/stage.mjs`
puts them, all core and plugin migration chains, the plugin frame stylesheet, and the pinned Node
runtime where the bundler will find them. The staging check detects missing artifacts but cannot
identify stale output by itself, so build order is `package.json`'s job.

## Data and credentials

Never commit `<checkout>/apps/desktop/.env`, data roots, device tokens, integration credentials, TLS keys, or
generated archives. Use a fresh `ACORN_DATA_DIR` for onboarding/import tests. The importer reads a
copy and leaves the source database and sidecars unchanged.
