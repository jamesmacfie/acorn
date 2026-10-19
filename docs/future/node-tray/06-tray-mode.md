# Phase 6: keep the desktop's Node running in the tray

Date: October 18, 2026. Status: done on macOS, with the Windows and Linux trays unproven until phase 8.
Shows the Node's address, because phase 3 has landed.

## Completion note

Landed on October 18, 2026, on the `phase-6-tray-mode` branch.

What landed:

- **Settings → Background** (`apps/desktop/src/client/BackgroundSettings.tsx`), registered in
  `pageContributions.tsx`, with `keepNodeRunning` and `openAtLogin` in the device config schema and
  `acorn-device.schema.json`. The bridge sends both to Rust with `set_background_mode` whenever it
  reads or writes `acorn.json` or hears `config-changed`.
- `on_exit_requested` in `apps/desktop/src-tauri/src/menu.rs` decides each `ExitRequested` from the
  setting, the exit code, and whether quit is approved, with a test over every combination. Closing the
  main window clears the dock badge, the `Webviews` registry, and the helper's renderer sockets.
- `ensure_window` in `lib.rs`, called by the single-instance callback, `RunEvent::Reopen`,
  `links::receive`, the tray, and the helper's `open-window` signal.
- `apps/desktop/src-tauri/src/tray.rs`: the icon, its four-item menu, and the status line. The helper
  writes `node-status` with the broker state, plus the hosts and port from `GET /v1/core/node/reach`
  while the Node answers. A crash budget that runs out sets "Node stopped: REASON".
- The pending quit: `quit_after_reopen` in `Shell`, and `take_pending_quit`, which the bridge calls once
  its `acorn:will-quit` listener exists.
- `open-window` when a local pairing request arrives and no renderer is connected, and
  `PairingRequestDialog.tsx` reads the local Node's waiting request when it mounts.
- `tauri-plugin-autostart` with a LaunchAgent and `--hidden`. With `--hidden`, setup builds the tray and
  opens no window.
- Docs: [the shell process](../../shell/process.md#tray-mode), [notifications](../../notifications.md),
  [features](../../features.md), the pinned stack in [webviews](../../shell/webviews.md), the UNIC note in
  [packaging](../../shell/packaging.md#rust-dependency-security), and three site pages.
- Tests: Rust tests for the exit decision, the status text, and `parse_signal` on both new lines. The
  bridge test covers the pending quit pull, the dialog test covers the mount-time read, and a helper
  server test covers dropping renderer sockets.

Checked in a `dev:agent` window on macOS, on Tauri 2.12:

- With the switch on, the tray icon appears. Closing the window keeps the app, the helper, and the Node
  running, and the window's web content process, about 160 MB, exits within five seconds.
- `open` on the running app, which sends the same reopen event as a dock click, opens one window, and
  the renderer boots through the startup gate.
- A pairing request from this machine with the window closed opens the window with the request showing.
- **Quit acorn** from the app menu with the window closed and a shell running opens the window and shows
  the prompt naming "1 terminal is still running". Cancel keeps the app, and Quit exits.
- Memory with one window and a shell, in a debug build: shell 164 MB, helper 134 MB, Node 715 MB, web
  content 160 MB. With the window closed, the first three didn't change and the web content process was
  gone.

Decisions and deviations:

- **Tauri moved from 2.11.5 to 2.12.4**, with `@tauri-apps/api` and `@tauri-apps/cli` on 2.12 to
  match, because the autostart plugin needs it and because 2.11.5 doesn't free the renderer. On 2.11.5 a
  destroyed window's web content process stayed alive at 160 to 173 MB, and every reopen left another
  one. On 2.12 the same steps freed it. The upgrade brings in `tauri-utils` 2.10, which drops the five
  UNIC crates the October 1 review listed, and raises the manifest's `rust-version` from 1.82 to 1.90.
  CI builds on stable. Revert the lock files and `apps/desktop/package.json` together to undo it.
- **The helper's renderer sockets close when the window does.** WebKit's networking process kept the
  destroyed page's helper socket open. The helper then counted a renderer as attached, so `open-window`
  never fired, and each close would have left that renderer's Node subscriptions behind. Rust sends
  `renderer-closed` on the main window's destroy, and `HelperServer.closeRenderers` ends every renderer
  socket.
- **The quit prompt refreshes sessions first.** A renderer that a quit opens is asked before the Node's
  plugins are applied, so its session list was empty and it approved a quit with a shell running. The
  `app:quit` handler in `App.tsx` awaits `applyNodePlugins()` and `refreshSessionSources()`, and the
  `app:quit` budget in `willPhaseModel.ts` rises from 250 ms to 2 seconds to cover the round trip.
- **The macOS dock's Quit isn't intercepted.** Tao calls `applicationWillTerminate` with no
  `applicationShouldTerminate` hook, so Tauri never raises `ExitRequested` for it. It quits at once,
  with or without a window, as it did before this phase. The helper still drains the Node. The tray and
  the app menu quit through the prompt.
- **Closing the last window with the setting off quits without asking**, as before. The pending quit
  applies only to a quit with no window, which only tray mode allows.
- **A boot failure exits.** `ExitRequested` with no `Shell` lets the exit through. Before, the helper
  failing to start left a windowless process after its error dialog.
- **The login item is a LaunchAgent**, because only a LaunchAgent passes `--hidden`. A dev build never
  registers one, because it would register its debug binary. `--hidden` reaching a running instance
  opens no window.
- **The tray icon is the app icon**, not a template image, so it doesn't follow the macOS menu bar's
  light and dark tint.
- Background is a desktop page in `pageContributions.tsx`, not a core page, so the terminal client
  doesn't list it. The site's settings coverage check reads the desktop's pages as well.
- The tray's status line joins every host with the port. "offline" reads as "Node starting", because
  the helper restarts a local Node that stops, and the crash budget reports the final stop.

Verify before building, as answered:

- The exit code: none for a closed last window, `Some(code)` for `exit`, and the dock's Quit never
  raises `ExitRequested`. Cmd+Q is the custom menu item.
- A renderer that connects late reads statuses through `fleet-list`, and the helper pushes later
  changes.
- The autostart plugin writes a LaunchAgent plist under `~/Library/LaunchAgents` naming the app's
  path. An update that keeps the app at the same path keeps it. Not checked with a packaged build.
- A destroyed window's WebKit content process exits on Tauri 2.12 and not on 2.11.5, as above.
- Whether the AppImage carries `libayatana-appindicator` wasn't checked.

Not seen working:

- The tray menu's text. macOS doesn't expose the status item's menu to System Events, and this session
  has no screen recording permission. The icon's presence and tooltip were checked, and the text has a
  unit test.
- **Open acorn at login** and a login with `--hidden`, because a dev build doesn't register the item.
- Windows, Ubuntu with GNOME and the AppIndicator extension, and KDE.
- A second launch, which the automation build leaves out, and an `acorn://` link with the window closed.
- A client on another machine while the window is closed, and the hour-long memory record. Phase 8 owns
  both.

For later phases:

- Phase 8: run this page's acceptance list on each platform, including a packaged macOS build with
  **Open acorn at login**, a log out and in, and the hour-long memory record with a remote client.
- Phase 7: the Node keeps running with the window closed, so keeping the machine awake belongs to the
  Node, not the renderer.

## Goal

With **Keep the Node running when the window closes** on, closing the desktop's window closes it for
real, so its renderer's memory is freed, while the helper and the Node keep running. A tray icon
shows the Node's state and offers **Open acorn**, **Pair another client**, and **Quit acorn**. The app
can also open at login with no window.

## Starting point

- When the last window closes, Tauri raises `RunEvent::ExitRequested`. `lib.rs` prevents the exit and
  calls `menu::request_quit`, which exits at once when no window is left, because "no renderer to ask
  means nothing to lose" (`apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/src/menu.rs`).
- `tauri` builds with the `unstable` and `macos-private-api` features and no `tray-icon`
  (`apps/desktop/src-tauri/Cargo.toml`). The Linux build job installs `libayatana-appindicator3-dev`.
- Three paths assume a window exists. The single-instance callback in `lib.rs` focuses the first
  window and does nothing without one. `receive` in `apps/desktop/src-tauri/src/links.rs` queues a link
  and focuses the first window. Nothing handles `RunEvent::Reopen`, which macOS sends when someone
  clicks the dock icon.
- The helper talks to Rust in stdout lines tagged `acorn-helper`. `emit` in
  `apps/desktop/src/helper/helperMain.ts` writes them, and `parse_signal` in
  `apps/desktop/src-tauri/src/helper.rs` reads them. The helper's `push.frame` sees every frame from
  every Node, whether or not a renderer is connected.
- The renderer answers `acorn:will-quit` with `quit_approved` after it collects concerns, such as a
  running agent (`apps/desktop/src/shell/bridge.ts`).
- `PairingRequestDialog.tsx` in `packages/client-core/src/host/trust` shows a request only when a
  `pairing:requested` frame arrives. A window opened after the frame shows nothing.
- The renderer sets the dock badge with `set_badge` (`apps/desktop/src-tauri/src/commands.rs`).
- The `Webviews` registry in `apps/desktop/src-tauri/src/webviews.rs` holds child webviews and is
  disposed at exit.
- Desktop-only settings pages register in `apps/desktop/src/client/pageContributions.tsx`, such as
  `apps/desktop/src/client/CliSettings.tsx`.
- Device preferences that `acorn.json` covers are in `packages/protocol/src/device/deviceConfig.ts`,
  with the generated schema in `packages/plugin-types/acorn-device.schema.json`
  ([scope rules](../../state-ownership/scope-rules.md)).
- A link such as `acorn://local/settings/nodes` opens a settings page
  (`packages/client-core/src/host/registries/commands/addresses.ts`).

## Design

### The setting

Add a desktop-only **Background** page to Settings, in
`apps/desktop/src/client/BackgroundSettings.tsx` (new). It has two switches:

- **Keep the Node running when the window closes**, off by default.
- **Open acorn at login**, available only while the first switch is on. It opens with no window.

Under them, the page says: "While the window is closed, this computer shows no acorn notifications.
Clients on other machines still show them."

Both values are device preferences that `acorn.json` covers, `keepNodeRunning` and `openAtLogin`.
The renderer sends `keepNodeRunning` to Rust with a `set_background_mode` command when it starts and
whenever the value changes. Rust keeps it in `Shell`. A window is always open when the value changes,
so Rust never reads the file.

### Close the window

Tauri's `ExitRequested` carries no exit code when the last window closed, and a code when something
called `exit`. With `keepNodeRunning` on and no code, Rust prevents the exit and asks nothing. Every
other quit, from the menu, Cmd+Q, the dock, or the tray, keeps the quit prompt.

Write the decision as a pure function of three inputs: the setting, the exit code, and whether quit
is approved. That lets a Rust unit test cover every case.

When the main window is destroyed, Rust also:

- Clears the `Webviews` registry, because its child webviews went with the window.
- Clears the dock badge, because no renderer will update it.

The dock icon stays on macOS. An app with no window in the dock is ordinary there, and a click on it
reopens the window.

### Reopen the window

One function, `ensure_window`, opens the main window when there isn't one, and otherwise unminimizes
and focuses it. These call it:

- The single-instance callback, so launching acorn again opens the window.
- `RunEvent::Reopen`, for a click on the dock icon.
- `links::receive`, so a link opens the window and lands where it points.
- The tray's **Open acorn** and **Pair another client**.
- The helper's `open-window` signal, below.

A reopened window boots a fresh renderer through the normal startup gate
([startup readiness](../../frontend/data-and-startup.md#startup-readiness)). The helper and the Node
are already running, so the gate opens as soon as the helper reports the Node's status.

On Linux, GNOME hides tray icons unless the AppIndicator extension is installed. KDE, Xfce, and
Cinnamon show them. Without a visible tray, launching acorn again opens the window.

### The tray

`apps/desktop/src-tauri/src/tray.rs` (new) builds the icon with Tauri's `tray-icon` feature. It
exists while `keepNodeRunning` is on, and goes away when the setting is turned off. Its menu:

| Item | What it does |
| --- | --- |
| A status line, disabled | "Node running, reachable at 192.168.1.20:4317", "Node running, this computer only", "Node starting", or "Node stopped: REASON" |
| **Open acorn** | `ensure_window` |
| **Pair another client…** | Queues `acorn://local/settings/nodes` and calls `ensure_window` |
| **Quit acorn** | The quit below |

The status comes from the helper. On every status change of the local Node it writes
`{"acorn-helper":"node-status","state":"…","hosts":[…],"port":…}`. It reads `hosts` from phase 3's
route. Before phase 3, it sends the state alone.

### Quit from the tray

With a window open, **Quit acorn** runs the menu's quit. With no window, the "nothing to lose" rule is
wrong, because agents can be running. Rust records a pending quit in `Shell` and calls
`ensure_window`. The bridge in `apps/desktop/src/shell/bridge.ts`, once it has installed its
`acorn:will-quit` listener, calls a `take_pending_quit` command. That's the same pull that
`take_pending_links` uses. A pending quit runs the normal prompt, which lists running agents.

The dock's **Quit** with no window takes the same path.

### A pairing request with no window

When a `pairing:requested` frame arrives for the local Node and no renderer socket is connected, the
helper writes `{"acorn-helper":"open-window"}`, and Rust calls `ensure_window`.
`PairingRequestDialog.tsx` reads `GET /v1/core/pair/requests` for the local Node once when it mounts,
so a request that arrived before the window existed still shows. A request lasts two minutes, which
covers a window's startup.

### Open at login

Use the Tauri autostart plugin, registered with a `--hidden` argument. Turning on **Open acorn at
login** registers it, and turning off either switch removes it. So `--hidden` only reaches a launch
while `keepNodeRunning` is on. With `--hidden`, `setup` builds the tray and skips `open_window`.

### Notifications

Nothing changes in the notification code. While the window is closed, this machine shows no banners,
plays no sounds, and shows no badge, because the renderer that sends them is gone. Record that in
[notifications](../../notifications.md) when the phase ships.

## Steps

1. Add `keepNodeRunning` and `openAtLogin` to the device config schema, and regenerate
   `acorn-device.schema.json`. Add the **Background** page and the `set_background_mode` command to
   the invoke handler's list in `lib.rs`.
2. Change the `ExitRequested` handling, with the pure decision function and its tests. Add the
   cleanup on window destroy.
3. Add `ensure_window` and its five callers.
4. Turn on `tray-icon`, write `tray.rs`, and add the helper's `node-status` signal and its parser.
5. Add the pending quit and `take_pending_quit`.
6. Add the `open-window` signal, and the mount-time read in `PairingRequestDialog.tsx`.
7. Add the autostart plugin and `--hidden`.
8. Update [the shell process](../../shell/process.md) with the window lifecycle and the quit rules,
   and [notifications](../../notifications.md).

## Acceptance

- Rust unit tests cover the exit decision for every combination, and `parse_signal` for
  `node-status` and `open-window`.
- A bridge test covers the pending quit pull. A client-core test shows a waiting pairing request when
  the dialog mounts.
- By hand on macOS, Windows 11, Ubuntu with GNOME and the AppIndicator extension, and KDE:
  - Close the window. A client on another machine keeps working with the Node.
  - **Open acorn**, a dock click, a second launch, and an `acorn://` link each open one window.
  - A local `acorn` that asks to pair opens the window with the request showing.
  - **Quit acorn** from the tray with an agent running shows the quit prompt naming it.
  - **Open acorn at login**, then log out and in: the tray appears, and no window opens.
- The completion note records the helper's and the Node's memory after an hour with the window
  closed and one remote client paired, on macOS and Windows.

## Risks

- A person can forget the Node is running. The tray icon is the reminder, and the setting is off by
  default.
- A request that arrives while the window is starting can be read twice: once from the frame and
  once from the mount-time read. The dialog holds one request at a time, so the second read replaces
  the first with the same request.

## Verify before building

- Confirm the exit code Tauri 2 passes in `ExitRequested` for a closed last window, for Cmd+Q, and
  for the dock's **Quit** on macOS.
- Check that the helper pushes the local Node's current status to a renderer socket that connects
  after the Node is up.
- Check that the AppImage carries `libayatana-appindicator`, or name it as a dependency.
- Check what the autostart plugin registers on macOS, a login item or a LaunchAgent, and whether an
  ad-hoc signed app keeps it across updates.
- Check that a destroyed main window takes its WebKit content process with it on macOS, with
  `ps` or Activity Monitor.
