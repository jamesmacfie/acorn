# Testing

Tests are organized by runtime and boundary. The suite uses real temporary SQLite roots, real TLS
listeners, and real child processes where those seams are part of the behavior.

## Commands

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test
pnpm db:check
```

`pnpm test` rebuilds native modules for plain Node and runs Vitest through Turborepo with bounded
concurrency, and reports every package rather than cancelling the rest on the first failure. Run it
rather than `turbo run test` directly: the bound is what keeps the suite honest. Many of these tests
spawn a real subprocess, mint a certificate, or run git, and turning the bound off oversubscribes the
machine badly enough that they time out while passing in isolation.

The desktop package's `test` stages the bundle inputs first, then runs its Vitest suites and the Rust
unit tests, so the boot test always exercises fresh artifacts.

Suites that do that kind of real work carry a 20-second test and hook timeout instead of Vitest's
5-second default, set in `packages/node-core/vitest.config.ts`,
`packages/custody/vitest.config.ts`, `apps/node/vitest.config.ts`, and
`plugins/vitest.shared.ts`. A genuine hang still fails; it takes longer to say so.

## Test layers

- protocol tests validate Zod contracts, route builders, query keys, errors, and service messages;
- the client-core suite is two vitest projects, split by file extension so a host test sits beside the
  host it renders. `logic` is `.test.ts` in bare Node with no Solid transform, which is what the whole
  suite used to be, and a green run there still says nothing about the UI. `hosts` is `.test.tsx`
  under jsdom with `vite-plugin-solid`, and it renders the seven contribution hosts: `SlotHost` and
  `TaskSlotHost`, `RefPanelHost`, `ContextMenuHost`, `TaskPaneHost`, `ExtensionPointHost`, and
  `ExclusiveSlotHost`. Hosts rather than individual panes, because ordering, capability gating,
  arbitration and the error boundaries all live in the hosts and every plugin's UI rides on them. It
  checks machinery, not pixels: a contribution under test renders a `<span>` carrying its own id. The
  smoke checklist below is still the eyes-on pass, and it is a good thing to run once after touching
  any of these;
- the palette session has one fixture suite and both hosts are held to it.
  `host/registries/commands/session.test.tsx` drives the session directly and asserts what the reader
  feels: what the empty root lists, what typing searches, what Enter does to a group, what Escape gives
  back, what happens when the thing you opened over moves. None of it mentions a dialog or a cell,
  which is the point — if either host needed a different answer to any of them, they would be two
  products. The DOM half is `host/palette/paletteView.test.tsx` and the terminal half is
  `apps/tui/src/chrome/chrome.test.tsx`; both drive the same operations through their own keys. A
  loaded plugin's descriptors get a real registration pass rather than a parser test:
  `host/chrome/chromeRegister.test.ts` § "a loaded plugin's setting, end to end" runs a two-choice
  fixture setting through the real host and the real command registry — read, write, a value the
  manifest never declared refused on the way out and ignored on the way back, gone when the node stops
  running the plugin, registered-but-unavailable while it is disabled. Deliberately a fixture: no
  first-party loaded plugin has a two-choice preference, and inventing one to be covered would be a
  product decision made by a test;
- the plugin invariants hold the closed kit closed at the call site. `kit/lib/adoption.test.ts` fails on a
  raw `div` or `span` anywhere under `plugins/`, and two arch rules in `tools/arch/boundaries.test.ts`
  fail on a plugin stylesheet and on a plugin importing Solid's `render` in either spelling. These were
  a ledger of converted files until layout phase 9 finished the conversion; a ledger answers "has this
  file been done" and a rule answers "can this be written at all". All three exempt `.test.tsx` and
  assert their file lists are non-empty, because a rule over a list that came back empty is a rule
  that passes on nothing. A second pair of rules scans for raw DOM directly, over both tiers a plugin
  draws in: `plugins/*/src/tree`, where a raw element is markup the host cannot draw at all, and
  `plugins/*/src/client`, where it works on a shell that draws to a document and is invisible to one
  that draws to cells. They share one definition of raw DOM and differ in a single line, whether the
  components barrel is banned or is the normal way to draw. The client half carries an empty baseline
  and the test's comment says which seven files used to be in it;
- `kit/tokens/hover.test.ts` reads the stylesheets rather than the code: a rule that reveals something on
  `:hover` has to reveal it on `:focus-within` too. Hover is never load-bearing, and jsdom computes no
  styles, so this is the only layer that can ask;
- the three kit invariants hold the component set closed, and each one reads the contract rather
  than the code that implements it. `kit/tokens/support.test.ts` reads the `/ui` barrel and asserts that
  the nodes it exports and the rows in `NODE_SUPPORT` are the same list, each with a terminal level.
  `kit/tokens/roles.test.ts` asserts that every role token has a value on both hosts, and that the DOM
  value names a token `tokenAxes.ts` declares. `kit/tokens/props.test-d.ts` has nothing to run: it is a
  type-level test that no node's props accept `class`, `className`, `style`, or an arbitrary string
  where a role is meant, and `tsc --noEmit` under `pnpm lint` is the pass that checks it. See
  [ui design](./ui-design.md) § The closed kit;
- the `tui` suite (`apps/tui`) renders the kit to a cell buffer instead of to a document. It runs the
  bundle's own transform and opens the same renderer the app opens, with stdout as a buffer sink and
  no terminal behind it, and it inherits the alias that points `@acorn/plugin-api/ui` at the terminal
  kit — so a pane under test draws through the code path and imports the kit exactly as the shipped
  bundle does. What it asserts is what a reader would look for on the screen — `Badge`
  draws `[text]`, a `Fold` draws `▸ label` shut and `▾ label` open with its children indented two
  cells, the caret moves when `j` is pressed — rather than a snapshot of every cell, which would fail
  on every spacing decision anybody makes afterwards and name no broken promise. There is one case per
  kit node, checked against the kit itself so a node cannot be drawn without being tested, and a pair
  of whole-pane runs at 80 by 24 and at 120 by 40. One case per layout beside it, drawn from the
  terminal projection in [panes.md](./panes.md) § Layout model and checked against the protocol's own
  region table, at the same two sizes. And a twin of client-core's `keys.test.tsx` against the terminal
  adapter, so the two adapters cannot drift: where the keys land when a pane opens, the moves and their
  wrapping, activate reaching a row, the region cycle remembering its place, a modal holding the keys
  against both of this host's keys for `nextRegion`, and a `pty` rectangle taking every key on Enter
  and giving them back on Escape. Five cases beside those are the reported keyboard faults, kept as
  regression tests where the rule they broke lives: the plugin trust prompt and the quit
  confirmation each hold the keys through a Tab, the footer offers `tab` only where Tab goes
  somewhere, and an entered rectangle stops taking keys the moment it goes off screen, both when
  a bare `visible` hides it and when the tab it sits on is switched. A pane file
  (`src/panes.test.tsx`) opens each first-party pane in the roster at exactly 80 by 24 with the chrome
  around it and asks the three questions the pane sweep asks: is the thing the pane is for on the first
  screen, is no line wider than the 80 cells the kit promises, and did the pane draw itself rather than
  its error boundary. It names one string per pane rather than snapshotting the buffer, for the reason
  the kit cases do. Two of its cases go further: the PR pane at 120 by 40, where a `list-detail` node
  draws both columns, and an agent session opened from the sidebar, which is where the transcript, a
  tool card, a pending approval and the composer all have to appear at once. Each case waits for the
  string it is about rather than for a fixed time, because a pane's data is a route and a store rather
  than a prop and the first render in a fresh worker also pays for compiling everything the pane
  imports. A chrome
  file drives the whole shell rather than a pane: the topbar, the rail and the footer at 80 by 24 and
  at 120 by 40, Tab walking rail to pane strip to pane, the rail collapsing at 99 cells and coming
  back at 100, the palette opening on its chord and giving the keys back where it found them, a
  notification appearing above the footer without taking focus, and `q` asking before it stops a node
  this `acorn` started. A reachability file (`src/reachability.test.tsx`) is the keyboard's property
  rather than a scenario: it walks every stop on eight surfaces, which are the browse rail, the six
  panes the pane sweep opens, and the browse rail again with the cheat sheet open over it. After
  every press it asks that at most one caret is drawn, that focus is on a node still on screen, that
  the word the footer puts beside each bare key is what that key does there, that the one focus value
  names a node that is in the tree and can hold the keys, and that the keys have not reached out of
  the open dialog.
  At the end it asks that the walk landed on every stop `_allStops()` declared, that pressing `h` and
  `l` on every kind of focused thing it met did what the footer said it would, and a second
  block presses Escape out of each surface and asks that the climb ends in the rail. It runs at 80 by
  24, and at 120 by 40 as well when `ACORN_TUI_WIDE` is set, which CI sets and a save does not: the
  wide pass doubles a three-minute file to buy the layouts that split at 100 cells. Five files
  alongside need no renderer at all: the focus invariants that are facts about the source
  rather than about a render (`src/invariants.test.ts`, one deferred decision and no `super+` chord),
  the palette's collapse from a theme to the terminal's slots, the clipboard sequence, the plugin
  suite below, and the boot test after it.

  The plugin suite (`src/plugins/plugins.test.tsx`) is the sandbox, tested for real. It starts a
  `node:worker_threads` worker under `--permission`, hands it a bundle out of a real
  content-addressed cache, and asserts both halves of the containment claim in one frame: the batch
  the worker sent arrives and draws, and the file it was not granted does not open. Beside it, custody
  on its own — a bundle whose bytes do not match the hash a node advertised is refused and never
  cached, a decision is recorded only for bundles this device holds, and re-deciding the same bundle
  replaces the row rather than appending one. None of that needs a terminal, so it runs on whatever
  Node the repo is on; the one case that draws — the same tree fed as a batch and written as JSX,
  asserted to produce identical cells, which is this host's twin of client-core's `twoPaths.test.tsx`
  — draws like every other case here. Nothing in this suite skips and nothing asks for a flag: the
  painter is the client's own TypeScript, so it runs on the Node the repo pins
  ([docs/tui.md](./tui.md) § The runtime floor).

  The boot test (`src/node/boot.test.ts`) is the third file that needs no renderer, and it is what
  `apps/desktop/test/boot.test.ts` is for the shell: does `acorn`'s world come up. Against a fresh
  data root and a fresh config directory it runs the real path — a real standalone node started and
  supervised, the real fleet store and device-token files, the real broker over pinned TLS — and asks
  what the renderer asks first: is there a node, does a `/v2` request reach it, did the event
  socket's upgrade authenticate. Then the three things only this host has to answer: a second `acorn`
  attaches rather than starting a second node, a token the node refuses reads as `revoked` and stops
  retrying, and quitting drains the child and releases the root's lock. The two boot tests are shaped
  differently because the desktop has a helper process to talk to over a wire and the TUI is one
  process, so this one calls the functions directly;
- Node-core tests cover data roots, TLS, auth, pairing, idempotency, migrations, backups, audit,
  worktrees, process/filesystem guards, routes, and WebSocket behavior;
- plugin tests cover schemas, providers, route behavior, reconciliation, and client models using
  package-local fixtures. Every plugin's `vitest.config.ts` is one line re-exporting
  `plugins/vitest.shared.ts`, and the testkit resolves a plugin's migration chain from its id —
  `makeTestPluginDb('github')` and `makeTestNodeContext({ plugin })` find `plugins/<id>/migrations`
  themselves. That shared config is the same two projects client-core has, split the same way:
  `logic` is `.test.ts` in bare Node with git config neutralized, and `hosts` is `.test.tsx` under
  jsdom with `vite-plugin-solid`. The second one is what lets a plugin test a region it ships where
  the region lives — the PR pane's navigator beside its diff, the agents attachment slot handing a `.png`
  to the plugin that declared it — which nothing could do before, because client-core does not have
  those components and a plugin's own suite could not render one. A plugin test reaches the host
  through `@acorn/plugin-api/testkit/client`, not by importing into `client-core` (`tools/arch/
  boundaries.test.ts` § plugin tests holds the shrinking budget for that);
- architecture tests scan the package graph for forbidden imports, undeclared dependencies, cycles,
  shell-binding leakage, protocol impurity, non-contract plugin edges, and route files that cast a
  request body instead of parsing it;
- the documentation checker (`tools/arch/docPaths.test.ts`) runs with the architecture tests and
  reads `docs/` rather than the code. A repo-rooted path in backticks has to resolve, and so does
  every relative link between two docs. It skips a path with no file extension, because a directory
  moves for reasons that are not rot; it skipped `docs/reviews/` while that folder existed, because a
  review is dated evidence and editing one to make a path resolve would falsify it (the reviews were
  retired to git history on 2026-08-28 once every finding had an owner); and it skips a path whose own line says
  the file is gone or not yet arrived, which is how the design and phase files already wrote them
  ("deleted and `schedules.ts` added", "moved to …", "(new; exact placement may change)", "in git
  history").
  A path that names a live file and a line that admits a dead one both pass; a stale citation does
  not. The extension-less escape hatch is what let twelve source paths rot behind a folder rename, so
  one narrow half of it is bought back: a denylist of the four directory names the 2026-08-30
  reorganisation deleted — `src/main/`, `src/app/`, `src/wiring/`, `src/service/` — each of which may
  appear only on a line that admits it is gone, as this one does;
- loadability tests EXECUTE the two rules that keep the workspace bootable, because a rule about
  whether something loads is honestly checked only by loading it:
  `packages/plugin-api/src/entrypoints.test.ts` imports every node-safe facade entrypoint in a
  node-environment vitest worker (the same shape a plugin's own suite runs in), and
  the composition-root suites under `apps/node/test/integration/` boot every plugin's `node/index.ts`. The arch suite's text checks stay as a fast, precise first line, but they are no longer the
  only line — and neither owns a file allowlist any more;
- the platform-seam contract suite is one checker run from both ends: `client-core/infra/platform/contract.ts`
  states what a live capability group looks like, `platform/contract.test.ts` drives it against a mock
  host, and the shell's own suite drives it against the real object the shell installs
  (`apps/desktop/src/shell/bridge.test.ts`, under stub Tauri bindings). The seam's groups are
  nullable, so this is what turns "the host renamed a key" from a silently missing affordance into a
  failing test;
- desktop integration tests cover broker, fleet, persistence, plugin activation, and native seams;
- the desktop boot test and the Rust unit suite cover the shell (below); what needs a real window is
  on the smoke checklist.

## The desktop boot test

`apps/desktop/test/boot.test.ts` is the shell's loadability check: it catches "the shell
cannot load its world". It runs the staged helper under the bundled Node against a fresh data root,
which spawns the real `service.js` over the service protocol, then asks the helper the first two
questions the renderer asks: which nodes are there, and can a `/v2` request reach one. A 200 from
`/v2/node` means the pinned TLS connection came up and the device token authenticated, so one
assertion covers the custody stack end to end. Two more check the gate: a socket without the secret
is refused, and a plain HTTP request gets 426.

The Rust unit tests in `apps/desktop/src-tauri/src/` cover what a headless run cannot reach through
the helper: the renderer CSP and the dev-only widening a packaged build must not carry, the traversal
guard, the highlighter worker's separate policy, the refusal to answer a node route with the shell's
own HTML, the handshake and ready-line parsing, the data key's shape and file fallback, the plugin
scheme's hash grammar and frame CSP, the webview URL policies and the key grammar that picks between
them, the navigation-history bookkeeping, the capability file's webview scoping, and the three
packaging properties in `tauri.conf.json`. `.github/workflows/build-desktop.yml` runs both halves
before the bundler pass, so a broken boot path fails in seconds rather than minutes.

What no headless run reaches is compositing: a child webview positioned over a window needs a window.
That is what items 4 and 5 of the smoke checklist are for.

## The browser smoke test

`plugins/browser/src/server/driver.smoke.test.ts` runs an agent's loop against a real Chrome — load a
loopback page, snapshot it, fill a field by its ref, click a button by its ref, and read back the
console line the page logged with the value it saw. Opt-in through
`pnpm --filter @acorn/plugin-browser test:smoke`, because launching a browser is not something every
`pnpm test` should pay for. On a machine with no Chrome it takes the other branch and asserts the
tools reported why.

## Continuous integration

`.github/workflows/ci.yml` runs `pnpm lint` and `pnpm test` on every pull request and on push to
`main`. Before it existed, the architecture rules and the path checker ran only on whoever remembered
to run them: `.github/workflows/build-desktop.yml` has no `pull_request` trigger and tests the desktop
package alone. That is how twelve doc paths rotted without anything going red.

It runs on Linux, for two reasons that are both about the runner rather than the code. A macOS runner
has no Docker for the container probes to find, and its `/var` is a symlink to `/private/var`, which is
the artefact behind one of the pre-existing failures below.

`@acorn/desktop` is filtered out of the test run. Its `test` script stages the whole bundle and then
runs `cargo test`, and `build-desktop.yml` already has the Rust toolchain, the staged inputs, and the
pinned-runtime cache to do it in. That does mean the boot test and the Rust suite gate `main` rather
than the pull request.

Nothing is cached between runs, so CI runs the suites a local `pnpm test` usually serves from
Turborepo's cache. A green local run with 30 of 31 tasks cached is not evidence about the one task you
changed.

Two checks live in a `build` script rather than in a suite, because what they assert is a property of
built output that no test process has. `@acorn/desktop`'s `build` runs
`apps/desktop/scripts/check-renderer-budget.mjs` over the built `index.html`, and `@acorn/tui`'s
`build` runs `apps/tui/scripts/check-startup-graph.mjs` over its built chunks. Both fail the build over
a byte ceiling or a denylisted chunk name; [frontend.md](./frontend.md) § Startup budget owns what they
enforce.

Neither runs in this workflow, which only runs `lint` and `test`: the renderer's runs in
`build-desktop.yml`, which builds the bundle, and the terminal client's runs whenever somebody builds
that package. So each has a fixture suite beside it that drives the same script against a directory it
writes itself — `apps/desktop/test/scripts/` and `apps/tui/src/startupGraph.test.ts`. Those are what
gate a pull request: they prove the rule, and the `build` invocation is what applies it to the real
bytes.

## The smoke checklist

Deliberately manual — it replaced the Playwright specs, whose harness left the repo with the Electron
shell. Run it per release. Its first pass is still owed, on a machine that never had the Electron
build, and nothing ships to a person until it passes (docs/shell.md § Signing gates and the updater).

1. Install and launch; the window appears and the local node reaches online.
2. Pair a second node by code; fingerprint words match.
3. Open a terminal; a TUI renders and survives resize.
4. Open a preview pane against a task dev server through the tunnel. Navigate, go back, and cover it
   with an overlay; the child webview hides rather than floating above it.
5. Open a loaded plugin pane; it renders, and a network call from its frame fails.
6. Open a loaded plugin's webview surface; a link to a host its manifest does not name is refused.
7. Trigger the quit flow with an active agent; the concern prompt appears; quit drains cleanly.
8. Kill the node process five times; the recovery screen appears on the sixth.
9. Install a data-only harness plugin against an agent CLI on the machine; the trust prompt names the
   command under `Enforced`, and after approving it the agent appears in the Agent Center and completes
   a turn. Nothing automated can cover this one: the suites can prove the descriptor reaches the driver
   registry, and only a real CLI can prove the transcript.
10. Build the reference node provider into the running node's data root
    (`pnpm --filter @acorn/node build:plugin nodes-file`, with `ACORN_NODES_FILE` set), write one
    node into that file, and from Settings → Nodes adopt it, run a task on it, then create and destroy
    one. Same reason as the item above: the route, provider and merge halves each have automated
    coverage and the rendered surface has none ([plugins.md](./plugins.md) § Node providers).

The next six items came from the user-extensions landing review (2026-08-15; they lived in a
`live-qa` file under `docs/future` until 2026-08-28). Plugin suites run in a node environment with no Solid transform, so the
chrome the extension work added has never been seen rendering by a test. Each names the behaviour to
see, not the code to read:

11. Right-click a surface with a plugin-declared context menu row; the menu appears at the pointer
    and clamps to the viewport instead of overflowing at a screen edge.
12. A plugin's declared `topbar` slot item renders at the topbar's right end, beside the node chip and
    the bell, at a size that does not distort the bar.
13. A contribution from plugin B renders inside plugin A's declared `pane.footer` point under a pane,
    with sensible spacing, overflow, and empty state.
14. Force a render throw in a plugin's `coreSlot` replacement; the surface falls back to core's own
    implementation rather than going blank.
15. Select a plugin-contributed theme; the terminal and Monaco pick up the right light or dark
    self-description. Disable the plugin; the fallback to Light or Dark happens without the stored
    preference being rewritten.
16. Edit a dev-mode plugin's entry file; the swap lands without a restart or a trust prompt. Edit a
    non-entry module; the one-module-deep limit surfaces as the restart hint, not silence.

The next two are the remote tree's, from layout phase 3 (2026-08-29). The suites cover the wire, the
renderer, the worker lifecycle and the two render paths producing identical DOM; what nothing
automated covers is a real worker started from a real bundle over the shell's own scheme.

17. Install a plugin declaring an `extensions` entry on `agents:tool-card`, accept its trust prompt,
    and run an agent turn that makes a matching tool call. The card draws from the
    plugin's worker and is indistinguishable from a compiled one: same spacing, same disclosure
    behaviour, same style pack. Reject the bundle instead and the built-in card draws.
18. Break that bundle so it throws on mount. The card shows the labelled placeholder, a row appears on
    the plugin's page, and the transcript around it keeps working — scrolling, selection, every other
    card.

The next four are the loaded four's, from layout phase 5 (2026-08-30). All four panes are trees now and
the automated tiers stop at the JSX preset, so these are the eyes-on pass on the shipped plugins.

19. Open the API pane on a task. The request tree, the URL bar, the tabs and the response all draw.
    Send a request; paste a curl command into the URL bar and press Enter — the whole request fills in,
    on the commit rather than on the paste. Save one through the dialog, then delete one: two clicks,
    with the label changing between them.
20. Open the Database pane on a task with a database. The SQL editor is above, the table list, grid and
    row detail below, and `⌘Enter` in the editor runs the query. Save a query, then load it back from
    the picker and delete it from the picker's own row control.
21. Open a task linked to a Linear ticket, then the same ticket's reference panel from a PR body. Both
    draw from one worker. Post a comment, open a sub-issue from the Overview tab and come back with
    the back affordance, and click a `linear.app` link inside the description — it re-points this view
    rather than opening a browser.
22. Open a task linked to a Rollbar item, pick an occurrence, and copy its context. Then reject one of
    the four bundles at the trust prompt: its pane draws the labelled placeholder and the other three
    keep working.

The last three are layout phase 9's (2026-08-30), and they are the pass the whole programme was
building towards. The kit invariants and the arch rules prove no plugin writes an element or a
stylesheet; only a person can tell whether the result is usable.

23. Traverse every pane with the keyboard and nothing else. Tab reaches each region in turn, arrow
    keys move inside a list, Enter opens a rectangle and Escape leaves it, and no pane is a place the
    keyboard can get stuck. Do the editor pane's file tree, the find-in-files results, the terminal
    drawer, the agents transcript and the PR pane's diff at minimum. Turn on a screen reader for one
    pass over the editor's sidebar: the file tree announces as a tree with levels and expanded state.
24. Scaffold a fresh plugin with `npm create acorn-plugin`, install it from disk, accept its bundle,
    and check both halves of what it declares. Its tool card draws in an agent transcript from its own
    worker, and its diff-line annotation appears on every tenth line of the Changes pane. Then check
    the developer view on the plugin's page, disable the plugin, and uninstall it: the card and the
    annotation go at each step and nothing else moves.
25. Scaffold the other shape with `--rectangle` and repeat the install. Its pane draws inside an
    iframe, and a network call from that iframe fails.

The last item is older than the rest. `docs/next-review.md`, deleted in the 2026-08-30 hygiene pass,
was a personal checklist with no inbound links. Every other line in it was already owned by this
checklist, by [shell.md](./shell.md) § Signing gates and the updater, or by
[caching.md](./caching.md). This one was not.

26. Run the Rollbar pane against a live project rather than the recorded fixtures, and check that the
    privacy allowlist holds on real payloads: no request header, cookie, or `person` field outside the
    allowlist reaches the pane or the copied context
    ([integrations.md](./integrations.md) § Rollbar). Then narrow the window to the smallest width the
    context pane and the Notes pane still support, and make one context section answer slowly. Both
    panes keep their layout, and the slow section reports itself without stalling the others
    ([notes-and-memory.md](./notes-and-memory.md) § Context integration).

The next four are the terminal keyboard's, from the programme that ended on 2026-09-02 by rewriting
[tui.md](./tui.md) § Keys and focus. Every one of them needs a real terminal and none can be
automated: both harnesses ask for the kitty keyboard protocol, the trust queue is stubbed, and a
suite drives one task at a time.

27. Answer the plugin trust prompt at boot, against a real node offering a bundle this device has
    never decided about. The caret starts inside the dialog, Tab does not move it out, Enter on "Run
    it" records the decision, and Escape drops the queue entry. The harness stubs `pendingTrust`; the
    real flow comes through custody, which is the half no test sees
    ([tui.md](./tui.md) § The trust prompt).
28. Press Shift+Tab in a terminal that does not negotiate the kitty keyboard protocol. Both harnesses
    ask for it and get it, so a legacy terminal's spelling of that chord is untested; check that the
    region cycle still goes backwards, and that a lone Escape still leaves a rectangle without
    waiting out the parser.
29. Enter a PTY, then let a notification activate another task while the keys are inside it. Open the
    palette with its chord from inside the PTY, close it, and type again. Run it with
    `ACORN_TUI_KEYS_TRACE=1` and read `keys.log`: no line may say `reason=no-match` on a key the
    footer offers, and none may say `region=none` while the screen has regions
    ([tui.md](./tui.md) § Seeing what the keys did).
30. Walk the cross and page keys where five different rules used to live. In a `list-detail` pane,
    Right crosses from the list to the detail, Left comes back, and PageDown lands on the last row
    and then scrolls the panel instead of wrapping. On the first tab of a `Sections` strip, Left goes one
    column left rather than doing nothing. In the editor's file tree, Right on a leaf reaches the
    document beside the tree.

The next twelve are the command palette's, owed since the graph and the shared session shipped on
2026-09-03 and **not yet run**. The session has a fixture suite both hosts pass and every route has
its own, and what none of them can see is the surface: the suites drive a store and assert its rows,
while a palette is a thing a person opens over a task they are in the middle of. Run them on the
desktop and in `acorn` in a terminal, and expect the two to agree.

31. Open the palette on ⌘K with nothing typed. The top level lists the groups and the loose commands
    and nothing else. Type a word that only a nested command matches — `archive`, `theme`, a run
    target's name — and it appears with the trail it came from beside it.
32. Enter a group, type inside it, enter a second group, then press Escape twice. Each frame comes
    back with exactly the query and the cursor position it was left with, and the focus you had before
    the palette opened comes back only on the last Escape.
33. Press ⌘P with a task open. The palette opens straight at the editor's file search rather than at
    the root, and picking a file opens it. Press `/` on a pull request; the same, at the changed-file
    search. Neither chord opens a second dialog.
34. Type quickly into a Rollbar or Linear issue search on a slow connection. One request goes out for
    the text you stopped on, an earlier answer arriving late never replaces it, and Escape while it is
    in flight leaves nothing behind.
35. Submit `Generate SQL` with a prompt that fails — no model connection, or a database that is not
    reachable. The frame stays open, your prompt is still in the field, the message says what to do,
    and Enter tries again. A second Enter while the first is in flight does nothing.
36. Change the theme from the Appearance setting command. The list marks the value that is set,
    picking one restyles the app immediately, the frame stays open, and the marker moves to what was
    actually stored. Open Settings → Appearance: it agrees.
37. With the palette open over a task, switch node or task from another window or another pane. The
    palette closes rather than acting on rows fetched for somewhere else.
38. Open a plugin's search frame, then disable that plugin from Settings → Plugins. The frame closes,
    nothing is invoked, and the plugin's whole group is gone from the root. Re-enable it: the group and
    everything under it come back, once.
39. Find a Rollbar issue from the palette and pick it. The URL changes and the surface beside the rail
    list shows that item, exactly as clicking the same row in the rail does.
40. Run `Generate SQL` successfully with the Database pane already open and with it closed. Both end
    with the generated SQL in the editor — the open pane re-reads the scratch document rather than
    keeping the text it had loaded.
41. Run and then stop a configured terminal target from the palette. The run/stop decision and the
    error copy match what the drawer shows, and a broken `.acorn/config.toml` still explains itself in
    the list rather than yielding an empty one.
42. Launch a workflow definition from the palette. It starts exactly as launching it from its own
    surface does, and no approve, cancel or kill row is offered anywhere in the palette.

The next four are the Changes panel's ([diff-rendering.md](./diff-rendering.md) § Data flow). The
pane's own suites cover the parser, the routes, the checkbox, the editor's state and every remote state
of the bar against a bare repository in a temp directory. What they cannot see is which diff the column
swaps to when a checkbox moves, whether a keystroke in the message field reaches a command, and what a
real remote with real credentials does.

43. Open the Changes pane on a task with both staged and unstaged edits. Tick a row's checkbox: the
    file moves, the group checkbox above it follows, and the diff column switches to the staged side
    of that file. Untick it and the column goes back. Tick a group checkbox that is showing the
    indeterminate mark and only the unstaged files under it move. Then check the rail: its dirty count
    and the header's totals agree after every one of those actions.
44. On a task with two edited files and one untracked file and nothing staged, type a message in the
    commit field. The button reads **Commit tracked**. Narrow the pane until the diff takes the whole
    column and come back: the message is still there, and so is it after a relaunch. Press Cmd+Enter
    with the keys still in the field, and both edited files land in one commit with the untracked file
    untouched. Then open the options menu, turn Amend on with the field empty, and the last commit's
    message appears; Cmd+Option+Enter from the field amends. Press the expand button and the same text
    is in the modal, with room for a body.
45. On a task whose branch has never been pushed, the bar above the commit editor names the project
    and the branch, its button reads **Publish**, and the counts beside it read "no upstream". Press
    it: the button reads **Fetch** and the counts go quiet. Commit something and the button reads
    **Push** with **↑1** beside it; press that, then amend the commit from the options menu and press
    **Push** again. It is refused, and the reason ends by pointing at Force push. Open the menu
    beside the button, press **Force push** once — the item reads **Force push?** — and press it again;
    the push lands. Then have somebody else, or a second clone, push to the same branch and press
    **Fetch**: the counts read **↓1** and the button reads **Pull**. Copy the project folder from the
    button beside the branch name, which used to be in the header. Pull a branch that has diverged and
    the refusal names Pull with rebase; take it, and if it conflicts the banner reads **Rebase in
    progress**, the Conflicts group is first in the list, the primary button is disabled, and **Abort**
    puts the branch back where it was. Last, commit from a terminal in the same worktree and watch the
    ahead count move without touching the pane.
46. With no model provider connected, the commit toolbar has no wand at the left of it. Connect one in
    Settings, under Integrations, reopen the pane, and stage two files. Press the wand: it spins, and
    within ten seconds the editor holds a subject and a body. Commit, and the message lands. Now type
    a message of your own and press the wand again: it reads **Replace?** and does nothing until a
    second press. Connect a second provider, press the chevron beside the wand, pick the other one,
    and press the wand: the tooltip and the message both come from the provider you picked, and the
    pick survives a relaunch. Disconnect both providers and the wand goes.
47. On a task in a GitHub-mirrored project whose branch has never been pushed, there is nothing under
    the branch bar. Press **Publish**, and **Open pull request** appears there; press that, and the
    create form opens with this branch already chosen as the head. Create the pull request and go back
    to the Changes pane: the button is gone and the PR pane is in the switcher. Then disable the GitHub
    plugin in Settings and reopen the pane on a pushed branch: the footer is the same height it is with
    the plugin on, with no gap where the button was.

The next six are the workflow editor's and the run pane's, owed since each shipped and **not yet
run**. The draft rules have a unit suite, the inspector and the run pane have jsdom ones, and none of
them can see what a person building and watching the owner's first workflow actually goes through.
Run them on the desktop and in `acorn` in a terminal.

48. Open Workflows in the left rail with a project chosen. Press **+ New**, then build the owner's
    first workflow from the empty definition using only the editor: two agent nodes with no
    predecessor, a `terminal:command` node, a third agent node waiting on both investigators, and a
    human gate after it. Declare an input, put it in a prompt from the chip row, and rename one of the
    investigators. Every reference to the old name follows it, and the footer reads valid. Press
    **Save**, reload the surface, and the same nodes come back.
49. From the same definition, press **Save to repo** on a task with a checkout. The file appears at
    `.acorn/workflows/<slug>.toml` in that worktree. Open it from the rail: it draws the same nodes
    read-only, with **Copy to database** where Save was. Start a run from it and the repo trust prompt
    appears, because the snapshot now covers the file.
50. Press **Run** in the editor. The dialog asks for the declared input and for a task, refuses to
    confirm until the required one is filled, and starts the run. Then run the same definition from
    ⌘K → **Run a workflow**: it opens the same dialog rather than starting with an empty input. In the
    terminal client, the definition list is in the Browse panel, the editor is in the main one with
    its node list beside its inspector, and the dialog is a modal the keys stay inside.
51. Start that run on a task and open the **Workflows** pane on it. Both investigators show running at
    once, with the same indentation the editor drew. Open each in the Agent pane from its node: the
    header there carries a "Workflow: …" chip, and pressing the chip comes back to this pane at that
    node. The command node's output tails as it runs and folds away with its exit code when it stops.
52. Let the run reach the gate. The bell rings, and the row in it lands on the gate node with Approve
    and Reject in front of you; the inbox has the same row and it stays there until you answer.
    Approve, and the run finishes and keeps a notice.
53. Make one node fail, by pointing its command at something that exits non-zero. The pane offers
    **Retry**, and an agent node also offers **Retry with edited prompt**; both put the run back to
    running from that node. Then check the pane is not there at all on a task that has never run a
    workflow, and that the agents pane draws no workflow step rows anywhere.

The next two are the start-from-an-item flow's ([workflows.md](./workflows.md) § Starting a run).
Three lists moved onto one registry, and the only way to see that they still offer what they used to
is to open all three menus.

54. Open the row menu on a Rollbar error, a Linear issue and a GitHub pull request. Each has **Create
    task** at the top doing exactly what it did before — a Rollbar row opens the promote modal, a
    pull makes or finds the pull's task with its Linear links — and **Start workflow…** under it. On a
    row with nothing to promote, and on a source whose click already makes a task, no menu appears at
    all.
55. Press **Start workflow…** on a Rollbar error. Pick the owner's first workflow: the `issue` input
    arrives filled with the error's title and its facts, editable, and the button reads **Create &
    run** and refuses while a required input is empty. Press it; the task opens on the Workflows pane
    with both investigators running. Do the same from a pull request that already has a task: it runs
    on that task rather than making a second one.

The last one is the graph view's ([ui-design.md](./ui-design.md) § The closed kit). A canvas is the
one kit node whose whole point is what it looks like, so a suite can check the geometry and nothing
else.

56. Open the owner's first workflow and press **Graph**. It draws two roots joining into the
    synthesis node, with the list column still beside it. Drag a card: it lands on the grid and its
    wires follow. Drag from one card's bottom port onto another: the second now waits on the first,
    and the footer agrees. Press the `×` on that wire and it goes. Select a card and press Backspace:
    it is removed, and the same edit is in the JSON tab. Reload the surface and the cards are where
    you left them. Then start a run and press **Graph** in the pane's Nodes header: a card recolours
    as its step starts and finishes. In the terminal client, both **Graph** views are the indented
    list, the arrows walk the cards, and the editor's has a picker under it that draws an edge out of
    the selected card.

One known appearance bug is recorded here so it is decided rather than slipped into an unrelated
diff: `:root:not([data-theme="light"])` under `prefers-color-scheme: dark` has the same specificity as
a named theme block and sets `--is-dark: 1`, so with the OS in dark mode the light-palette themes
`solarized-light` and `catppuccin-latte` tell xterm and Monaco they are dark while rendering light.
The fix is two lines and changes shipped visual behaviour for users of those two themes; it belongs
in its own change with its own note.

The dashboards backlog keeps its own once-only verification pass in
[docs/future/dashboards/README.md](./future/dashboards/README.md) § 0, because its items gate that
folder's remaining work rather than a release.

A worktree cannot run the app (no `.env`, and 4317 is the live instance), so run the whole checklist
from the main checkout.

## Composition-root tests

Tests that require populated plugin registries belong under `apps/node/test/integration` or the
desktop integration tree. Route protection must be tested through the real `createApp()` factory,
not by mounting middleware only in the test. Standalone parity tests ensure `dev:node` wires the same
pure-Node feature capabilities as the supervised Node.

That integration tree is grouped by what a suite boots, because the whole directory used to be one
flat list of 25 files and the only way to find the sibling of the test you were reading was to open
it. `lifecycle/` starts and stops a node (spawn, shutdown, standalone parity, enrolment), `auth/`
covers pairing and the token principals, `pluginSystem/` covers the loader, the disable path, the
manifests, and `plugins/` holds the suites named for one plugin. Anything that
belongs to none of the four stays flat. Helpers that are not themselves tests live in
`apps/node/test/helpers/`, and the one shell fixture in `apps/node/test/__fixtures__/`.

## Testkit

`@acorn/node-core`'s testkit (`packages/node-core/src/testkit/`) used to be three files sitting under
`server/routes/`, because that is where a test-only SQLite factory was first needed. None of the three
were routes, and eleven packages ended up importing test scaffolding through a path that reads like
production surface. The directory move made the import path say what it is: every
`@acorn/node-core/testkit/...` import is test scaffolding by construction, and the arch suite fails a
production file that reaches one (docs/architecture-overview.md § Package boundaries). See
[plugins.md § What is published, and what acorn promises about it](./plugins.md) for why
`makeTestNodeContext` and `makeTestRequestContext` build a real host context rather than a mock.

`testEnv()` builds the `c.env` bindings a route test needs. `testSecretEnv()` and
`TEST_ENCRYPTION_KEY` mint the raw session key and the `SecretService` binding it seals together, as a
pair, because a test that sets only one of them compiles and then fails at the first credential read;
every test in the repo uses the same 64-hex key so a test can seal a credential with the same key the
`Env` it built is using.

`workspacePluginMigrations()` and `makeTestPluginDb()` resolve a workspace plugin's Drizzle migration
chain from its id, as `<checkout>/plugins/<id>/migrations`. They replaced about twenty call sites that
spelled out a path the id already implies, and the eight per-plugin `migrations.ts` modules that used
to do the same job. This only works from a source checkout, so a plugin developed outside this
checkout passes its migrations folder explicitly. The `plugins/<id>/` segment is spelled out rather
than found by walking up from the caller, so it can never resolve to core's own migration chain at
`packages/node-core/migrations`, which a bare ancestor walk would find first.

## Reliability

The suite launches Git, PTYs, Docker probes, provider fakes, and Node children. A full run is
resource-sensitive; verify a failing package in isolation before changing production timeouts. Do
not weaken runtime limits to accommodate a saturated test runner.

### Known pre-existing failures

Verified on a clean tree. If you see exactly these and nothing else, your change is not the cause:

- One live-PTY `posix_spawnp` failure in `agentSend` tests, a native-module ABI artefact.
  `pnpm rebuild:node` fixes the ABI class of failure; this one survives it.
- `plugins/http/src/server/send.test.ts` fails one case comparing a temporary worktree path, a
  macOS `/var` against `/private/var` artefact of the test's own fixture.

Also worth knowing before you read a red gate as your own: the root `lint` script is
`oxlint && turbo run lint`, so an oxlint failure means `tsc --noEmit` never ran at all. Check
which half failed before assuming the types are fine — or run `pnpm lint:types` on its own.

## Non-vacuity

Tests that assert source shape or route mounting must fail when the behavior is removed. Boundary and
parity tests include explicit graph/literal checks, while source-text tests strip comments before
matching implementation calls.

The snapshot-backed lists are the case that needs saying out loud, because a file you can regenerate looks
like one you can launder a regression past. `packages/plugin-api/src/surface.snapshot.txt` and the four
plugin golden lists (docs/plugins.md § The golden lists) are all asserted with exact equality against a
committed file, never a subset — a contribution that silently VANISHES has to fail as loudly as one that
appears — and each carries a hand-written floor beside it, because an exact match against an empty snapshot
would otherwise pass. Regeneration is deliberate, behind an env flag, and the diff is the review surface.

The facade snapshot goes one step further, because its file is a published contract rather than an internal
list: its first line records the `PLUGIN_API_MAJOR` it was written under, and `UPDATE_SURFACE=1` REFUSES to
write a snapshot that has lost a name while that major is unchanged. Adding is free; removing has to move
the number, which every plugin package's `apiVersion` range is checked against. It is the one regeneration
in the repo that can say no.

Two more regenerations joined it since: `UPDATE_PLUGIN_SCHEMA=1` rewrites the manifest JSON Schema from
the Zod contract (`packages/plugin-types/src/pluginSchema.test.ts`), and the same file's assertion is what
keeps the published schema and the contract one source of truth.
