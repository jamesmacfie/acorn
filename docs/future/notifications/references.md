# References: what the reference programmes do, and what acorn takes

Read 2026-09-02 from `references/`. The folder is not checked by the docs path test, so verify a
path before quoting it. herdr is the one the user pointed at; the others are here because they
answered a question herdr does not.

## herdr

A single Rust binary that is a terminal multiplexer and a background server for coding agents. Panes
live in a headless server process; clients attach over a socket. It runs Claude Code, Codex, and
about twenty others unmodified and watches their terminals.

**The state.** `references/herdr/src/detect/mod.rs`: `Idle`, `Working`, `Blocked`, `Unknown`. A
user-facing `Done` is derived from `Idle` plus an unseen bit
(`agent_view.rs` in herdr's `src/app` directory). Attention priority in
`references/herdr/src/workspace/aggregate.rs`: Blocked 4, Idle-unseen 3, Working 2, Idle-seen 1.

**The two edges.** `actions.rs` in herdr's `src/app` directory: any transition into `Blocked` is "needs
attention"; `Working | Blocked → Idle` is "finished". Nothing else pings. `Unknown → Idle` counts as
finished only if the agent label is unchanged, so startup does not ring.

**How it knows.** Three sources, arbitrated in `references/herdr/src/terminal/state.rs`: a visibly
rendered blocker on screen beats a hook, a hook beats screen and PTY fallback. For Claude Code it has
retreated from hooks entirely (`references/herdr/src/integration/claude_settings.rs` uninstalls every
lifecycle hook and keeps `SessionStart` for the session id alone) and reads the screen through
per-agent TOML manifests (`references/herdr/distribution/agent-detection/claude.toml`) plus the OSC
title spinner and OSC 9 progress. Acorn does not need any of this: it owns the driver and the node
already projects the state (analysis finding 4).

**Debounce before notify.** `references/herdr/src/pane/agent_detection.rs`: `Working → Idle` waits
for three confirmations or 700 ms; a startup grace window of 3 s; Blocked is re-published every 800 ms
while stable so a reattaching client learns of it.

**Suppression.** `active_tab_suppresses_notifications(is_active_tab, outer_terminal_focus)` in
`actions.rs` in that same directory: suppressed when the pane is the active tab and the outer
terminal is not known to be unfocused. Unknown focus counts as focused. The asymmetry: finished is
suppressed on the active tab, blocked still sounds.

**Hold and re-validate.** `ui.toast.delay_seconds`, default 1. A pending ping fires only if the agent
is still in the expected state and still the same agent. A newer event for the same pane evicts the
older pending one and clears the visible toast for that pane
(`references/herdr/src/client/shell/notifications.rs`).

**Channels.** `references/herdr/src/terminal_notify.rs` asks the host terminal: OSC 9 for Ghostty,
iTerm2, and WezTerm; OSC 99 with title and body for Kitty; detection from `TERM_PROGRAM`,
`KITTY_WINDOW_ID`, and `TERM`; wrapped in a tmux DCS passthrough with every ESC doubled when `TMUX`
is set; title and body sanitised of ESC, BEL, and ST. `references/herdr/src/platform/macos.rs` prefers
`terminal-notifier` for click-to-activate and falls back to `osascript`; Linux uses `notify-send`;
Windows a tray balloon. `references/herdr/src/sound.rs` embeds two mp3s and plays them through
`afplay`, PowerShell, or the first of `paplay`, `pw-play`, `ffplay`, `mpg123`, `mpv`, with a warning
never to use bare `aplay`. In-app toasts are one visible popup, 8 s for needs-attention and 5 s for
finished, clickable to focus the pane.

**Settings.** `~/.config/herdr/config.toml`: `[ui.toast] delivery = off | herdr | terminal | system`,
`delay_seconds`; `[ui.sound] enabled`, custom mp3 paths, per-agent `default | on | off`. A `prefix+s`
overlay draws the same choices. `HERDR_DISABLE_SOUND` kills sound.

**No inbox.** One transient toast at a time. The sidebar agent panel, sorted by priority with
blocked at the top, is the standing status board.

**Taken:** the two edges, the seen rule with unknown focus counting as focused, the hold and
re-validate, per-session coalescing, the OSC recipe with tmux passthrough, the delivery and sound
knobs. **Not taken:** screen scraping, hooks, mp3 assets, the missing inbox, sounding for blocked on
the active tab (see [refused.md](./refused.md)).

## gouda

macOS Electron, Claude Code only, hooks only. `references/gouda/src/core/agent-state/reducer.ts`
maps `UserPromptSubmit | PreToolUse | PostToolUse` to working, `PermissionRequest | Notification` to
needs-input, `Stop` to done, `StopFailure` to error, and says in its header that there is
deliberately no timer and no inactivity decay.

**Taken:** the acknowledgement model in `references/gouda/src/core/agent-state/attention.ts`. An ack
records which state was acknowledged, so needs-input → working → needs-input re-arms, and the file
explains why suppressing only while focused was not enough: the row lit straight back up the moment
you navigated away. Also taken: the chime lives outside the ack system, because "sound's job is to
reach you when you're not looking at the screen at all", and it is a synthesised two-note WebAudio
chime with no file (`references/gouda/src/renderer/chime.ts`).

## cmux

A Ghostty-based macOS terminal in Swift with the most complete notification system in the folder.
Categories rather than states (`turnComplete`, `needsPermission`, `idleReminder`, `other`), each with
its own toggle. A real inbox with a received → unread → read → cleared lifecycle. A dock badge from
the unread count in `references/cmux/Sources/TerminalNotificationStore.swift`, behind a setting. It
also intercepts OSC 777 and OSC 9 from a remote tmux stream and re-raises them natively, which is the
receiving half of herdr's sending half.

**Taken:** the dock badge from the same number the inbox shows, and the per-category toggles.

## verne, emdash, orca

Three Electron agent IDEs that agree on one thing: the OS notification is created `silent: true` and
the app plays its own sound, because the notification API's sound option cannot reliably play a
bundled file (`references/verne/electron/main/native/notifications.ts`,
`references/emdash/apps/emdash-desktop/src/core/services/notifications/api/routing.ts`). emdash's
routing is the cleanest statement of the gate: system notification when the setting is on and the
app is unfocused; sound when the setting is on and either the focus mode is `always` or the app is
unfocused. orca (`native-notification-delivery.ts` under its `src/main` tree, in `ipc`) adds two details:
on macOS an unset sound is silent, so ask for `default` when the user picked the system sound; and
keep a reference to the Notification object until it closes or its click handler is collected while
the banner is still on screen.

**Taken:** sound decoupled from the OS notification, the two-condition gate, the object-retention
note for the web fallback.

## proliferate

Tauri and React. `references/proliferate/apps/desktop/src-tauri/src/workspace_activity_indicator.rs`
sets the macOS dock badge through objc2 with a cache that skips redundant updates. Its attention set
is broader than blocked (`error`, `iterating`, `waiting_input`, `waiting_plan`, `queued_prompt`) and
excludes archived workspaces.

**Taken:** proof that a Tauri shell can badge the dock; acorn uses Tauri's own `set_badge_count`
rather than objc2 and verifies availability before building.

## bb

A thread-graph agent IDE. `references/bb/packages/db/src/data/threads.ts` pings a completion only
when the thread has no parent: a subagent finishing is not news, its parent's finishing is. The web
client's ping is a favicon dot.

**Taken:** the root-only rule, which acorn already has by construction because subagent events do
not change the session's attention (analysis finding 4).

## What acorn does that none of these do

Acorn has a node that owns the state machine and a client that keeps an inbox. herdr has neither: it
scrapes and it toasts. cmux has the inbox and no node. gouda has the cleanest edge rule and no
inbox. So the shape here is: the node keeps projecting attention as it does; the client turns
consecutive projections into edges with herdr's two rules and gouda's ack; the bell keeps its two
sections; and sound, system notification, badge, and terminal notification hang off one delivery
gate with emdash's two conditions.
