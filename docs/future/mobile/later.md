# Mobile work after the first release

Date: October 17, 2026. Status: proposed. Not phased.

These pieces wait until people use the [first release](./README.md). Each needs a decision from the
owner before it becomes a phase. Moving phone sessions to the Node and reaching more than one Node moved to
[the phone channel](../../relay/phone-channel.md) on October 22, 2026.

## Send notifications to a sleeping phone

A locked phone holds no socket, so **Needs you** only updates when the app is open. Background
delivery needs Web Push: the phone gives the Node a push subscription, and the Node sends a
notification when the attention inbox gains an item. The notification carries no task content, only
a count and the task's title, because it passes through Apple's or Google's push service. iOS
delivers web push only to an app installed to the home screen. The Node owns the subscription, since
each phone is its own device there ([the phone channel](../../relay/phone-channel.md#a-device-for-each-phone)).

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
