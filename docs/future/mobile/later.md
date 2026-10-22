# Mobile work after the first release

Date: October 17, 2026. Status: proposed. Not phased.

These pieces wait until people use the [first release](./README.md). Each needs a decision from the
owner before it becomes a phase. [Remote access to a browser host](../remote.md) owns the wider design
for most of them. Moving phone sessions to the Node and reaching more than one Node moved to
[remote access](../remote-access/phone.md) on October 22, 2026.

## Send notifications to a sleeping phone

A locked phone holds no socket, so **Needs you** only updates when the app is open. Background
delivery needs Web Push: the phone gives the Node a push subscription, and the Node sends a
notification when the attention inbox gains an item. The notification carries no task content, only
a count and the task's title, because it passes through Apple's or Google's push service. iOS
delivers web push only to an app installed to the home screen. The Node owns the subscription, since
each phone is its own device there once [remote access phase 4](../remote-access/phases/04-phone.md)
ships.

## Run loaded plugins on a phone

The first release runs built-in plugins only. A loaded plugin's tree needs browser custody: storing
the bundle, hashing it, and recording the owner's trust decision
([browser plugin custody](../remote.md#implement-browser-plugin-custody)). A frame plugin also needs an
origin of its own per bundle, which the desktop gets from a custom scheme and a browser doesn't
have. Trees come first, because they draw with the kit and get the narrow mode for free.

## Reuse the narrow mode in the browser extension

The extension's sidebar is about as wide as a phone, and it draws its own screens instead of plugin
panes. Once the narrow layouts ship, the sidebar could draw a plugin's real pane through
`TaskPaneHost` instead of the separate panel format
([plugin panels](../../browser-extension/plugin-panels.md)). That needs a transport over the native
bridge, which reaches the Node by named operations and never by raw route. Weigh that change to the
bridge's security model before you start.

## Wrap it in a native app

A native wrapper around the same bundle can pin the Node's certificate, hold the token in the
phone's keychain, and receive native push. It adds an app store release for each platform. Revisit it
if Tailscale is the step that stops people from using the app.
