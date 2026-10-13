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
   as `pnpm dev:agent` does. Its banner, with the pairing code, prints to the terminal. The browser
   starts with `ACORN_DATA_DIR` set to that Node's data, so the sidebar offers it as the Node on this
   Mac. Pass `--node https://HOST:PORT` to use a running Node instead. The sidebar then offers whatever
   Node `acorn` would find, such as the desktop's.
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
pnpm dev:extension:ui -- --session my-change click Continue
pnpm dev:extension:ui -- --session my-change pairing-code
pnpm dev:extension:ui -- --session my-change fill pairing-code CODE
pnpm dev:extension:ui -- --session my-change click Pair
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
- **Add to Acorn chat.** A driver can't click the browser's own menu. After `Extensions.triggerAction`,
  run `chrome.contextMenus.onClicked.dispatch({ menuItemId: 'add-to-acorn-chat' }, tab)` in the
  service worker ([what it covers](../browser-extension/page-capture.md#gaps)).

## Check task chips

[Task chips](../browser-extension/handoffs.md#task-chips) need a page the extension may read and a
plugin that declares a handoff for it:

- **Chrome.** Open the page, then run `Extensions.triggerAction` on its `tab` target as above.
  `Target.getTargets` lists `tab` targets only with `filter: [{}]`. The click grants `activeTab`, and
  the background draws the page's chip. The chip sits in a closed shadow root, which page scripts
  can't reach, but CDP's `DOM.getDocument` with `depth: -1` and `pierce: true` lists it, and
  `DOM.getBoxModel` gives a button's box. `Input.dispatchMouseEvent` at its centre is a trusted click.
  A driver can't grant a site in Chrome.
- **A pull request with a task.** Make a scratch git repository outside the checkout with a GitHub
  remote, such as `git remote add origin https://github.com/cli/cli.git` and one empty commit, add it
  as a project from a second paired device (`POST /v1/core/projects` with its `path`), then create a
  task there with `origin: 'github-pr'` and a real `pullNumber`. The project's GitHub facet comes from
  the remote, so `tasks.pages` lists the pull request's address, and archiving the task
  (`POST /v1/core/tasks/<id>/archive`) checks the chip's live refresh.
- **Firefox.** With `extensions.webextOptionalPermissionPrompts` set to `false`, press **Allow** in the
  sidebar's site list with `input.performActions`, and the chips appear on open pages. A click on a
  page's chip opens its menu, not the sidebar, in Firefox; open the sidebar with the
  `sidebarAction.open()` button above.
- **GitHub.** The session's Node has no GitHub connection, and connecting one takes a person, so a
  pull request resolves only to "Connect GitHub". Its chips, anchors, and client-side navigation can
  still be checked on any public pull request.
- **Linear.** Linear ships as a loaded package, so the session's Node doesn't have it until you build
  it into the Node's data root with
  `ACORN_DATA_DIR=.acorn/extension-dev/<session>/node pnpm --filter @acorn/node build:plugin linear`
  and start the session again with `--reuse`. Linear signed out keeps the issue address, so the
  sidebar offers the handoff. With no connection the route asks you to connect Linear. A fake key,
  sealed with the Node's `encryptSecret` and `session.key` into an `integrations` row, reaches Linear
  and comes back as "reconnect". A real resolution needs a real key.
- **Rollbar.** Build it in the same way, with `build:plugin rollbar`. Signed out, Rollbar redirects
  `rollbar.com/item/<id>/` to its login page, so the tab never stays on the item. Answer the address
  with a stub page instead. In Chrome, attach to a new tab, call `Fetch.enable` with the pattern
  `https://rollbar.com/item/*`, and answer each paused request with `Fetch.fulfillRequest`. In
  Firefox, call BiDi `network.addIntercept` for the host `rollbar.com`, then answer item paths with
  `network.provideResponse`. The extension sees the real address, and the handoff still goes through
  the Node to Rollbar's API. Fake tokens, sealed as for Linear, come back as "reconnect".
- **The whole flow without a provider.** Install a loaded package with no client bundle into the
  session's Node with `POST /v1/core/plugins/install { "source": { "path": DIR } }` from a second paired
  device, then stop the session and start it with `--reuse`. Declare a page such as
  `https://example.com/items/{id}`, which draws for any path, and suggest only a plain-folder project
  you add with `POST /v1/core/projects`, because a task in a git project makes a branch in the
  repository. `packages/node-core/src/server/plugins/__fixtures__/handoffPlugin.mjs` is a starting
  point.

## Check the branch marker

The [branch marker](../browser-extension/task-pages.md#the-branch-marker) needs a plugin that
publishes a task address, and a page served at that origin:

1. Serve any page on a free port, such as `python3 -m http.server 5199` in a scratch folder.
2. Write a loaded package with no client bundle whose manifest declares
   `"taskAddresses": "/v1/p/<id>/task-addresses"` and `"permissions": { "node": { "core": ["tasks"] } }`,
   and whose route answers each active task you choose with `origin: 'http://localhost:5199'`.
   Install it from a second paired device with `POST /v1/core/plugins/install`. It starts without a
   restart.
3. Add a plain-folder project with `POST /v1/core/projects` and a task in it.
4. In Chrome, open `http://localhost:5199/` and run `Extensions.triggerAction` on its `tab` target,
   as for task chips. The marker draws in the page's corner, and **This page** shows the task with
   the plugin's state line.
5. Read the marker with `DOM.getDocument` and `pierce: true`, and press its menu items with
   `Input.dispatchMouseEvent`. **Hide on this site** writes `hiddenMarkers`, and **This page** offers
   it back. Archiving the task takes the marker off.

## Check an installed build

The loop's own profile and development host can hide an installation fault, so a release check uses
the built bundles and the host `acorn browser install` registers:

- **Chrome.** Register into a fresh profile with
  `acorn browser install --browser chrome --registry-dir <profile>/NativeMessagingHosts`. Start Chrome
  with `--user-data-dir=<profile> --remote-debugging-port=PORT --enable-unsafe-extension-debugging`,
  then send the browser-level CDP command `Extensions.loadUnpacked` with `apps/extension/dist/chrome`.
  An extension loaded this way leaves when Chrome quits, and `chrome.runtime.reload()` disables it.
  Send `Extensions.loadUnpacked` again to reload it in place with its storage.
- **Firefox.** `acorn browser install --browser firefox` writes the user-level registration Firefox
  reads. Start Firefox with `open -na` as in [Limits](#limits), and install `apps/extension/dist/firefox`
  with WebDriver BiDi `webExtension.install`.

Run `acorn browser uninstall` afterwards, and delete the bridge folders you created.

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

- The Firefox launch hasn't been checked from a person's terminal. From a sandboxed agent session it
  fails twice over:
  web-ext checks `~/Library/Application Support/Firefox/profiles.ini` before it uses a kept profile,
  and the sandbox denies that read. A Firefox started as a child process also can't start its content
  processes.
- To check Firefox from an agent session, build with `ACORN_EXTENSION_HOST=development vite build
  --mode firefox`, and run `acorn browser install --browser firefox --development`. Then start Firefox
  with `open -na /Applications/Firefox.app --args -profile DIR --remote-debugging-port=PORT`, and
  install the build with the WebDriver BiDi command `webExtension.install`.
- Firefox loads the extension as a temporary add-on, so it leaves when the session stops.
