# Extension development loop

This page covers `pnpm dev:extension`, which opens Chrome or Firefox on its own profile with the
[browser extension](../browser-extension.md) loaded and reloads it on save. It also covers
`pnpm dev:extension:ui`, which drives the sidebar from another terminal. The scripts are in
`apps/extension/scripts/dev/`.

## Start a session

```sh
pnpm dev:extension -- --browser chrome --session my-change
pnpm dev:extension -- --browser firefox --session my-change-ff
```

The launcher does these steps:

1. Builds the CLI and registers a development native host with
   `acorn browser install --development`. The host runs this checkout's `apps/cli/dist/native-host.js`
   and keeps its pairings in the session folder.
2. Seeds a Node with its own data root and this checkout as a project, then starts it from source,
   as `pnpm dev:agent` does. Its banner, with the pairing code, prints to the terminal. Pass
   `--node https://HOST:PORT` to use a running Node instead.
3. Builds the extension in watch mode, pointed at the development host.
4. Opens the browser through web-ext on the session's profile, with the extension loaded and an
   automation port open. web-ext reloads the extension after each rebuild.

Everything lives under `.acorn/extension-dev/<session>/`: the profile, the unpacked build, the bridge
folder, the Node's data, logs, and `session.json`. Your everyday browser profile isn't touched. Press
Ctrl-C, or run the `stop` verb, to close the browser, stop the Node, and remove the development
registration. Pass `--reuse` to start a stopped session again with its profile, pairings, and Node.
Pass `--browser-binary PATH` to run another build, such as Firefox Developer Edition.

Chrome reads the development registration from inside the session's profile, so Chrome sessions
never touch the user-level folder. Firefox reads only the user-level folder. The launcher writes the
registration there for the session and removes it on stop. It refuses to take it from another
running Firefox session.

## Drive the sidebar

From a second terminal:

```sh
pnpm dev:extension:ui -- --session my-change open
pnpm dev:extension:ui -- --session my-change click "Pair a Node"
pnpm dev:extension:ui -- --session my-change fill address https://127.0.0.1:62361
pnpm dev:extension:ui -- --session my-change check confirm
pnpm dev:extension:ui -- --session my-change pairing-code
pnpm dev:extension:ui -- --session my-change fill pairing-code CODE
pnpm dev:extension:ui -- --session my-change text
pnpm dev:extension:ui -- --session my-change stop
```

`open` loads the sidebar page in a tab. There it has the same extension APIs as in the panel. `text`
prints its visible text. `click` finds a button by its text, and `fill` and `check` find an input by
its `name`. `fill` also types into a text area, such as `message`, and picks a select's option by its
value or text, as in `fill session "Fix the flaky test"`. `eval EXPRESSION` runs code in the page. `pairing-code` asks the session's own Node for a
fresh code. Leave out `--session` when exactly one session is running.

The driver talks CDP to Chrome and WebDriver BiDi to Firefox, at the endpoint in `session.json`. It
ends each BiDi session, because Firefox allows one at a time. It can't open the panel itself, because
that takes a toolbar click.

## Check page capture

The driver's `open` shows the sidebar in a tab, which makes that tab the active one, so a capture
from it reads the sidebar itself. Capture checks need the real panel beside the page:

- **Chrome.** Open the page with CDP's `/json/new?URL`. Then send the browser-level CDP command
  `Extensions.triggerAction` with the extension ID and the page's `tab` target from
  `Target.getTargets`. It runs the toolbar click: the panel opens with `activeTab` for that page.
  Close any sidebar tab first, and the driver's verbs act on the panel. A click inside the panel
  grants no access, and a persistent site grant needs Chrome's own prompt, which CDP can't answer.
- **Firefox.** WebDriver BiDi can't click the toolbar, and Firefox counts only real input as a
  gesture. In the sidebar tab, add a button that calls `browser.sidebarAction.open()`, and press it
  with `input.performActions`. Then drive the panel from that tab through
  `browser.extension.getViews({ type: 'sidebar' })`. To grant a site, set
  `extensions.webextOptionalPermissionPrompts` to `false` in the profile's `user.js` and press a
  button that calls `browser.permissions.request()`. Firefox doesn't take a screenshot on a site
  grant alone, so a Firefox screenshot needs a person's toolbar click.

## Check site buttons

[Site buttons](../browser-extension/handoffs.md) need a page the extension may read and a plugin that
declares one:

- **Chrome.** Open the page, then run `Extensions.triggerAction` on its `tab` target as above.
  `Target.getTargets` lists `tab` targets only with `filter: [{}]`. The click grants `activeTab`, the
  background draws the page's buttons, and CDP's `Input.dispatchMouseEvent` at a button's centre is a
  trusted click. A driver can't grant a site in Chrome.
- **Firefox.** With `extensions.webextOptionalPermissionPrompts` set to `false`, press **Allow** in the
  sidebar's site list with `input.performActions`, and the buttons appear on open pages. A click on a
  page's button doesn't open the sidebar in Firefox; open it first with the `sidebarAction.open()`
  button above.
- **GitHub.** The session's Node has no GitHub connection, and connecting one takes a person, so a
  pull request resolves only to "Connect GitHub". Its buttons, anchors, and client-side navigation can
  still be checked on any public pull request.
- **Linear.** Linear ships as a loaded package, so the session's Node doesn't have it until you build
  it into the Node's data root with
  `ACORN_DATA_DIR=.acorn/extension-dev/<session>/node pnpm --filter @acorn/node build:plugin linear`
  and start the session again with `--reuse`. Linear signed out keeps the issue address, so the
  sidebar offers the handoff. With no connection the route asks you to connect Linear. A fake key,
  sealed with the Node's `encryptSecret` and `session.key` into an `integrations` row, reaches Linear
  and comes back as "reconnect". A real resolution needs a real key.
- **The whole flow without a provider.** Install a loaded package with no client bundle into the
  session's Node with `POST /v1/core/plugins/install { "source": { "path": DIR } }` from a second paired
  device, then stop the session and start it with `--reuse`. Declare a page such as
  `https://example.com/items/{id}`, which draws for any path, and suggest only a plain-folder project
  you add with `POST /v1/core/projects`, because a task in a git project makes a branch in the
  repository. `packages/node-core/src/server/plugins/__fixtures__/handoffPlugin.mjs` is a starting
  point.

## Tests without a browser

`apps/extension/src/test/fakeBrowser.ts` is the one fake of the extension API. Background and sidebar
tests share it. It models asynchronous ports, both browsers' ways of reporting a closed port, profile
storage, a scripted native host, messages to and from a page's content script, and optional site
access. The content script's own test runs it against jsdom with a small stub. Run `pnpm --filter @acorn/extension test`. The loop covers what the
fake can't: native messaging, permissions, gestures, and real selectors.

## Browser behavior the loop depends on

Measured October 13, 2026, with Chrome 154.0.8037.99, Firefox 151.0.3, and web-ext 10.7.0 on macOS:

- Branded Chrome ignores `--load-extension`. web-ext loads the extension through Chrome's debugging
  pipe instead, so branded Chrome works and Chromium isn't needed.
- Chrome started with its own profile folder reads native host registrations only from
  `<profile>/NativeMessagingHosts`. A user-level registration isn't found.
- Firefox reads the user-level registration from a fresh profile.
- Chrome opens CDP on `--remote-debugging-port` while web-ext runs it. Firefox opens WebDriver BiDi on
  the same flag when started on its own. Firefox under web-ext wasn't checked, for the reason in
  [Limits](#limits).

## Limits

- The Firefox launch needs a person's terminal. From a sandboxed agent session it fails twice over:
  web-ext checks `~/Library/Application Support/Firefox/profiles.ini` before it uses a kept profile,
  and the sandbox denies that read. A Firefox started as a child process also can't start its content
  processes.
- To check Firefox from an agent session, build with `ACORN_EXTENSION_HOST=development vite build
  --mode firefox`, and run `acorn browser install --browser firefox --development`. Then start Firefox
  with `open -na /Applications/Firefox.app --args -profile DIR --remote-debugging-port=PORT`, and
  install the build with the WebDriver BiDi command `webExtension.install`.
- Firefox loads the extension as a temporary add-on, so it leaves when the session stops.
