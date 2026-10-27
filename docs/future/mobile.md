# What's left for the mobile web app

Date: October 28, 2026. Status: the app is built, and the work below is open. It replaces the
`docs/future/mobile/` phases, which shipped between October 21 and 22, 2026, and are in Git history.

[The mobile web app](../mobile.md) and the pages under `docs/mobile/` own the shipped behavior. Its
[limits](../mobile.md#limits) list what the app leaves out on purpose. This page lists only work someone
still has to do. Plugins on the phone have their own plan in [mobile-plugin/](./mobile-plugin/README.md).

## Run it on real phones

Nobody has run the app on a real phone. Run [the real-device checklist](../testing/mobile-on-a-phone.md)
on an iPhone with Safari and an Android phone with Chrome, through the production relay. That run is also
step 3 of [remote access phase 5](./remote-access/05-production.md).

The phases left these device checks that the checklist doesn't name. Do them in the same run:

- After a long press opens a row's menu, letting go doesn't press the row, and iOS doesn't draw its text
  callout over the menu. Rows don't set `-webkit-touch-callout` or `user-select`.
- Safari doesn't zoom when you tap into the code editor. CodeMirror's editable area isn't an `input`, so
  the 16 pixel input size doesn't reach it.
- A row's twist and a native check box can be hit with a finger. Both are smaller than 44 pixels and sit
  inside a 44 pixel row.
- A pinned footer stays above the on-screen keyboard.

## Fix small things on a phone

These were seen in Chromium at 390 by 844 and left alone:

- With the keyboard up, the agent composer is about 280 pixels tall and the transcript nearly disappears.
  Trimming the composer's notice and hint lines on a phone would give the transcript room.
- The agent pane's header row overflows sideways at 390 pixels and cuts off the usage chip.
- A pane that opens on its detail shows two back arrows stacked at the top: the phone's own, back to the
  task list, and the layout's **Back**, back to the list.
- In Git, switching to a tab that remembers a selection can push that tab's detail, because the selection
  key changed.

## Check what nobody walked

- Every `role="dialog"` modal draws as a sheet on a phone. Only the new task form was checked.
- The `document-over-frame` and `stack-split` layouts have unit tests but weren't checked in the phone
  shell, because no built-in plugin used them then.

## Later, each needing a decision first

### Send notifications to a sleeping phone

A locked phone holds no channel, so **Needs you** updates only while the app is open. Background delivery
needs Web Push: the phone gives the Node a push subscription, and the Node sends a notification when the
attention inbox gains an item. The notification carries only a count and the task's title, because it
passes through Apple's or Google's push service. iOS delivers web push only to an app installed on the
home screen. The Node owns the subscription, since each phone is its own device there
([the phone channel](../relay/phone-channel.md#a-device-for-each-phone)).

### Reuse the narrow mode in the browser extension

The extension's sidebar is about as wide as a phone, and it draws its own screens instead of plugin
panes. The sidebar could draw a plugin's real pane through `TaskPaneHost` instead of the separate panel
format ([plugin panels](../browser-extension/plugin-panels.md)). That needs a transport over the native
bridge, which reaches the Node by named operations and never by raw route. Weigh that change to the
bridge's security model before you start.

### Wrap it in a native app

A native wrapper around the same bundle could hold the token in the phone's keychain and receive native
push. It adds an app store release for each platform. Revisit it if the browser's limits stop people using
the app, such as Safari clearing an unused site's data after seven days.

### Add a Phone page to the desktop's Settings

The desktop has no page about the phone. Add one if people use the app and can't find how to start.
