# The mobile web app on real phones

This page is the acceptance for [the mobile web app](../mobile.md) on a real iPhone and a real Android
phone. No check has run yet. The owner fills in the tables on devices, because desktop Chrome at phone width
doesn't show the keyboard, background, or install behavior. Don't write a result here that you didn't see on
a device.

## What has run, and where

The code and the pieces below were checked in WebKit and Chromium at 390 by 844, against throwaway standalone
Nodes, a relay, and the stand-in account service, on October 22, 2026. None of it counts as a device
result. The numbers are in [phase 4's evidence](../future/remote-access/04-phone.md#evidence).

- The app signed in through the stand-in, paired with a Node by approval, and drew its workspaces.
- A channel opened through a relay, and the relay's traffic held none of the requests or tokens in
  readable form.
- A Node whose key wasn't the pinned one was refused.
- Dropping and restoring the browser's network reopened the channel, and the open screens refetched.
- The manifest parsed with no errors, and the service worker kept the app's files and nothing under
  `/account`.
- `<meta name="theme-color">` changed from `#fafafa` to `#1a1a1a` with the theme.

## Before you start

1. Turn on **Remote access** on the Node under **Settings → Account**, and sign in to the account website
   on the phone.
2. Pair the phone with the Node ([use it on a phone](../mobile/phone-setup.md)).
3. Put the Node's own `acorn` build and the website's address in the header of each run.

| Run | iPhone, Safari | Android, Chrome |
| --- | --- | --- |
| Device and model | Not yet run | Not yet run |
| OS and browser version | Not yet run | Not yet run |
| Acorn build | Not yet run | Not yet run |
| Date | Not yet run | Not yet run |

## The eight checks

Mark each cell **Pass**, **Fail**, or **Blocked**, with a line on what you saw, or leave it **Not yet run**.

| # | Check | iPhone, Safari | Android, Chrome |
| --- | --- | --- | --- |
| 1 | Sign in to the account and pair with the Node, and stay signed in after the phone restarts. | Not yet run | Not yet run |
| 2 | Install to the home screen, and launch from the icon without browser chrome. | Not yet run | Not yet run |
| 3 | Answer a permission request and a question raised on the desktop. | Not yet run | Not yet run |
| 4 | Send a message with the on-screen keyboard open. | Not yet run | Not yet run |
| 5 | Lock the phone for five minutes, unlock it, and see fresh state within five seconds. | Not yet run | Not yet run |
| 6 | Turn off Wi-Fi on the phone mid-request, and see the offline state, then recovery on mobile data. | Not yet run | Not yet run |
| 7 | Revoke the phone from **Settings → Nodes** on a computer, and see the phone say it is signed out of the Node. | Not yet run | Not yet run |
| 8 | Stop the Node mid-request, and see the Node-offline state, not a crash. | Not yet run | Not yet run |

## Also check

Earlier phases and this one left these open. Each needs a real device or a real tailnet:

| Check | iPhone, Safari | Android, Chrome |
| --- | --- | --- |
| The channel's handshake works with the browser's own primitives, and a task's conversation updates without a reload. | Not yet run | Not yet run |
| IndexedDB keeps the sealed token and its key across a restart, and a Safari that clears site data after seven days of no use asks to pair again. | Not yet run | Not yet run |
| The home screen icon draws on white, not black, and the app is named "Acorn". | Not yet run | Not yet run |
| The status bar reads on a light and on a dark theme (the status bar style is `default`). | Not yet run | Not yet run |
| Android's status bar follows a theme change (`theme-color`). | Not applicable | Not yet run |
| `visualViewport` reports the keyboard's height, and a field the browser scrolls into view leaves the composer and **Send** on screen. | Not yet run | Not yet run |
| With the keyboard up, the transcript still shows enough lines to be useful. The composer is about 280 pixels tall in the stub check. | Not yet run | Not yet run |
| The pane header at 390 pixels wide shows the usage chip, which the Chromium check saw overflow sideways. | Not yet run | Not yet run |
| A relaunch from the icon with no network draws the shell from the service worker's cache. | Not yet run | Not yet run |
| A permission request answered on the phone clears on the desktop. No earlier check had an agent adapter to resolve one. | Not yet run | Not yet run |
| Long press opens a row's menu once. | Not yet run | Not yet run |
| A text input draws at 16 pixels, and Safari doesn't zoom into it. | Not yet run | Not applicable |

## Record problems

For each failure, name the check, the device, what you saw, and the file you'd start in. A problem in a
shared component goes in client-core, never in one plugin
([what holds across every phase](../future/mobile/README.md#what-holds-across-every-phase)). When every
cell reads **Pass** or **Not applicable**, delete `docs/future/mobile/` except [later](../future/mobile/later.md),
as [phase 6](../future/mobile/06-on-a-phone.md#when-this-phase-ships) says.
