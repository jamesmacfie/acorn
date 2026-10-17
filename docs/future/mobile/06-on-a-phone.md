# Phase 6: run it on a real phone

Date: October 17, 2026. Status: proposed. Needs every earlier phase.

## Goal

A person installs the app to their phone's home screen and uses it away from their desk. The gateway
is reachable over Tailscale with a trusted certificate. Acceptance happens on real devices, because
desktop Chrome at phone width doesn't show keyboard, background, or install behavior.

## The design

### Reach the gateway

The gateway listens on loopback. `tailscale serve` puts it on the tailnet at
`https://HOST.TAILNET.ts.net` with a certificate the phone trusts. The gateway serves that one name and
refuses any other `Host`. Document the two commands in the app's setup page. Any other network that
gives the gateway a trusted HTTPS name works the same way, but this programme only tests Tailscale.

### Start the gateway

`acorn mobile` in the CLI starts the gateway from the packaged build, prints the address and the QR
code, and stops it on Ctrl+C. The desktop gets a **Phone** page in Settings later, if people use the
app. Until then the desktop needs no change.

### Install to the home screen

Add a web app manifest with the name, the icons from the desktop's icon set, `display: standalone`,
and the theme color from the active theme. iOS also needs `apple-touch-icon` and the
`apple-mobile-web-app` tags. A minimal service worker caches the app's own files so a relaunch draws
before the socket connects. It never caches a `/node` answer, because those belong to the client's
own cache.

### Come back to the foreground

A phone suspends a background page and drops its socket. On `visibilitychange` to visible, the
transport reconnects at once instead of waiting for its backoff, and the client refreshes its
queries. The offline state shows only after the reconnect fails.

## Acceptance

Test on a current iPhone with Safari, and on a current Android phone with Chrome. Record the device
and OS versions and the date with the results in `docs/testing/`:

1. Sign in with the code from the gateway, and stay signed in after the phone restarts.
2. Install to the home screen, and launch from the icon without browser chrome.
3. Answer a permission request and a question raised on the desktop.
4. Send a message with the on-screen keyboard open.
5. Lock the phone for five minutes, unlock it, and see fresh state within five seconds.
6. Stop the gateway mid-request, and see the offline state, then recovery when it starts again.
7. Revoke the session from the gateway, and see the sign-in screen on the phone.
8. Stop the Node mid-request, and see the Node-offline state, not a crash.

## When this phase ships

Move the shipped behavior into reference pages: the app and its shell under a page beside
[the terminal client](../../tui.md), the gateway in [security](../../security.md), and the
form factor in [the closed kit](../../ui-design/closed-kit.md). Update
[remote access](../remote.md) to say which of its decisions this programme answered and which remain.
Then trim this folder to what's left in [later](./later.md).
