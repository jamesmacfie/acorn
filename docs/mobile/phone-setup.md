# Use the mobile web app on a phone

This page covers opening the [mobile web app](../mobile.md) on a phone, installing it to the home screen,
serving it from your own host, and how it behaves when the phone sleeps. Read it before you set up a
phone, or change the manifest, the service worker, or the reconnect.

## Use it on a phone

The phone needs no Tailscale and no command left running on the Node's computer. The account website
serves the app under an ordinary certificate, and the phone reaches the Node through a relay.

1. In Acorn on the Node's computer, open **Settings → Account**, sign in, and turn on **Remote access**.
2. On the phone, open the account website and sign in with the same account. The app lists the account's
   Nodes.
3. Press **Connect** on the Node. The phone shows three words.
4. On a device that is already paired, such as the desktop on the Node's computer, check that it shows the
   same three words and press **Allow**. The first phone pairs this way, with someone at the Node's computer.

After that the phone works from any network, with no pairing again. The next phone pairs the same way,
approved on the first. A device that is already paired can answer a request, including a phone: when the
phone is the only device online, it shows the same dialog.

A Node that registered before phones existed has no channel key, and the phone says so. Turn **Remote
access** off and on again in Acorn, which registers it again ([the phone channel](../relay/phone-channel.md)).

## Serve it yourself

The account website's operator serves `apps/mobile/dist` under `/app/`, on the same origin as the account
API, with a content security policy of `script-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'self'`, plus a `frame-src` for the sandbox domain
([below](#serve-the-sandbox-domain)). The build sets Vite's `base` to `/app/`, so every file and
every route of the app is under that path and the website keeps its own pages at its root. Any path that
has no extension answers with `index.html`.

The app calls `/account/v1` on its own origin and needs nothing else from the host, so any host with a
trusted name that also answers the account API serves it. Build it with `pnpm --filter @acorn/mobile build`.

Someone who never signs in can't pair a phone yet, because the key the phone pins comes from the account's
list of Nodes.

## Serve the sandbox domain

Plugin code on the phone runs on a domain of its own, one host name per bundle
([the phone's plugin worker](./plugin-sandbox.md)). A phone build with no sandbox
domain draws no plugin trees. To set one up:

1. Register a domain that isn't a subdomain of the app's. The same site would share cookies with the app.
2. Add a wildcard DNS record and a wildcard certificate for it.
3. Build the app with the domain in `ACORN_SANDBOX_DOMAIN`, a name and an optional port with no scheme:
   `ACORN_SANDBOX_DOMAIN=sandbox.example pnpm --filter @acorn/mobile build`.
4. Serve `apps/mobile/dist-sandbox` on every name under the domain. It holds `worker.html` and
   `worker-host.js`, and nothing else is a page. Send the headers in `dist-sandbox/headers.json` on every
   response, including a 404. `apps/mobile/sandbox/headers.mts` writes them.
5. Add `frame-src https://*.sandbox.example` to the app's content security policy, and nothing else. The app
   frames a relay page for each bundle it runs.

The sandbox holds no bundles and no secrets. The app posts the bytes, and the page refuses any that don't hash
to its own host name. The page sets no `frame-ancestors` and doesn't check its parent's origin, because it can't name the app's
origin. A stranger who frames it gets only code that is public under its own hash.

## Try the sandbox

`pnpm dev:mobile` also serves the sandbox domain, as `localhost:4322` (`ACORN_SANDBOX_PORT` changes the port),
and a probe bundle that needs no account, Node, or plugin custody. Open `/app/dev/sandbox` on the dev server.
The page posts the probe to a relay page at `http://<label>.localhost:4322`, and the probe draws a line, then
tries `fetch`, a `WebSocket`, a module import from another origin, and `indexedDB.databases()`, and draws what
happened.

- `?probe=<origin>` names where the escape attempts go. Run a server there and expect it to log no request.
- `?bytes=tampered` posts one byte more than the bundle's hash names. The relay refuses it, and the page shows
  `.sandbox-fixture-failed`.

Only a development build has the page. A production build has no probe bundle and nothing that sets the source
of bundle bytes, so a phone refuses to start a tree until the plugin custody phase supplies one.

## Install it

On an iPhone, open the address in Safari, tap **Share**, then **Add to Home Screen**. On Android, open it in
Chrome and tap **Install app**. The app then opens from its icon without the browser's bars.

`index.html` links `manifest.webmanifest`, one of the files in `apps/mobile/public/` that `dist` serves as
they are. It names the app and its 192 and 512 pixel icons and sets `display: standalone`. The icons are the
desktop's, flattened onto white, because iOS draws transparency black. iOS reads its own tags:
`apple-touch-icon` and the `apple-mobile-web-app` set. The status bar style is `default`, because
`black-translucent` draws light text over a light top bar. The manifest's `theme_color` is the default
theme's top bar. `themeColor.ts` keeps `<meta name="theme-color">` at the active theme's top bar, so
Android's status bar follows a theme change.

`public/sw.js` is the whole service worker. A file of the app's own comes from the network when the
website answers and from its cache when it doesn't, so a relaunch draws the shell before a channel opens.
It never sees `/account`, which holds the person's session and tickets. `main.tsx` registers it in a built
app only. It keeps files of old builds until the browser clears the cache.

## Come back to the foreground

A phone suspends a page in the background and can drop its channel without a close. When the page becomes
visible, the transport closes the channel of the Node on screen and opens a new one at once, skipping the
backoff. The new channel's first status makes client-core re-attach its subscriptions and refetch what's on
screen (`wsOnReconnect`). The Node shows `offline` only if the new attempt fails. `platform.test.ts` covers
it.
