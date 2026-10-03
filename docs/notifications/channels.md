# Notification channels and settings

This page covers each channel a notice can reach beyond the bell row, and the settings that switch
them. It's part of [notifications](../notifications.md).

## The channels

Each channel fires under its own condition:

| Channel | Fires when |
| --- | --- |
| Bell row | Always. Read if seen. |
| Sound | Not seen, and `sound` is on. |
| System notification | Not seen, the kind's `toast` is true, `system` is on, and the host has a `notify` seam or the page fallback. |
| Badge | Whenever the pill changes, if `badge` is on and the host can draw one. |
| Terminal notification | The terminal client's version of the last two: an escape sequence, and BEL for the sound. |

### Sound

`packages/client-core/src/features/notifications/chime.ts` synthesizes two chimes from sine notes
and a gain envelope. No audio file ships, so a test can assert a chime without an `AudioContext`.
`attention` rises a fourth, E5 to A5, for `blocked` and `error`. `done` falls the same fourth, for
`finished`. Both end within 320 ms at a gain of 0.1 to 0.12, so a burst of edges sounds like separate
chimes, not a chord. There are two tones because `blocked` and `error` both mean "come here", and the
title already tells them apart. `initSoundNotices` registers the sink and resumes a suspended audio
context on the first click or key press.

### System notification and badge

Both go through the platform seam's `notify` group: `showNotification`, `onNoticeActivated`,
`canSetBadge`, and `setBadge` in `packages/client-core/src/infra/platform/index.ts`. A web page has
`Notification`, so the seam carries its own fallback. It asks for permission once, shows a silent
banner tagged with the notice ID, and holds the object until it closes, so the click handler isn't
garbage-collected. Its `canSetBadge` returns false, and Settings hides the app-icon row. A shell that
installs the group takes over the banner and adds the badge.

Delivering a notification and focusing the window keep the selected task, pane, and session. Only
activating the notification or clicking the row in the bell opens its target. For the desktop
commands and macOS click handling, see [shell](../shell/bridge-and-broker.md) § The renderer bridge.

`toast` is the kind's own answer to "may this reach the desktop", and both it and the owner's
setting have to say yes. `background-error` and `disk-unencrypted` set it to `false`, because a
standing condition and a swallowed background error belong in the bell. The Node forces a loaded
plugin's notice to the `plugin` kind, which is also `toast: false`, so third-party code can't put
text on the owner's desktop.

The banner's body is the notice's `detail` and nothing else. A title carries no prompt text,
responses, file names, or paths (`pushManagedAgentNotice`), and the notification center keeps what
it's shown. An OS banner says what happened, never what the agent said.

The badge is the pill. `packages/client-core/src/features/notifications/badge.ts` puts
`unreadCount()` plus the attention rows on the icon, the same accessor the bell draws. The dock and
the terminal client's top bar show the same number.

The icon keeps the last count it was given, so the tracking clears it when its own scope ends. The
desktop tracks the badge from the bell. A window closing, a shell rebuilt on a Node switch, a dev
reload, or the bell's contribution boundary catching a render error all end the tracking. Without
the clear, the dock would keep a count no view in the app can reach.

### Terminal

`apps/tui/src/kit/notify.ts` writes an escape sequence and lets the terminal emulator decide what a
notification looks like:

- OSC 9 for iTerm2, Ghostty, WezTerm, and Warp.
- OSC 99 for kitty.
- OSC 777 for rxvt.

Inside tmux, when `TMUX` is set, the sequence goes inside a DCS passthrough with every ESC doubled.
The title and body lose any character that could end the sequence early. A terminal on none of
these lists gets the BEL from `apps/tui/src/kit/bell.ts` and nothing else. The client learns whether
the terminal has focus from DEC mode 1004, which the input parser reports as `focus` and `blur`
events. `apps/tui/src/main.tsx` passes them to `setHostFocused`.

## Settings

The settings are one JSON device preference under `PrefKeys.notifications`, listed in `DEVICE_KEYS`
(`packages/client-core/src/infra/persistence/prefKeys.ts` and
`packages/client-core/src/infra/persistence/devicePrefs.ts`):

```json
{
  "sound": true,
  "system": true,
  "badge": true,
  "events": { "blocked": true, "finished": true, "error": true }
}
```

The six booleans live in one key, because they're read together. A missing field, or one that isn't
a boolean, reads as `true`, so a fresh install and a blob from an older build behave the same. Only
an explicit `false` turns a channel off.

The three event switches turn an edge off entirely, bell row included. A row that lands silently but
still counts in the pill would still be telling you about the edge.

Settings shows five checkboxes, an app-icon row where `canSetBadge()` is true, and a **Send a test**
button (`packages/client-core/src/features/settings/NotificationSettings.tsx`). The button runs a
synthetic unseen edge through `deliverNotice`, and it's where the browser asks for notification
permission.

The gate reads `localStorage` directly instead of the preference query. It's a plain module with no
component around it and no query client, and this key never reaches a Node. The Settings page reads
through the query, because it needs the reactivity.

The terminal client has no device preference store, so an environment variable is the switch.
`ACORN_TUI_NOTIFY` takes `off`, `bell`, `terminal`, or `both`, and defaults to `both`, the same
shape as `ACORN_TUI_OSC52`. Its badge is always on, because the count sits in your own top bar
instead of interrupting you. A file-backed store that would let the Settings page work there is a
proposal in [the terminal review](../future/tui-review/open-doors.md).
