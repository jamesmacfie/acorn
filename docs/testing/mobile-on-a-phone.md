# The mobile web app on real phones

This page is the acceptance for [the mobile web app](../mobile.md) on a real iPhone and a real Android
phone. No check has run yet. The owner fills in the tables on devices, because desktop Chrome at phone width
doesn't show the keyboard, background, or install behavior. Don't write a result here that you didn't see on
a device.

## What has run, and where

The code and the pieces below were checked in Chromium at 390 by 844, against a throwaway standalone Node
and `acorn mobile` from a copy of the packaged layout. None of it counts as a device result:

- The manifest parsed with no errors, and Chrome reported no installability errors.
- The service worker activated, controlled the page, and cached the app's files and nothing under `/node`,
  `/session`, or `/events`.
- With the gateway stopped, a reload drew the shell from the cache and said "Can't reach the gateway". With
  the gateway started again, the app opened without a reload.
- A `visibilitychange` to visible opened a new socket at once, the open screens refetched, and **Offline**
  didn't show.
- `<meta name="theme-color">` changed from `#fafafa` to `#1a1a1a` with the theme.

## Before you start

1. Turn on MagicDNS and HTTPS certificates in the Tailscale admin console. Install Tailscale on both phones
   and the Node's computer.
2. On the Node's computer, follow [use it on a phone](../mobile/phone-setup.md): run
   `tailscale serve --bg --https=443 localhost:4320`, then `acorn mobile --origin https://HOST.TAILNET.ts.net`.
3. Put the Node's own `acorn` build, the gateway's name, and the Tailscale version in the header of each run.

| Run | iPhone, Safari | Android, Chrome |
| --- | --- | --- |
| Device and model | Not yet run | Not yet run |
| OS and browser version | Not yet run | Not yet run |
| Acorn build | Not yet run | Not yet run |
| Tailscale version | Not yet run | Not yet run |
| Date | Not yet run | Not yet run |

## The eight checks

Mark each cell **Pass**, **Fail**, or **Blocked**, with a line on what you saw, or leave it **Not yet run**.

| # | Check | iPhone, Safari | Android, Chrome |
| --- | --- | --- | --- |
| 1 | Sign in with the code from the gateway, and stay signed in after the phone restarts. | Not yet run | Not yet run |
| 2 | Install to the home screen, and launch from the icon without browser chrome. | Not yet run | Not yet run |
| 3 | Answer a permission request and a question raised on the desktop. | Not yet run | Not yet run |
| 4 | Send a message with the on-screen keyboard open. | Not yet run | Not yet run |
| 5 | Lock the phone for five minutes, unlock it, and see fresh state within five seconds. | Not yet run | Not yet run |
| 6 | Stop the gateway mid-request, and see the offline state, then recovery when it starts again. | Not yet run | Not yet run |
| 7 | Revoke the session with `acorn mobile revoke ID`, and see the sign-in screen on the phone. | Not yet run | Not yet run |
| 8 | Stop the Node mid-request, and see the Node-offline state, not a crash. | Not yet run | Not yet run |

## Also check

Earlier phases and this one left these open. Each needs a real device or a real tailnet:

| Check | iPhone, Safari | Android, Chrome |
| --- | --- | --- |
| `tailscale serve` keeps the original `Host` and the browser's `Origin`, so sign-in works and the gateway's log shows no `wrong_host` or `wrong_origin`. | Not yet run | Not yet run |
| The event socket opens through `tailscale serve`, and a task's conversation updates without a reload. | Not yet run | Not yet run |
| The home screen icon draws on white, not black, and the app is named "Acorn". | Not yet run | Not yet run |
| The status bar reads on a light and on a dark theme (the status bar style is `default`). | Not yet run | Not yet run |
| Android's status bar follows a theme change (`theme-color`). | Not applicable | Not yet run |
| `visualViewport` reports the keyboard's height, and a field the browser scrolls into view leaves the composer and **Send** on screen. | Not yet run | Not yet run |
| With the keyboard up, the transcript still shows enough lines to be useful. The composer is about 280 pixels tall in the stub check. | Not yet run | Not yet run |
| The pane header at 390 pixels wide shows the usage chip, which the Chromium check saw overflow sideways. | Not yet run | Not yet run |
| A relaunch from the icon with the gateway stopped draws the shell from the service worker's cache. | Not yet run | Not yet run |
| A permission request answered on the phone clears on the desktop. No earlier check had an agent adapter to resolve one. | Not yet run | Not yet run |
| Long press opens a row's menu once. | Not yet run | Not yet run |
| A text input draws at 16 pixels, and Safari doesn't zoom into it. | Not yet run | Not applicable |

## Record problems

For each failure, name the check, the device, what you saw, and the file you'd start in. A problem in a
shared component goes in client-core, never in one plugin
([what holds across every phase](../future/mobile/README.md#what-holds-across-every-phase)). When every
cell reads **Pass** or **Not applicable**, delete `docs/future/mobile/` except [later](../future/mobile/later.md),
as [phase 6](../future/mobile/06-on-a-phone.md#when-this-phase-ships) says.
