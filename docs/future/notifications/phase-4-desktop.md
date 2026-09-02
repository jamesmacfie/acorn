# Phase 4: system notifications and the dock badge on the desktop

Design, 2026-09-02. Not started. Depends on phase 2 (the `system` and `badge` toggles exist).

## Goal

An unseen edge raises a real system notification on macOS, Windows, and Linux, clicking it focuses
the window and opens the notice's target, and the app icon shows the bell's number. Both go through
one new platform-seam group, with a web fallback where no shell installs it.

## Why

[analysis.md](./analysis.md) finding 8: today's toast is a bare constructor call with no permission
and no plugin behind it. The user asked for an OS-level notification and an unread count on the
dock icon. The seam already has the shape for a host-owned verb with a page fallback
(`pickFiles` and `saveFile` in `packages/client-core/src/infra/platform/index.ts`), so this is the
third instance of a pattern, not a new one.

## Requirements

1. A seam group `notify` in `packages/client-core/src/infra/platform/index.ts`:
   `type Notify = { show(request: { title: string; body?: string; tag: string }): Promise<boolean>; onActivate(cb: (tag: string) => void): () => void; setBadge(count: number | null): void }`.
   `tag` is the notice id, so an activation can find its notice. Accessors `notifyHost()` (the
   installed group or null, for the contract) and `showNotification()` / `setBadge()` (the verbs
   with fallback, for callers).
2. The web fallback for `show`: `Notification.requestPermission()` if the state is `default`, then
   `new Notification(title, { body, tag, silent: true })`, holding the object in a module map until
   its `close` event so its click handler is not collected (orca's note in
   [references.md](./references.md)). `onclick` focuses the window and calls the activation
   callbacks. The fallback `setBadge` is a no-op, and `canSetBadge()` reports false so the settings
   row hides.
3. `packages/client-core/src/infra/platform/contract.ts` gains a `notify` entry in `GROUPS` with
   members `['show', 'onActivate', 'setBadge']`, so `apps/desktop/src/shell/bridge.test.ts` fails if
   the bridge renames one.
4. `apps/desktop/src/shell/bridge.ts` installs `notify` on the object it assigns: `show` invokes a
   Tauri command, `onActivate` subscribes to an `acorn:notification-activated` event, `setBadge`
   invokes a command. The bridge's own comment explains why these are the shell's and not the
   helper's: a notification and a badge belong to the window's process.
5. `apps/desktop/src-tauri/Cargo.toml` adds `tauri-plugin-notification = "2"`;
   `apps/desktop/src-tauri/src/lib.rs` initialises it beside dialog and opener;
   `apps/desktop/src-tauri/capabilities/default.json` adds `notification:default` for the `main`
   webview only, with a sentence in its description saying why the preview and plugin webviews do not
   get it. `apps/desktop/package.json` adds `@tauri-apps/plugin-notification` if the bridge uses the
   JS binding rather than a command; prefer a command in `apps/desktop/src-tauri/src/commands.rs` so
   the capability stays `core:default` plus one plugin permission.
6. The Rust `show_notification` command asks the plugin for permission if not granted, builds the
   notification with the title and body and no sound (sound is phase 3's), and shows it. Click
   handling: verify what `tauri-plugin-notification` v2 offers on desktop for activation callbacks.
   If it offers none, the command records the tag and the shell emits `acorn:notification-activated`
   on the next window focus event if a tag was shown in the last 30 seconds, which is herdr's
   `terminal-notifier -activate` behaviour approximated. Say which path landed in the file.
7. The Rust `set_badge` command calls `set_badge_count(Some(n))` or `set_badge_count(None)` on the
   main window. Verify the method's name and minimum Tauri version in the installed `tauri` crate
   before building, and what it does on Windows and Linux; the seam contract does not promise a
   badge everywhere, only that the call is safe.
8. A system-notification sink joins `deliver`'s list: fires when `settings.system` is on and the edge
   is unseen; body is the notice `detail` when present and nothing else. No prompt text, file name,
   or path reaches the OS (the rule `pushManagedAgentNotice` already keeps).
9. Activation: `onActivate(tag)` marks the notice read and runs the same click path as the bell row
   in `packages/client-core/src/features/notifications/NotificationBell.tsx`: select the task, then
   the `action`, then `openNoticeTarget`. Factor that path out of the component so both call one
   function.
10. The badge: one `createEffect` where the bell's pill number is computed, calling `setBadge` with
    the pill's number or null for zero, when `settings.badge` is on and `canSetBadge()`. Off sets
    null once. The number is the pill's, computed once; the badge never counts anything the pill does
    not.
11. Settings → Notifications shows the badge checkbox when `canSetBadge()` is true, and the
    **Send a test notification** button asks for permission through `show`.

## Design notes

**Why a seam group and not a Tauri import in client-core.** `tools/arch/boundaries.test.ts` fails a
file outside the platform folder that names the host global, and `docs/shell.md` § The renderer
bridge says the seam is the only door. The terminal client will install its own `notify` group in
phase 5 with OSC behind it, which is the whole point of a seam.

**Why `silent: true` everywhere.** verne, emdash, and orca all found the OS sound option
unreliable. Phase 3 owns sound and plays it whether or not the system notification shows.

**Why the badge is the pill.** One number with one meaning. cmux badges its unread count; the pill
is acorn's unread count. If the two ever differ, one of them is wrong.

**Why the capability is on the `main` webview only.** The description in
`apps/desktop/src-tauri/capabilities/default.json` already says it: the preview pane and plugin
webviews render pages this app does not write, and a page that can raise a system notification with
acorn's icon is a phishing surface.

## Files

- `packages/client-core/src/infra/platform/index.ts`: the `Notify` type, accessors, web fallback.
- `packages/client-core/src/infra/platform/contract.ts`: the `notify` group.
- `apps/desktop/src/shell/bridge.ts`: the installed group.
- `apps/desktop/src/shell/bridge.test.ts`: passes with the new group listed as implemented.
- `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/src/lib.rs`,
  `apps/desktop/src-tauri/src/commands.rs`, `apps/desktop/src-tauri/capabilities/default.json`.
- `packages/client-core/src/features/notifications/deliver.ts` (new in phase 1): the system sink.
- `packages/client-core/src/features/notifications/NotificationBell.tsx`: the click path factored
  out; the badge effect.
- `packages/client-core/src/features/settings/NotificationSettings.tsx` (new in phase 2): the badge row.

## Tests

- `packages/client-core/src/infra/platform/` contract test: a mock host with `notify` passes
  `seamProblems(['notify'])`; a host missing `setBadge` fails with `notify.setBadge: not a function`.
- `deliver.test.ts`: the system sink fires for unseen edges with `system` on and not otherwise; the
  body never contains the notice title's prompt text (a fixture with a path in `detail` is passed
  through, a fixture with a path in `title` is not the body).
- The badge effect: with a fake `setBadge`, the pill going 0 → 2 → 0 calls `setBadge(2)` then
  `setBadge(null)`; with `badge` off it is called once with null.
- Rust: a unit test in `commands.rs` for whatever pure mapping exists, and the boot test in
  `apps/desktop` still passes with the plugin initialised.

## Acceptance

- Requirements 1 to 11 hold.
- On macOS, with task B active and a session in task A asking for permission, a notification
  banner appears, the dock shows 1, clicking the banner focuses acorn on task A with the request
  visible, and the dock clears.
- In a browser served by `dev:node`, the same edge asks for permission once and then shows a web
  notification; there is no badge row in settings.
- Every existing test passes.

## Doc moves when it ships

`docs/shell.md` § The renderer bridge lists `notify` among the groups and names the capability line.
`docs/frontend.md` § Registries and plugins gains the `notify` group beside `files`. This file shrinks
to a pointer.
