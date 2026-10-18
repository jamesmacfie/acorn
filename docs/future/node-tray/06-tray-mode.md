# Phase 6: keep the desktop's Node running in the tray

Date: October 18, 2026. Status: proposed. Shows the Node's address when [phase 3](./03-reachability.md)
has landed.

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
