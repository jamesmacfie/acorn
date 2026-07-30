# Terminal Client and UI

**Status:** Normative current-plugin migration<br>
**Requirement prefix:** `CUR-TERM`

Electron owns the drawer layout and `acorn.terminal/2` renderer. Node output is untrusted PTY data;
renderer availability never grants input.

## Contributions and placement

`CUR-TERM-050` Terminal contributes a task-only topbar button in `topbar.right`, a bottom drawer
task slot, terminal settings, commands/keybindings, session/attention badges, a task context
section, and focus/open navigation intents. The contribution is unavailable outside a selected
task.

`CUR-TERM-051` The drawer is a portal-hosted bottom overlay that reserves layout height so task
panes shrink above it. Its partial height is draggable from 160 px to 85 percent of the window and
persists per Client device; maximize uses the host pane/terminal maximize command.

`CUR-TERM-052` Terminal is desktop-capable and always present as metadata. A Client without
`acorn.terminal/2` renders session list/status/read-only log fallback where supported and an
explicit “interactive terminal unavailable” state; it does not hide sessions.

## Tabs, profiles, and launch

`CUR-TERM-053` The tab strip contains sessions for the active task only. Each tab shows title,
running/exited/idle/blocked state in text and icon, pending launch, and close. Closing a running tab
invokes host confirmation according to policy, terminates then removes; closing the last tab closes
the drawer.

`CUR-TERM-054` Switching tasks swaps the visible session set and restores that task's last active
tab. A session from task A is never rendered or focused under task B even if a stale intent or route
names it.

`CUR-TERM-055` The plus menu lists Shell and installed profile contributions. Unavailable
executables are disabled with “not found”; tmux fallback displays “tmux missing — won't survive
restart”; incompatible or permission-denied profiles show their distinct reason.

`CUR-TERM-056` If the task repository has no checkout/task root, launch invokes the core repository
setup wizard with a native folder chooser in Electron, path validation on the Node, worktree policy,
and retry. Terminal never receives a client-chosen path as authority.

`CUR-TERM-057` Opening an empty drawer auto-launches the configured default profile (`empty`,
`shell`, `claude-code`, or `codex` by default profile availability), displays “Launching…” and an
optimistic tab, and prevents duplicate launches during worktree/process setup.

## Terminal surface

`CUR-TERM-058` Electron uses xterm or an equivalent implementation behind `acorn.terminal/2`, with
monospace theme tokens, a default 15 px font, 1.15 line height, live font/theme/style changes,
Unicode-safe locale, fitted PTY dimensions, and WebGL rendering with safe DOM fallback.

`CUR-TERM-059` Attach first fits/resizes the Node display, then applies ready/reset/snapshot/live
ordering. Switching tabs unmounts only the renderer attachment; it does not terminate the PTY.

`CUR-TERM-060` Keyboard input is sent only while focused, connected, authorized, and running.
Shift+Enter sends bare line-feed; normal Enter remains carriage return; application Meta shortcuts
bypass xterm; Ctrl/Alt combinations remain terminal input.

`CUR-TERM-061` The drawer exposes Ctrl-C interrupt as a separate action while running. Input,
interrupt, terminate, paste, resize, attach, detach, copy and external navigation are distinct
commands/intents with independent authority.

`CUR-TERM-062` ResizeObserver/window/drawer/font changes refit safely and send at most ten resize
updates per second. Teardown races, GPU loss, detached hosts, and renderer exceptions cannot crash
the shell.

`CUR-TERM-063` Selection and copy are Client-local. Paste containing multiple lines or control
characters uses host protection and requires a user gesture; OSC clipboard/file/notification/
window operations from terminal output are disabled.

## Commands and shortcuts

`CUR-TERM-064` The command catalog includes open/close drawer, create profile session, focus
terminal 1–9, focus previous/next, interrupt, terminate/remove, maximize/restore, and focus a
specific session intent.

`CUR-TERM-065` Default bindings preserve `Cmd+Shift+1` through `Cmd+Shift+9`,
`Cmd+Shift+[`/`]`, `Cmd+Shift+Enter` for host maximize, and Cmd/Ctrl+W closing the active tab only
when focus is inside the drawer. The host handles conflicts and user overrides.

`CUR-TERM-065A` `task.terminal.toggle` contributes task-scoped `meta+shift+t` (`Cmd+Shift+T`) as
its shipped default. Settings, tooltip, conflict/override/reset, typing protection and palette
fallback follow `UX-PARITY-010A`.

`CUR-TERM-066` A focus intent carries Node, task and session URI. Electron opens the owning task,
drawer and tab, then focuses the terminal input. Offline, absent, exited, unauthorized and wrong-
task targets show a stable unavailable result rather than focusing another session.

## Settings, status, and fallback

`CUR-TERM-067` Settings → Terminal preserves default profile, terminal text size, and “send task
context to new agent sessions” controls. It additionally exposes effective tmux availability,
durability fallback, retention and permission state using standard forms.

`CUR-TERM-068` Working counts/status badges consume snapshot/events even when the drawer is closed
and feed task rail/topbar/Agent roster through public contracts. Notification edge detection is a
host concern and excludes terminal output/content.

`CUR-TERM-069` Loading, no sessions, launching, mapping/setup required, process failed, exited,
offline, stale, permission denied, profile missing, tmux degraded, stream gap, output truncated,
renderer unsupported, plugin failed and quarantined states are all explicit and actionable.

`CUR-TERM-070` On remote Node disconnection, visible output freezes with an offline marker, input/
paste/signal/resize are disabled, no keystrokes are buffered, and reconnect opens a new attachment
with canonical screen restoration rather than replaying arbitrary raw history.

`CUR-TERM-071` Terminal content is excluded from normal Client persistence. Per-device drawer
height/font/tab identity may persist; unpair/delete removes Node-scoped presentation state.

`CUR-TERM-072` Future mobile defaults to session roster/status, read-only bounded output and
terminate/attention actions where policy permits. Terminal input, arbitrary paste, profile launch
and full-screen TUI rendering may be unsupported with an explicit fallback.

## Accessibility

`CUR-TERM-073` The drawer is a labeled complementary region with a keyboard-accessible resize
handle, tablist semantics, session status text, accessible profile menu, controls, and predictable
focus return.

`CUR-TERM-074` The terminal renderer offers an accessible screen-buffer mode, input label, focus
escape, reduced-motion behavior, and announcements for exit/offline/truncation without announcing
raw high-rate output.

`CUR-TERM-075` Status does not rely on color alone. Idle/blocked are labeled heuristic where shown;
screen-reader users can distinguish running, exited, disconnected, and needs-attention.

`CUR-TERM-076` ANSI/control data is parsed as terminal data only; titles, errors and profile labels
are encoded text. Terminal output cannot create host buttons, approvals, credential fields, overlays
or automatic external navigation.

`CUR-TERM-077` UI tests cover task switching, restoration, resize/maximize, theme/font changes,
alternate screen, high-rate output, canonical attach, detach races, input authority, paste/control
protection, profile failure, tmux degradation, reconnect, unsupported renderer, keyboard and
screen-reader behavior.

`CUR-TERM-078` The topbar toggle and task layout remain usable when no session exists. Opening the
drawer never implicitly creates a session unless a non-empty default profile is configured.

`CUR-TERM-079` Managed-agent handoff terminals visibly show the linked Agents session/controller.
Their return-to-managed action invokes Agents navigation/command; Terminal does not render or
resolve provider approval requests.
