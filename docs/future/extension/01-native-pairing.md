# Phase 01: native pairing

Status: implemented October 13, 2026, with the real-browser gaps listed in
[real-browser results](#real-browser-results). [Browser extension](../../browser-extension.md) owns the
shipped contract.

Read the [extension context](./README.md) before implementing this phase. It owns the release
boundary, authority model, shared contracts, and defaults.

## Prerequisites

None. This is the first runnable slice.

## Deliverable

Install a development extension and its native bridge, pair a Node from the sidebar, and list that
Node's projects with the desktop closed.

## Starting point and owners

- `apps/cli/src/main.ts`, `apps/cli/bin/acorn.mjs`, and `apps/cli/vite.config.ts` own CLI dispatch
  and delivery.
- `packages/custody/src/broker/nodePairing.ts`, `packages/custody/src/broker/nodeBroker.ts`, and
  `packages/custody/src/broker/fleetStore.ts` own pairing, transport, and fleet storage.
- `packages/protocol/src/transport/broker.ts` defines Node identity and fetch contracts.

## Implementation steps

1. Add the `@acorn/extension` workspace under `apps/extension`. Use shared Solid/Vite sidebar code
   with separate Chrome and Firefox manifests and small API adapters. Build extension pages and
   packaged background/content scripts without remote execution code.

2. Build the [development loop](./README.md#development-loop) next. Answer its open browser
   questions first. Add `pnpm dev:extension` for Chrome and Firefox, the pinned development
   identities, the development native host, the session manifest, and the shared browser fake.
   The development host can echo frames until step 4 adds the real entry. Later phases run their
   real-browser checks through the loop.

3. Add CLI install, status, and uninstall commands for the native host. Register stable development
   extension identities and exact allowlists. Resolve absolute launcher and Node-runtime paths
   during installation; do not depend on the browser's shell PATH.

4. Create a native-host entry that reads length-prefixed messages and emits framed replies only.
   Send diagnostics to stderr. Validate Chrome and Firefox invocation arguments independently. Bound
   input, response, and transfer assembly sizes; chunk large replies below the native message limit.

5. Add the minimal typed native operations for node listing, probe, pair, select, forget, and
   project listing. Keep the native process as a thin adapter over custody. Add later operations
   only with their consuming phase.

6. Build sidebar pairing with address entry, compatible/incompatible status, fingerprint comparison
   confirmation, and code entry. Reuse probe and pinned pair helpers; never return a token or
   certificate private material to the extension.

7. Remember nodes in separate browser bridge custody. Connect only the active selection through
   NodeBroker. Bind requests and replies to that node. Preserve device selection in browser storage
   and restore it when the native connection restarts.

8. Show missing-host, invalid-code, offline, revoked, identity-change, and incompatible-node states
   with an actionable next step. Keep pairing and forgetting usable when restoring a stale selection
   fails.

## Demo and acceptance

Start `pnpm dev:extension` for each browser from a fresh worktree. Edit a sidebar file and watch
the extension reload. Stop the session and confirm its native host registration is gone.

Build both development bundles. Register the host through the CLI. Pair a local Node, list projects,
pair a remote Node, switch to it, and restart the browser. Repeat with the desktop closed.

- Reject an unregistered extension identity, malformed frames, oversized length headers, and
  incomplete transfers.
- Exercise fingerprint confirmation, bad code, changed certificate, revoked device, and incompatible
  protocol against controlled TLS fixtures.
- Switch nodes while a read is outstanding. Confirm the late response cannot replace the selected
  node's projects.
- Inspect registrations and custody file modes. Confirm no token appears in browser storage,
  messages, or diagnostics.

## Verify and complete

Run custody and CLI suites, the extension suite, lint, and architecture checks. Inspect the built
manifests and run real native messaging in both browsers through the development loop.

Complete only when the deliverable and acceptance are demonstrated. Record any failure or
real-browser
verification gap; a build or mocked API alone does not prove browser behavior. Update the owning
reference docs for shipped contracts and add new documentation to both indexes where applicable.

## Scope and stop conditions

Stop once pairing, selection, and project reads work in both browsers. Do not start Node, reuse
desktop credentials, add chat APIs, or implement a separate release installer in this phase.

## Verify before building

- Recheck the live owners against the context baseline; prerequisite phases may have moved
  contracts.
- Use the repository's supported runtime, contribution boundaries, and focused test workflow.
- Resolve a prerequisite or contract conflict before adding another implementation path.

## Decisions made while building

The plan was silent or the code disagreed in these places:

- The native protocol and the pinned identities live in `@acorn/protocol` (`extensionBridge.ts`). The
  extension and the CLI are both apps, and apps may not import each other.
- The native host is a second entry of the CLI build, `dist/native-host.js`, rather than a CLI
  subcommand. The browser never loads the CLI, so nothing else can write to its stdout.
- `acorn browser install` takes `--development`, `--bridge-dir`, and `--registry-dir`.
  `pnpm dev:extension` registers its host through these options, so there is one way to write a
  registration. Chrome on a custom profile reads registrations inside the profile, which needs
  `--registry-dir`.
- The bridge keeps the selection only while it runs. The background stores `selectedNodeId` in
  browser storage and reselects it each time the host starts, as step 7 says.
- `node.forget` removes this browser's custody only. It doesn't revoke the device on the Node.
- A regenerated Node certificate fails the pinned TLS chain before the pin comparison, so the broker
  reports it as unreachable. The bridge probes after a failed read to name it an identity change, as
  `openCliNode` does.
- `probeNode` in `@acorn/custody` resumed a cached TLS session on a second probe of one address, and a
  resumed session has no peer certificate. It failed with "The node presented no certificate". It now
  makes every probe on a fresh connection. The desktop helper and terminal client share the fix.
- web-ext adds about 270 development-only packages, most of them from its add-on linter. It stays,
  because it is the one launcher that loads into branded Chrome and reloads both browsers. Nothing
  from it ships.

## Development loop answers

The four questions from [the development loop](./README.md#development-loop), checked October 13,
2026, with Chrome 154.0.8037.99, Firefox 151.0.3, and web-ext 10.7.0 on macOS:

1. Branded Chrome ignores `--load-extension`. web-ext loads the extension anyway, through
   `--remote-debugging-pipe` and `--enable-unsafe-extension-debugging`, so the loop uses branded
   Chrome. Chromium and Chrome for Testing aren't needed.
2. Yes. Chrome on a custom profile reports "Specified native messaging host not found" for a
   user-level registration, and finds one in `<profile>/NativeMessagingHosts`. The loop registers its
   host there, so Chrome sessions never write to the user-level folder.
3. Yes. Firefox on a fresh custom profile reads the user-level registration and starts the host with
   the registration path and the extension ID.
4. Chrome under web-ext opens CDP with `--args=--remote-debugging-port=N`. Firefox opens WebDriver BiDi
   on the same flag when started on its own. Firefox under web-ext couldn't be started from the agent
   session (see below), so that pairing is unconfirmed.

## Real-browser results

October 13, 2026. Chrome session `p01-chrome` ran through `pnpm dev:extension`. Firefox session
`p01-firefox` failed to start in the agent sandbox. The Firefox checks ran in `p01-firefox-bidi`
instead: the same development build, the host registered with `acorn browser install --development`,
Firefox started with `open`, and the extension installed over BiDi. Both browsers used isolated Nodes
on loopback. A fresh Chrome session, `p01-chrome-final`, repeated pairing, the project list, and stop on
the committed code.

These checks passed:

| Check | Chrome | Firefox |
| --- | --- | --- |
| Extension loads, native host starts with the browser's caller arguments | Passed | Passed |
| Edit a sidebar file, extension rebuilds and reloads (host process restarts) | Passed | Gap |
| Stop the session, development registration removed | Passed | Gap |
| Probe shows the same identity words as the Node's banner | Passed | Passed |
| Bad code refused, real code pairs, projects listed | Passed | Passed |
| Pair a second Node, switch both ways | Passed | Passed |
| Switch Nodes while a project read is outstanding, late reply dropped | Passed | Not repeated |
| Restart the browser, selection restored | Passed | Passed, after 10 s |
| Offline, changed certificate and re-pair, revoked device, incompatible Node | Passed | Not repeated |
| Missing host, then reinstall and retry | Passed | Passed |
| Custody modes 0700 and 0600, token absent from profile, storage, and logs | Passed | Passed |

These gaps remain:

- The Firefox launch through `pnpm dev:extension` didn't run. web-ext reads
  `~/Library/Application Support/Firefox/profiles.ini` before it uses a kept profile, and the agent
  sandbox denies that read. Firefox reload on save and session stop are unchecked.
- In Firefox, the background's first native port after the browser starts got no host process and no
  close, three times out of three. The 10-second deadline and a single restore retry recover from it.
  The cause is unknown.
- Both "remote" Nodes were Nodes with their own data roots on this machine's loopback, not a second
  computer.
- The desktop app stayed open, because it hosts the agent session. The bridge never contacted it, and
  every Node was standalone.
- Opening the panel from the toolbar needs a person's click. The driver loads the same page in a tab.
- An unregistered extension identity was checked by starting the host with another Chrome origin. It
  exited with code 3. A second real extension wasn't tried.
- The installed host name, `com.acorn.browser_bridge`, wasn't registered in the user-level folders or
  used by a browser. Only the development name was. Unit tests cover the installed registration's
  content.
