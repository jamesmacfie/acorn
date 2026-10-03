# Agent drivers

The agent drivers let an agent, or you, launch a real acorn window or terminal client in an isolated
session and drive it from another terminal. Use them to check a UI change in the running app. They
need a graphical host for the desktop and no GitHub sign-in.

## Drive the desktop

Start a session:

```sh
pnpm dev:agent -- --session my-change
```

The launcher builds an automation-only debug binary and the staged renderer. It picks an unused
loopback port for the embedded WebDriver server. It keeps the Node data, logs, screenshots, and
session manifest under `.acorn/agent-dev/my-change/`. The session doesn't share the normal
development data root or take the production shell's single-instance lock, so it can run beside
another acorn checkout.

The launcher adds the current checkout as a local project. These flags change that:

| Flag | Effect |
| --- | --- |
| `--project /absolute/path` | Adds a different folder as the project. |
| `--onboarding` | Starts with an empty profile, to test the first-run wizard. |
| `--reuse` | Reopens a stopped session's data. A stopped name isn't reused without it. |
| `--vite` | Serves the live Vite renderer instead of the staged one, to check hot reload. |
| `--fixture NAME` | Seeds a generated fixture. See [the large-surface flow](#large-surface-flow). |

By default the window serves the staged renderer through the app scheme, as a packaged build does.
That avoids Vite's burst of cold module loads during startup. `pnpm dev` stays the normal live loop.

When the launcher prints `ready`, drive the window from another terminal:

```sh
pnpm dev:agent:ui -- --session my-change snapshot
pnpm dev:agent:ui -- --session my-change click e2
pnpm dev:agent:ui -- --session my-change fill e4 "new value"
pnpm dev:agent:ui -- --session my-change scroll -400
pnpm dev:agent:ui -- --session my-change screenshot after-change.png
pnpm dev:agent:ui -- --session my-change stop
```

Take a `snapshot` before an element action and again after the UI changes. Its element references
belong to that snapshot. Leave out `--session` when exactly one session is running. For a disposable
check of the launcher and the first-run UI, run `pnpm dev:agent:smoke`.

`scroll` moves the largest scrolling region and reports where the reader is: the offset, and the turn
at the top of the viewport where the content publishes one. With no delta it only reports. To check a
reading place across a navigation, note the turn, go elsewhere, come back, and ask again. Compare the
turn, not the offset, because an offset means nothing once the content above it changes height.
[UI design](../ui-design.md) § Behaviour a pane keeps redoing explains reading places.

The driver controls the main renderer through the Tauri webview. It can read rendered text, click,
fill, scroll, and capture the window. It can't reach native menus, native dialogs, or host-owned child
webviews, and it doesn't reproduce terminal keyboard input exactly. Use native control or the
[smoke checklist](../testing/smoke-checklist.md) for those. The WebDriver server exists only behind the
`agent-automation` Cargo feature this launcher uses. Normal development and packaged builds don't
include it.

## Native control of a session

On macOS, the launcher runs each session from its own copy of the build, wrapped in
`.acorn/agent-dev/<name>/Acorn Agent Test.app` and signed ad hoc by
`apps/desktop/scripts/agent/nativeApp.mjs`. Every session's bundle uses the identifier
`com.acorn.desktop.agent-test`, not the installed app's `com.acorn.desktop`. So one **Always allow** in
a native tool such as Computer Use covers later sessions and rebuilds, and trusts test builds instead
of the app you use every day. It also trusts every running session, not only the one an agent
launched.

The bundle gives WebKit its own storage for that identifier, so session windows don't share
`localStorage` with a debug build from `pnpm dev`. They do share it with each other.

Before you hand a window to a native tool, ask the driver for it:

```sh
pnpm dev:agent:ui -- --session my-change target
```

`target` checks that the recorded process is still the launcher's child running this session's
executable, so a stopped window whose process ID was reused is refused. `stop` makes the same check
before it signals anything. The output gives the process ID, the bundle identifier, and `app`, the
session's own bundle path. Address `app`, not the identifier, because every session shares the
identifier. `sharedWith` lists the other running sessions.

The driver never picks a window for you or stops another session. If a native tool can't tell the
windows apart by path, stop the other sessions yourself. Use `target` for native menus, dialogs, and
child webviews, use the WebDriver commands for the main renderer, and finish with `stop`. Computer
Use keeps its own grants, as [managed agents](../managed-agents.md) § App-access approval describes.
Windows and Linux sessions run the raw executable and have no native identity.

## Drive the terminal client

Start an isolated terminal session from the checkout:

```sh
pnpm dev:tui:agent -- --session tui-check --fixture tui-navigation
```

The launcher seeds the same Node data as the desktop launcher, checks the native Node ABI, builds the
Node and the TUI, and runs the compiled TUI inside an 80 by 24 PTY. Keep that terminal open, and drive
the screen from another:

```sh
pnpm dev:tui:agent:ui -- --session tui-check snapshot
pnpm dev:tui:agent:ui -- --session tui-check press Tab
pnpm dev:tui:agent:ui -- --session tui-check type "search text"
pnpm dev:tui:agent:ui -- --session tui-check paste "pasted text"
pnpm dev:tui:agent:ui -- --session tui-check resize 120 40
pnpm dev:tui:agent:flow -- --session tui-check navigation
pnpm dev:tui:agent:ui -- --session tui-check stop
```

`press` takes a key or a chord such as `Escape`, `Shift+Tab`, or `Ctrl+P`. `type` sends text as
keystrokes, and `paste` uses bracketed paste. The default `kitty` keyboard mode tests the TUI's
enhanced key parser, and `--keyboard legacy` tests its fallback. Pass `--cols` and `--rows` to the
launcher for another starting size. `--onboarding` starts with an empty profile. Without a fixture,
the launcher adds `--project PATH` or the checkout as a project. A fixture brings its own project, so
it refuses `--project` and `--onboarding`.

The session manifest, Node data, TUI config, input trace, raw ANSI output, and flow reports live under
`.acorn/agent-dev/tui/<session>/`. A stopped name needs `--reuse` to reopen. The driver listens on
loopback only and keeps its control secret in the private session manifest. `stop` ends the PTY, and
the launcher drains its child Node. A snapshot is the terminal's visible cells at that size, so take
another after each step or resize.

To compare the two clients, start a desktop session with the same fixture, profile, and seed:

```sh
pnpm dev:agent -- --session desktop-check --fixture tui-navigation
pnpm dev:agent:ui -- --session desktop-check flow tui-navigation
pnpm dev:agent:ui -- --session desktop-check stop
```

Compare the task roster, workspace switcher, task panes, Changes, and agent content at 80 by 24 and
120 by 40. The flow reports give repeatable checkpoints. Check the live screens for focus,
truncation, scrolling, and terminal keys. The two clients can lay out controls differently, but
missing task information or unreachable navigation is a bug.

To work on a loaded plugin beside a session, run `pnpm dev:plugin <id>`. It rebuilds the plugin's
package on every save. [Plugins](../plugins.md) § The dev loop has the whole loop.

## Large-surface flow

The large-surface fixture puts a very large diff and a long agent transcript in a real window without
GitHub. [Desktop and large-surface tests](../testing/desktop.md#the-large-surface-fixture) describes
the fixture.

```sh
pnpm dev:agent -- --session large-surfaces --fixture large-surfaces --profile scale
pnpm dev:agent:ui -- --session large-surfaces flow large-surfaces
pnpm dev:agent:ui -- --session large-surfaces stop
```

`--fixture large-surfaces` replaces the checkout as the project. `apps/desktop/scripts/agent/seed.ts`
generates a Git repository at `fixture/repo` in the session directory, commits the base side of every
file, and leaves the head side in the working tree. It adds a task, then writes review notes and a
stopped agent session through the Changes and Agents testkits. `--profile` is `small`, the default,
`scale`, or `canonical`. `--seed` picks the data and defaults to 1. The manifest's `fixture` block
records the profile, seed, digest, counts, and IDs. `--reuse` keeps the fixture instead of
generating it again.

`flow NAME` runs that file from `apps/desktop/scripts/agent/flows/`. The `large-surfaces` flow opens
the Changes pane cold, sweeps the diff, opens a comment composer, deletes a note, resizes the window,
collapses files, switches to split view, and jumps to a file. Then it opens the transcript, checks
that it mounted no more than 400 turns, presses **Show earlier**, and checks again. After each stage it
reads the health snapshot described in [telemetry](../telemetry.md) § Rendered-surface health. It waits
on health conditions and animation frames, not fixed sleeps.

A flow file is data. Each step is one action from a fixed list: `click`, `fill`, `wait`, `scroll`,
`resize`, `frames`, `checkpoint`, `assert`, and `repeat`. Steps target controls by role and accessible
name. The runner refuses a field it doesn't know, so a flow can't carry a script. `repeat` is capped at
20 and can't nest. `apps/desktop/scripts/agent/flow.mjs` owns the list.

The JSON report goes to `reports/` in the session directory, named for the flow, profile, and start
time. It holds the environment, the fixture, each stage's waits, each checkpoint's snapshot, every
invariant with its numbers, and the `acorn:` spans on the performance timeline. The command exits
non-zero when an invariant fails, after the whole flow runs and the report is saved.

Keep the window visible for the whole run. A covered window runs no animation frames, so the diff
never draws. The runner checks `document.visibilityState` first and stops with that explanation.
