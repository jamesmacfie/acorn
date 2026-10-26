# Phase 6: run it on a real phone

Date: October 17, 2026. Status: built, with the real-device acceptance not yet run. Needs every earlier
phase.

## Completion note

Completed October 21, 2026, apart from the real-device acceptance, which the owner still has to run.
[Mobile web app](../../mobile/phone-setup.md) owns the shipped behavior,
[the gateway](../../relay/phone-channel.md) owns the `Host` check, and
[`acorn mobile`](../../mobile/phone-setup.md) owns the command. This page stays, with the rest of this folder,
until [the acceptance](../../testing/mobile-on-a-phone.md) passes.

### What landed

- `acorn mobile`, `acorn mobile sessions`, and `acorn mobile revoke ID`. The command runs the gateway
  as a child process from a new `mobile-gateway` entry in the CLI build, so the CLI never loads the
  server. The gateway takes `--app-dir`, and the CLI passes the `mobile` folder beside `cli.js`.
- The staging scripts put `apps/mobile/dist` in that folder: `apps/desktop/scripts/stage.mjs` for the
  app (`Resources/cli/mobile`) and `scripts/pack-node.mjs` for the standalone package. `pnpm
  --filter @acorn/desktop run stage` builds the phone app first.
- `apps/mobile/public/`: `manifest.webmanifest`, 192 and 512 pixel icons and a 180 pixel
  `apple-touch-icon`, and `sw.js`. `index.html` has the manifest link, the iOS tags, and `theme-color`.
  `main.tsx` registers the worker in a built app. `themeColor.ts` keeps `theme-color` at the active
  theme's top bar.
- `visibilitychange` to visible in the phone's transport: it replaces the socket at once.
- Tests: the visibility cases in `platform.test.ts`, `serviceWorker.test.ts`, and `mobile.test.ts` in the
  CLI.
- Docs: a setup section in `docs/mobile.md`, `docs/cli/mobile.md` (deleted in remote access phase 4), the real-device results page
  `docs/testing/mobile-on-a-phone.md` with every row "Not yet run", and updates to the gateway page,
  the closed kit, packaging, `docs/future/remote.md` (deleted October 26, 2026), and the indexes.

I checked what a desktop browser can in Chromium at 390 by 844, against a throwaway standalone Node and
`acorn mobile` run from a copy of the packaged layout. The manifest parsed with no errors and Chrome
found no installability errors. The service worker activated, and it cached the app's files and no
`/node`, `/session`, or `/events` request. With the gateway stopped, a reload drew the shell from the
cache, and starting the gateway again opened the app without a reload. A `visibilitychange` opened a
new socket at once and refetched the open screens without showing **Offline**. `theme-color` followed
a change to the dark theme. Ctrl+C stopped both processes. The startup budget is 493,055 B of
scripts and 124,054 B of styles, under the ceilings. I ran no device, no Tailscale, and no packaged
desktop build.

### Decisions and deviations

- **No Tailscale detection.** `acorn mobile` doesn't read the tailnet name. A phone needs the name
  `tailscale serve` printed, so the person passes it with `--origin`. Reading it from `tailscale status`
  would need the CLI's path on macOS, where the app's binary isn't on `PATH`. Add it if people trip on
  this step.
- **`tailscale serve` keeps the `Host`, from its source and not from a run.** Its proxy sets
  `Out.Host = In.Host` for a TCP target, passes the browser's `Origin` through, and adds `X-Forwarded-*`,
  which the gateway already drops. The acceptance checks it on a real tailnet.
- **The gateway runs as a child, not as an import.** The gateway's entry runs on import, and a child
  keeps `ws` and the server out of every other CLI command. The cost is a second process. The CLI
  ignores Ctrl+C itself and waits, because the terminal sends it to both.
- **The web app sits beside `cli.js`, so no Tauri resource changed.** A checkout's `apps/cli/dist` has no
  `mobile` folder, so there `acorn mobile` needs `--app-dir apps/mobile/dist`, and the gateway says so
  when the folder has no `index.html`.
- **The service worker is network first.** A file comes from the network, and from the cache only when
  the gateway doesn't answer, so a new build shows on the next load with no versioning. It keeps files of
  old builds, which is a known shortcut in `sw.js`.
- **The icons are the desktop's flattened onto white.** The desktop's `icon.png` has transparent
  corners, which iOS fills with black. The files are drawn from it in Chromium, not a new design.
- **The status bar style is `default`.** `black-translucent` would draw light text over the light top
  bar. A dark theme gets a light status bar on iOS. The acceptance checks both.
- **The manifest's `theme_color` is one fixed value**, the default theme's top bar, because a manifest
  can't change. The `theme-color` tag follows the active theme.
- **A foreground replaces a healthy socket too.** The page can't tell a dead socket from a live one that
  missed events, and the reconnect already re-attaches and refetches. A quick switch away and back costs
  one refetch.
- **No Phone page in the desktop's Settings.** This page said to wait and see.

### What is left for the owner

- Run [the acceptance](../../testing/mobile-on-a-phone.md) on an iPhone with Safari and an Android phone
  with Chrome, and record the devices, versions, and date there.
- Run `pnpm --filter @acorn/desktop run build` on a graphical host and check that `acorn mobile` works
  from the installed app, and that the installer's size is acceptable with the phone app in it
  (650 files, 13.9 MB before compression, mostly syntax-highlighter languages and diagram code that
  load on use). I didn't build the desktop app.
- When every cell passes, delete this folder except [later](./later.md).

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
`docs/future/remote.md` (deleted October 26, 2026) to say which of its decisions this programme answered and which remain.
Then trim this folder to what's left in [later](./later.md).
