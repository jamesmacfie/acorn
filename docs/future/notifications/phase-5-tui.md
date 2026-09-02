# Phase 5: the terminal client

Design, 2026-09-02. Not started. Depends on phase 1 (edges exist to deliver) and phase 3 (BEL is
the sound sink). Independent of phase 4.

## Goal

`acorn` in a terminal asks the host terminal to raise a notification for an unseen edge, knows when
the terminal is not focused, shows an unread count in its topbar, and opens an inbox overlay with
the same two sections as the desktop bell. Warp, iTerm2, Ghostty, WezTerm, and Kitty all get a
native notification; everything else gets BEL.

## Why

[analysis.md](./analysis.md) findings 10 and 15: the terminal client has toasts and nothing else, and
its renderer already reports focus that nothing listens to. The user runs Warp and named the
terminal-level notification Claude Code sends there as the behaviour they want. herdr's
`terminal_notify.rs` is the recipe ([references.md](./references.md)).

## Requirements

1. `apps/tui/src/kit/notify.ts` (new), sibling of `apps/tui/src/kit/copy.ts` and shaped like it:
   `detectBackend(env): 'osc9' | 'osc99' | 'osc777' | null` from `TERM_PROGRAM` (`iTerm.app`,
   `ghostty`, `WezTerm`, `WarpTerminal` → `osc9`), `KITTY_WINDOW_ID` or `TERM=xterm-kitty` →
   `osc99`, `TERM` containing `rxvt` → `osc777`, else null; `sequence(backend, title, body)` returning
   the bytes; `wrapTmux(seq)` producing a `DCS tmux;` passthrough with every ESC doubled when `TMUX`
   is set; `sanitise(text)` stripping ESC, BEL, and ST. `ACORN_TUI_NOTIFY` overrides: `off` disables
   both, `bell` and `terminal` pick one, `both` (default) sends the OSC when a backend exists and BEL
   always.
2. OSC 9 is `ESC ] 9 ; <title>: <body> ESC \`; OSC 99 is two sequences with `i=1:d=0` for the title
   and `p=body` for the body; OSC 777 is `ESC ] 777 ; notify ; <title> ; <body> ESC \`. Verify each
   against the emulator's documentation before shipping; herdr's file is the reference
   implementation and its tests are the fixtures.
3. `apps/tui/src/platform.ts` installs a `notify` group on the object it assigns: `show` writes the
   sequence to stdout through the renderer's write path (not a bare `process.stdout.write`, which the
   renderer would draw over; verify what `apps/tui/src/kit/copy.ts` does and do the same),
   `onActivate` returns a no-op unsubscribe (a terminal cannot tell us the banner was clicked), and
   `setBadge` records the number in a signal the topbar reads.
4. Focus: `apps/tui/src/main.tsx` subscribes to the renderer's `CliRenderEvents.FOCUS` and `BLUR`
   and feeds a `terminalFocused` signal, default `true`, into the phase 1 `DeliveryContext` as
   `focused()`. Unknown counts as focused (herdr's rule).
5. The topbar (`apps/tui/src/chrome/Topbar.tsx`) draws the pill number at its right edge as `◔ N`
   when N is non-zero, in the warn tone, reading the same `unreadCount() + inbox().rows.length` the
   desktop bell reads. Zero draws nothing.
6. An inbox overlay: a command `notifications.open` registered in `apps/tui/src/chrome/bindings.ts`
   on a key chosen by the keymap's conventions, drawing "Needs you" and "Notifications" as two
   `Rows` collections in a panel over the shell, rows in the bell's order, Enter opening the row's
   task and target through the same factored click path phase 4 makes, Escape closing. Reuse the
   bell's data (`noticesForActiveNode`, `createAttentionInbox`), not its component.
7. The terminal client calls `initWorkflowNotices()` and `initSessions()` where the desktop's
   `App.tsx` does, so workflow notices and PTY edges reach it. Verify the terminal plugin capability
   guard is right for the terminal client's node.
8. `docs/tui.md` § What must never happen is read before writing any of this, and nothing here draws
   a DOM node or adds a second keymap.

## Design notes

**Why OSC and not `terminal-notifier` or `osascript`.** herdr shells out on macOS to get
click-to-activate. acorn's terminal client is a Node process inside someone's terminal, and the
terminal already has a notification path that lands in the right app with the right icon. A shelled
notifier is one more binary to find and one more platform to special-case.

**Warp.** `TERM_PROGRAM=WarpTerminal`. Warp documents OSC 9 and OSC 777; OSC 9 is first because it
is what iTerm2, Ghostty, and WezTerm also take. Verify against Warp's current documentation, and if
Warp turns a plain BEL into a badge on its own tab, say so in the file so `bell` is a sensible
setting there.

**Why no settings surface.** Finding 14. The terminal client cannot hold a device preference and has
no settings page. `ACORN_TUI_NOTIFY` is the `ACORN_TUI_OSC52` pattern, and a file-backed
preference store is a door in `docs/tui.md`, not this phase.

**Why the overlay and not a fourth panel.** The column has three framed panels and 22 rows to spend
at 80 by 24 (`docs/tui.md` § The screen). An inbox that is open only when asked costs nothing when
closed.

## Files

- `apps/tui/src/kit/notify.ts` (new): backends, sequences, tmux, sanitising, env override.
- `apps/tui/src/platform.ts`: the `notify` group.
- `apps/tui/src/main.tsx`: focus events into the context.
- `apps/tui/src/chrome/Topbar.tsx`: the count.
- `apps/tui/src/chrome/Notifications.tsx`: grows the overlay, or a sibling `Inbox.tsx` (new) does.
- `apps/tui/src/chrome/bindings.ts`: the command.
- `apps/tui/src/chrome/Shell.tsx`: mounts the overlay and the two init calls.

## Tests

- `apps/tui/src/kit/notify.test.ts` (new): backend detection over a table of environments including
  Warp, iTerm2, Ghostty, WezTerm, Kitty, tmux-inside-Kitty, and a bare `xterm-256color`; each
  sequence byte for byte; tmux wrapping doubles every ESC; `sanitise` strips a BEL and an ST;
  `ACORN_TUI_NOTIFY=off` yields no bytes.
- `apps/tui/src/chrome/chrome.test.tsx`: the topbar shows `◔ 2` with two unread notices and nothing
  with none; the overlay opens on its key, lists both sections, and Enter on a row activates the task.
- A focus test: after a synthetic `BLUR`, an edge for the active task lands unread; after `FOCUS`,
  read.

## Acceptance

- Requirements 1 to 8 hold.
- In Warp with the terminal unfocused, a managed session asking for permission raises a Warp
  notification and the topbar reads `◔ 1`; focusing Warp and opening the overlay, Enter lands on the
  request.
- Every existing test passes, including the boot test.

## Doc moves when it ships

`docs/tui.md` § Chrome gains the topbar count and the inbox overlay; § Doors left open gains the
preference store. This file shrinks to a pointer.
