# Phase 4: system notifications and the dock badge on the desktop

Shipped 2026-09-02. An unseen notice raises a real system notification, clicking it focuses the
window and opens the notice's target, and the app icon carries the bell's number. Both go through one
platform-seam group, with a page fallback where no shell installs it. Where each part landed:

- `packages/client-core/src/infra/platform/index.ts` holds the `Notify` type
  (`show`, `onActivate`, `setBadge`), the `notifyHost` accessor the contract checks, and the four
  verbs callers use: `showNotification`, `onNoticeActivated`, `canSetBadge`, and `setBadge`. The page
  fallback asks `Notification.requestPermission()` once, shows a silent notification tagged with the
  notice id, and keeps the object in a module map until it closes so its click handler is not
  collected. Its `setBadge` is a no-op and `canSetBadge` answers false.
- `packages/client-core/src/infra/platform/contract.ts` lists `notify` in `GROUPS` between `files`
  and `recovery`, so a bridge that renames a member fails `apps/desktop/src/shell/bridge.test.ts`.
- `apps/desktop/src/shell/bridge.ts` installs the group over two Tauri commands and one event.
- `apps/desktop/src-tauri/src/commands.rs` holds `show_notification`, `set_badge`, `activation_tag`,
  and `window_focused`; `src/lib.rs` initialises `tauri-plugin-notification`, registers the two
  commands, and calls `window_focused` on `RunEvent::WindowEvent` for the main window.
- `packages/client-core/src/features/notifications/deliver.ts` gains `systemSink` and
  `initSystemNotices`, which `apps/desktop/src/client/App.tsx` mounts beside `initSoundNotices`. The
  body is the notice's `detail` and nothing else.
- `packages/client-core/src/features/notifications/badge.ts` holds `trackBadge`, and
  `NotificationBell.tsx` calls it with the pill accessor and the `badge` switch. The bell also holds
  `openNotice`, which the popover row and an activation both call.
- `packages/client-core/src/features/settings/NotificationSettings.tsx` shows the app-icon row when
  `canSetBadge()` is true.

## Where the build departed from the requirements

**No plugin permission in the capability file** (requirement 5, which asked for
`notification:default` on the `main` webview). The renderer never invokes the plugin's own commands,
only ours, so the capability that would let it is one the product does not need.
`apps/desktop/src-tauri/capabilities/default.json` still grants `core:default` and nothing else, and
the sentence about the preview and plugin webviews stays true without being written twice.

**Activation is the focus approximation** (requirement 6, which asked which path landed).
`tauri-plugin-notification` 2.4 gives desktop no activation callback: its `show()` returns nothing to
hang one off. So `show_notification` records the tag in a `LAST_BANNER` static and `window_focused`
emits `acorn:notification-activated` if the window comes back within 30 seconds. The tag is taken
either way, so a stale banner cannot fire on some later focus.

**The badge effect is its own file, not a line in the bell** (requirement 10). `trackBadge` is six
lines in `badge.ts` because an effect inside `NotificationBell.tsx` can only be asserted by rendering
the whole popover, and the `logic` vitest project resolves solid-js to its server build where every
effect runs once and dead. `badge.test.tsx` carries a `.tsx` extension with no JSX in it for that
reason.

**The bell reads the badge switch through the prefs query, not `readNotificationSettings`**
(requirement 10). The device store is not reactive, so turning the badge off would have left the
number on the icon until the next unread. `parseNotificationSettings(prefs.data?.[...])` is what
`NotificationSettings.tsx` already does.

## Doc moves when it ships

`docs/shell.md` § The renderer bridge names the group, the capability line, and the focus
approximation. `docs/frontend.md` § Registries and plugins puts `notify` beside `files` as the second
seam group that carries its own page fallback. The owning doc phase 6 chooses gains both. This file
then goes with the folder.
