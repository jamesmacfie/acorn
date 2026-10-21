# Use the mobile web app on a phone

This page covers reaching the [mobile web app](../mobile.md) from a phone, installing it to the home
screen, and how it behaves when the phone sleeps. Read it before you set up a phone, or change the
manifest, the service worker, or the reconnect.

## Use it on a phone

The phone needs an HTTPS name its browser trusts, because a web app can't install or run a service worker
over plain HTTP. [Tailscale](https://tailscale.com) gives the gateway one, and is the setup this app is
tested with. Any other network that gives the gateway a trusted HTTPS name works the same way.

1. In the Tailscale admin console, turn on MagicDNS and **Enable HTTPS** under **DNS**. Install Tailscale
   on the phone and sign in to the same tailnet.
2. On the Node's computer, put the gateway on the tailnet. The gateway stays on loopback, and
   `tailscale serve` is what a phone reaches:

   ```sh
   tailscale serve --bg --https=443 localhost:4320
   ```

   `tailscale serve status` shows it, and `tailscale serve --https=443 off` takes it down.
3. Start the gateway with the name `tailscale serve` printed:

   ```sh
   acorn mobile --origin https://HOST.TAILNET.ts.net
   ```

   It prints the address, a QR code, and a sign-in code, and runs until you press Ctrl+C. Without
   `--origin` it serves `http://127.0.0.1:4320`, which only the Node's own computer can open.
4. Scan the QR code, or open the address, and type the sign-in code. The phone stays signed in until
   someone runs `acorn mobile revoke ID`. `acorn mobile sessions` lists the IDs.

The gateway serves that one name and refuses a request with any other `Host`. `tailscale serve` keeps the
original `Host` and the browser's `Origin`, so the checks see the tailnet name
([check every request](../security/mobile-gateway.md#check-every-request)). That comes from Tailscale's
source and no one has run it on a real tailnet yet, so the device acceptance checks it.

`acorn mobile` reads the web app from the CLI's own `mobile` folder, which desktop staging and
`pnpm pack:node` fill from `apps/mobile/dist`. In a checkout, build the app and name it, as in
`acorn mobile --app-dir apps/mobile/dist`. `acorn mobile` takes `--node` to serve a remembered Node
other than this computer's, and `--port` to move the gateway from 4320.

## Install it

On an iPhone, open the address in Safari, tap **Share**, then **Add to Home Screen**. On Android, open it in
Chrome and tap **Install app**. The app then opens from its icon without the browser's bars.

`index.html` links `manifest.webmanifest`, one of the files in `apps/mobile/public/` that `dist` serves as they are. It names the app and its 192 and 512 pixel icons and sets
`display: standalone`. The icons are the desktop's, flattened onto white, because iOS draws transparency
black. iOS reads its own tags: `apple-touch-icon` and the `apple-mobile-web-app` set. The status bar style
is `default`, because `black-translucent` draws light text over a light top bar. The manifest's
`theme_color` is the default theme's top bar. `themeColor.ts` keeps `<meta name="theme-color">` at the
active theme's top bar, so Android's status bar follows a theme change.

`public/sw.js` is the whole service worker. A file of the app's own comes from the network when the
gateway answers and from its cache when it doesn't, so a relaunch draws the shell before the socket
connects. It never sees `/node`, `/session`, or `/events`, because those are the Node's data and the
client's own query cache keeps what it wants of them. `main.tsx` registers it in a built app only. It
keeps files of old builds until the browser clears the cache.

## Come back to the foreground

A phone suspends a page in the background and can drop its socket without a close. When the page becomes
visible, the transport closes its socket, opens a new one at once, and skips the backoff. The new
socket's first status makes client-core re-attach its subscriptions and refetch what's on screen
(`wsOnReconnect`). The Node shows `offline` only if the new attempt fails. `platform.test.ts` covers it.
