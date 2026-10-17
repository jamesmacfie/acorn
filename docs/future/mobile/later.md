# Mobile work after the first release

Date: October 17, 2026. Status: proposed. Not phased.

These pieces wait until people use the [first release](./README.md). Each needs a decision from the
owner before it becomes a phase. [Remote access](../remote.md) owns the wider design for most of them.

## Send notifications to a sleeping phone

A locked phone holds no socket, so **Needs you** only updates when the app is open. Background
delivery needs Web Push: the phone gives the gateway a push subscription, and the gateway sends a
notification when the attention inbox gains an item. The notification carries no task content, only
a count and the task's title, because it passes through Apple's or Google's push service. iOS
delivers web push only to an app installed to the home screen. Decide who owns the subscription
before you build it: the gateway, or the Node once it holds browser sessions.

## Move browser sessions to the Node

The gateway lets the UI work start without changing the Node. In the end, the Node may own browser
sessions itself, so each phone is its own device with its own audit trail and revocation. That needs
the five decisions in [build a single-Node browser host](../remote.md#build-a-single-node-browser-host):
session storage, socket auth, origin checks, who serves the bundle, and a trusted certificate. The
phone's shell doesn't change when this lands, because only its `transport` group talks to the
gateway.

## Run loaded plugins on a phone

The first release runs built-in plugins only. A loaded plugin's tree needs browser custody: storing
the bundle, hashing it, and recording the owner's trust decision
([browser plugin custody](../remote.md#implement-browser-plugin-custody)). A frame plugin also needs an
origin of its own per bundle, which the desktop gets from a custom scheme and a browser doesn't
have. Trees come first, because they draw with the kit and get the narrow mode for free.

## Reach more than one Node

The gateway serves one Node. A phone that switches Nodes needs the `fleet` group's read and select
verbs against a gateway that holds several, or one gateway per Node with the phone remembering each
address. Start with the second, because it needs no gateway change.

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
