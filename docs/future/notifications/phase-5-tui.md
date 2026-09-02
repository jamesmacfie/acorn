# Phase 5: the terminal client

Shipped 2026-09-02. `acorn` in a terminal asks the host terminal to raise a notification for an unseen
edge, knows when the terminal is not focused, carries an unread count in its topbar, and opens the
bell's two sections as an overlay. Where each part landed:

- `apps/tui/src/kit/notify.ts` (new) holds the whole terminal channel and nothing that reaches the
  node: `notifyMode` and `BEL`, moved here from `bell.ts`; `detectBackend`, which reads `TERM_PROGRAM`
  (`iTerm.app`, `ghostty`, `WezTerm`, `WarpTerminal` → `osc9`; `kitty` → `osc99`), then
  `KITTY_WINDOW_ID` or `TERM=xterm-kitty` → `osc99`, then `TERM` for `xterm-ghostty`, `wezterm` and
  `rxvt`; `sanitise`; `sequence`; `wrapTmux`; `notification`, which puts the four together and answers
  the empty string when there is nothing to write; `showInTerminal`; and the badge signal the topbar
  draws.
- `apps/tui/src/kit/bell.ts` keeps `initBellNotices` and re-exports `notifyMode` and `BEL` from
  `notify.ts`, so phase 3's callers and its test are unchanged.
- `apps/tui/src/platform.ts` installs the seam's `notify` group: `show` writes the sequence,
  `onActivate` returns a no-op unsubscribe, `setBadge` writes the signal.
- `packages/client-core/src/features/notifications/deliver.ts` gains `setHostFocused`, and
  `apps/tui/src/main.tsx` feeds it from `CliRenderEvents.FOCUS` and `BLUR`.
- `apps/tui/src/chrome/Topbar.tsx` draws `◔ N` in the warn tone at the right edge, and nothing at
  zero.
- `apps/tui/src/chrome/Inbox.tsx` (new) is the overlay and `initInbox`, which owns the attention
  fan-out and the `trackBadge` effect. `apps/tui/src/chrome/Shell.tsx` calls it, registers
  `core.notifications.open` on `n`, mounts the overlay, and calls `initSessions`,
  `initWorkflowNotices` and `initSystemNotices` where the desktop's `App.tsx` does.

## Where the build departed from the requirements

**The two sections are one collection, not two** (requirement 6, which asked for two `Rows`). A modal
takes the keys by swallowing every intent but `dismiss` at priority 35, and `nextRegion` lives at 5 —
so a second collection inside one is a list nobody can reach, which breaks the first focus invariant
(`apps/tui/src/keys/trap.ts`, docs/tui.md § Traps). The two sections are one `Rows` with each head
drawn above its first row instead, so `j` and `k` walk the whole inbox.

**The command is registered in `Shell.tsx`, not `bindings.ts`** (requirement 6). `chrome/bindings.ts`
is the footer's words — it turns the engine's live keys into hints and registers nothing. Every
command this shell owns is registered in one `onMount` in `Shell.tsx`, and this is one more line
there.

**`notifyMode` moved rather than being re-exported the other way** (requirement 1, which offered
either). The platform seam is built before `window.acorn` exists, so `platform.ts` may not import a
module that reaches client-core — and `bell.ts` does. The pure half is `notify.ts` and `bell.ts`
re-exports from it, which is the direction that compiles.

**No timestamp on an inbox row, and no `action` dispatch** (requirement 6, "rows in the bell's
order"). The order is kept; the relative time is not drawn, because a row at 80 columns gives up its
meta first and `relTime` is the bell's own local helper rather than something shared. A notice
carrying `review-config` or `review-plugin-request` opens its task, and not the trust modal the
desktop opens beside it: neither of those surfaces is drawn on this host.

**The badge is always on here** (requirement 3). The desktop reads the `badge` switch; there is no
device preference store in a terminal, and `ACORN_TUI_NOTIFY` is about the channels that interrupt
you rather than a number in your own topbar.

**The focus test is in client-core, not in the TUI suite** (the tests section, which asked for a
synthetic `BLUR` and `FOCUS`). Every test that draws is `describe.skipIf(!hasFfi)`, because OpenTUI's
renderer is Node 26.4 behind `--experimental-ffi` — so a focus case there would prove nothing on the
Node most of the repo runs on. What the phase actually adds to the gate is one seam, and it is
asserted where it runs: `defaultDeliveryContext` takes a host's own answer, in
`packages/client-core/src/features/notifications/deliver.test.ts`. The two chrome cases —
`◔ 2` with two unread notices, nothing with none, and `n` opening both sections — are in
`chrome.test.tsx` with the rest of its file, and run wherever the renderer does. `notify.test.ts` is
plain and covers the backend table, each sequence byte for byte, the tmux wrapping, sanitising, and
`ACORN_TUI_NOTIFY=off`.

## Doc moves when it shipped

`docs/tui.md` § What is drawn bespoke gained the count, the inbox overlay, the OSC channel and the
DEC 1004 focus rule; § Doors left open gained the device preference store. This file then goes with
the folder.
