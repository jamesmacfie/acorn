# Testing

Tests are organized by runtime and boundary. The suite uses real temporary SQLite roots, real TLS
listeners, and real child processes where those seams are part of the behavior.

## Commands

```sh
pnpm lint
pnpm test
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test
pnpm --filter @acorn/cli test
pnpm db:check
pnpm test:coverage
```

`pnpm test` rebuilds native modules for plain Node and runs Vitest through Turborepo with bounded
concurrency, and reports every package rather than cancelling the rest on the first failure. Run it
rather than `turbo run test` directly: the bound is what keeps the suite honest. Many of these tests
spawn a real subprocess, mint a certificate, or run git, and turning the bound off oversubscribes the
machine badly enough that they time out while passing in isolation.

The desktop package's `test` stages the bundle inputs first, including a build of the plugin SDK for
bundled plugin imports. It then runs its Vitest suites and the Rust unit tests, so the boot test
exercises fresh artifacts.

## Coverage measurement

`pnpm test:coverage` runs focused Vitest suites for four contract paths and writes JSON summaries to
`.coverage/<path>/coverage-summary.json`. Each target names the source files to include, including
files no test imports. The command reports coverage for these test selections only:

| Target | Tests | Source in report |
| --- | --- | --- |
| Protocol plugin contract | `packages/protocol/src/plugin/` | `packages/protocol/src/plugin/**/*.ts` |
| Node plugin loader | `packages/node-core/src/server/plugins/` | `packages/node-core/src/server/plugins/**/*.ts` |
| Client frame bridge | `packages/client-core/src/host/frames/` | `packages/client-core/src/host/frames/**/*.{ts,tsx}` |
| Workflow execution | Five dispatch, child lifecycle, processing, projection, and schedule suites | Six matching modules, including `plugins/workflows/src/server/runs/runner.ts` |

Use the report to find untested branches before changing these boundaries. It is not a monorepo
coverage percentage. Integration tests in other packages can exercise a contract without appearing
in its package-local report. No global percentage threshold is set.

The TUI agent driver has focused protocol, screen, and flow tests under
`apps/tui/scripts/agent/`. A live PTY run is an opt-in acceptance check because it builds and starts
a real Node and needs time for the terminal to draw. See
[local-development.md](./local-development.md#agent-driven-terminal-development) for launch,
snapshot, key, resize, flow, and stop commands.

The CLI suite checks argument parsing, versioned resource projection against golden JSON Schema
examples, Node pin selection, writes, agent and workflow waits, plugin command validation, and local
service ownership. Node-core route tests cover device-only plugin dispatch, active declaration and
scope checks, output validation, and keyed write replay. The standalone archive smoke starts a Node,
reads it from a second CLI process, then stops it. See
[local development](./local-development.md#headless-cli-development) for the commands and
[CLI](./cli.md) for output and exit contracts.

The workflow-v2 transition test creates a fixture, copies it, and runs only against the copy. It
asserts both the targeted reset and survival of unrelated tasks, links, credentials/connections,
devices, schedules, and files. A second copied fixture holds an active run and proves the quiescent
preflight refuses before creating an export or changing rows. Never point this test or an ad-hoc
transition check at the active development data root.

Suites that do that kind of real work carry a 20-second test and hook timeout instead of Vitest's
5-second default, set in `packages/node-core/vitest.config.ts`,
`packages/custody/vitest.config.ts`, `apps/node/vitest.config.ts`, and
`plugins/vitest.shared.ts`. A genuine hang still fails; it takes longer to say so.

Scheduler tests use an injected clock. Workflow schedule tests pair that clock contract with real
temporary core and plugin SQLite databases. The focused cases cover catch-up once, stable due and
manual identities, restart transitions, cross-connection overlap races, gated descendants, baseline
activation and failure, continuation expiry, authority revocation, pause and deletion, and daylight-
saving gaps and folds without sleeping.

The workflow schedule editor adds a jsdom host test over the real shared-kit tree and pure tests for
occurrence previews, loop capability gating, limits, and device projections. Server cases assert that
published dependency changes retain the approved snapshot, history is retained unless fresh start is
explicit, drafts keep core cadence paused, paused **Run now** is admitted, and technical recovery
identities never cross the route. Real-window checks use an isolated `dev:agent` session; provider-
dependent baseline/checkpoint journeys still require an installed provider fixture.

## Test layers

- protocol tests validate Zod contracts, route builders, query keys, errors, and service messages;
- shared typed-source authoring has pure tests for dependent invalidation, preview generations,
  compatibility ordering, conversions, and missing examples, plus jsdom component tests proving that
  typing changes metadata without querying records and that provider text renders without becoming
  markup. Workflow's inspector suite verifies the consumer receives the same binding picker rather
  than a plugin-local form;
- AI authoring tests run the same bounded response loop under an API connection ID and a text-only
  harness ID. Fake model sequences cover source and option lookup, clarification, malformed replies,
  invalid candidate repair, dropped filters, metadata and repair limits, cancellation, sample opt-in,
  untrusted record content, stale merges, apply, reject, undo, and device-local recovery. Route tests
  cover device-only admission and the read-only source-tool projection. Real provider runs remain a
  release acceptance check because they are not deterministic;
- the client-core suite is two vitest projects, split by file extension so a host test sits beside the
  host it renders. `logic` is `.test.ts` in bare Node with no Solid transform, which is what the whole
  suite used to be, and a green run there still says nothing about the UI. `hosts` is `.test.tsx`
  under jsdom with `vite-plugin-solid`, and it renders the seven contribution hosts: `SlotHost` and
  `TaskSlotHost`, `RefPanelHost`, `ContextMenuHost`, `TaskPaneHost`, `ExtensionPointHost`, and
  `ExclusiveSlotHost`. Hosts rather than individual panes, because ordering, capability gating,
  arbitration and the error boundaries all live in the hosts and every plugin's UI rides on them. It
  shares `vitest.browser.setup.ts` with plugin host suites; that setup installs jsdom's isolated
  storage over Node 24's otherwise-undefined process-level `localStorage` property. It
  checks machinery, not pixels: a contribution under test renders a `<span>` carrying its own id. The
  smoke checklist below is still the eyes-on pass, and it is a good thing to run once after touching
  any of these;
- annotation lifecycle tests cover contributor-specific freshness, disable and re-enable, reload,
  removal, identical task ids across nodes, stale responses, failure isolation, registered-order
  merging, and request cancellation. The chrome integration test registers a loaded manifest,
  receives the annotation POST, and follows the valid mark into the rail registry. Protocol defines
  the generic 4,096-row ceiling, client tests keep it separate from `core:task`'s 256-accepted-mark
  limit, node-core tests require a node bundle for route-backed extensions, and the TUI chrome test
  covers the ordered marker projection, `+N` disclosure, and keyboard inspection;
- exclusive chrome tests exercise core fallback for the task list, pane switcher, rail, and topbar;
  remote-tree failure reports; host-minted nested slot placement; and the action boundary that refuses
  source, node, and route choices the host did not offer. A real-window pass still checks the visual
  arrangement, collapse control, nested task list and status items, and fallback after disabling or
  removing a selected provider;
- the palette session has one fixture suite and both hosts are held to it.
  `host/registries/commands/sessionStore.test.tsx` drives the session directly and asserts what the reader
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
  what the renderer asks first: is there a node, does a `/v1` request reach it, did the event
  socket's upgrade authenticate. Then the three things only this host has to answer: a second `acorn`
  attaches rather than starting a second node, a token the node refuses reads as `revoked` and stops
  retrying, and quitting drains the child and releases the root's lock. The two boot tests are shaped
  differently because the desktop has a helper process to talk to over a wire and the TUI is one
  process, so this one calls the functions directly;
- Node-core tests cover data roots, TLS, auth, pairing, idempotency, migrations, backups, audit,
  worktrees, process/filesystem guards, routes, and WebSocket behavior;
- managed-agent delegation tests cover signed caller context, execute permissions, ceiling
  inheritance, direct-child authorization, atomic depth and live-count limits, MCP retry
  idempotency, shared and worktree provisioning recovery, bounded read projection, structured-result
  validation, wait and attention states, cancellation, reports back to a managed owner with their
  withdrawal and restart recovery, managed-parent navigation, session roster
  nesting, and core task hierarchy. The provider runtime tests remain the contract for both managed
  harness drivers; a real Claude Code or Codex login belongs to the manual checklist;
- the two web-activity captures under `plugins/agents/src/server/drivers/__fixtures__` are the
  authority for what each provider sends, in the same way the subagent captures beside them are. They
  were taken from live runs against the pinned Codex CLI and the pinned Claude ACP adapter, sanitized
  by truncating long strings and trimming result lists without touching a field name, and each records
  the version it came from. Both contradicted the plan written before them, so a hand-written input is
  not enough here. The one action neither run produced, Codex's `findInPage`, has a unit case derived
  from `codex app-server generate-json-schema` that says so beside the capture tests. The card itself
  is checked in both hosts: `webToolCard.test.tsx` under jsdom, and `apps/tui/src/agentsWeb.test.tsx`
  in a real cell buffer, because links are the one card body a desktop render proves nothing about;
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
- the GitHub mirror's topology tests use `plugins/github/src/server/routes/mirror/fakeGithub.helper.ts`,
  a deterministic GitHub that paginates the way GitHub documents: 100 nodes a page, a `Link` header on
  the files pages, and the 3,000-file cap. `prFetch.test.ts` asserts requests, cursors, order, and
  completeness: 2,200 files in 22 requests, 3,000 of 3,000 complete, 3,000 of 3,418 capped, a full
  page 30 with no count capped, and 400 review threads, a 250-comment thread, 150 commits, and 120
  checks all exhausted. It also fails a repeated cursor, a duplicate path, a malformed page, a partial
  GraphQL error, and a failed middle page, and holds thread-comment requests to four in flight.
  `prMirror.test.ts` runs against the real migrated `github.sqlite`: a failed page 12 leaves every old
  row, `fetched_at`, and completeness unchanged; two patches of one head blob read back apart; a
  missing body is an integrity failure; and a summary read touches no blob. `pullFiles.test.ts`,
  `pullsBatch.test.ts`, and `prCreate.test.ts` cover the routes, including the diff document, segment
  and search reads by digest and the bounded refusals of a forged digest, an unknown body, a bad
  ordinal and an oversized batch, and a compare answered as a document with its patches stored by
  digest. `DiffForPull.test.tsx` covers the capped-list warning and that the pane reads segments and
  never a whole patch;
- the diff document has three tiers. `packages/diff-document/src/segment.test.ts` holds the segmenter
  to its rules over a generated corpus: every row kept in order, the same cut every time, both
  limits honoured except for one oversize row that is alone and marked, a gap only at a segment's
  edge, a deletion run kept with its insertions, the raw fallback bounded, and keys that follow the
  patch and not the file's position; `search.test.ts` pages across files and stops reading once a
  page is full. `testkit/largeDiff.test.ts` holds every descriptor of the `scale` profile to the
  bounded row builders the renderer draws with: rows, columns and split bands.
  `plugins/changes/src/server/routes/localGit.test.ts` runs the Changes document over a real tree,
  including a stale digest refused as a revision conflict and staged and unstaged kept apart.
  `features/diff/DiffPane.test.tsx` renders the real pane over the fixture with a jsdom layout model
  (`features/diff/layout.helper.ts`): plain rows before colour, a pane left open asking for a few
  dozen of the `scale` profile's thousands of segments and then nothing more, a jump to the last
  file that loads nothing in between, a new revision that reloads only the file that moved, find
  across unloaded segments, gap expansion, and collapse. The layout helper also models a
  `ResizeObserver`, block heights by `data-block`, and a `scrollTop` that clamps the way a browser's
  does, so a test cannot assert a position no browser would accept;
- the diff's dynamic-block geometry has three layers of test. `kit/diff/layoutIndex.test.ts` holds a
  million rows as segments with 400 blocks: 2,000 random resizes leave every fixed start where it was
  and write at most log2(items) + 1 tree nodes each, places and offsets convert both ways in both
  projections, and a slow reference agrees through inserts, resizes, removals, collapse, expansion and
  a change of projection. `kit/diff/measureScheduler.test.ts` models the observer and the frames: a
  burst is one read batch and one commit a frame, a block above a scrolling reader waits for the
  settle, a mounted dirty block is read even when its height is current, an unmounted one never is,
  and teardown returns everything to zero. `features/diff/diffLayout.test.tsx` drives the real pane:
  a thread growing above the reader keeps their row, one below moves nothing, a composer moves what
  follows once in one commit, a scrolling reader holds a correction back until they stop, the pane's
  own correction scrolls do not count as the reader, a collapsed file lands the reader on its header,
  and a width change that resizes every block keeps the place with no fixed rebuild;
- the diff's resident segment cache has three layers of test. `features/diff/segmentCache.test.ts`
  holds the weight estimator, least-recently-wanted order, each ceiling alone, held segments under
  pressure, one held oversize segment, colour going before plain rows, the key's parts, a superseded
  patch, and one cache per query client. `features/diff/segmentLoader.test.tsx` runs the loader
  against a cache with no room, so what stays resident is exactly what the pane holds, through a
  success, a range change, an abort, a failure, a new revision, and unmount.
  `features/diff/DiffPane.test.tsx` remounts a diff on the same node against a source that never
  answers and finds its rows drawn and coloured from memory, checks that a no-op poll drops nothing
  and a moved file drops its old patch, that a resolved thread asks for nothing, and that a
  dehydrated query client holds no segment text. `infra/node/fleet.test.ts` checks that `dropNode`
  clears that node's segments and no other's;
- long timelines have three layers of test. `kit/lib/timelineWindow.test.tsx` holds the window's rules:
  the newest page on open, appended turns joining it, a page per **Show earlier**, a page-aligned
  reveal, keeping its size when its oldest key leaves, and trims that only move forward.
  `kit/components/content/Timeline.test.tsx` drives a windowed followed Timeline over geometry read
  from the DOM's order: hidden counts and `aria-posinset`, **Show earlier** keeping the reader's turn at
  its offset and its element, a hidden reading place revealed rather than substituted, a gone one
  substituted and counted, a trim once a page while following, no trim under a selection or focus or
  while the reader is away, and deferred bodies built in the same element once near, with the
  observer gone at teardown. `plugins/agents/src/client/sessions/AgentTranscript.test.tsx` opens a
  1,000-card session on its newest page, starts another session on its own page, reveals a request a
  notice named, draws everything on **Go to top**, and keeps a real cross-card selection while the
  newest card streams. `toolRendererRegistry.test.tsx` checks a closed tool card builds no output, and
  `plugins/github/src/client/pullDetail/Conversation.test.tsx` checks `kind:id` turn keys, bodies and
  snippets arriving in the same element, only near threads reading segments, **Snippet unavailable.**
  for a file the document lacks, and a refetch keeping every turn's element.
  `features/diff/diffSnippets.test.tsx` checks a snippet reads only its segment, loads nothing for a
  file with no patch, and shares uncoloured rows with the diff through the node cache;
- four arch rules read source text rather than the import graph, because what they police is a
  global rather than an import: `window.acorn` outside the platform seam, and `console.*` outside
  each of the three loggers. Each carries a **baseline** of the files that survive, and each asserts
  against a handful of strings the predicate must still recognise, so a regex that stopped matching
  fails instead of passing vacuously. The client's rule scans `packages/client-core/src`,
  `apps/desktop/src/client`, `apps/desktop/src/shell` and `apps/tui/src`; the node's scans
  `packages/node-core/src`, `apps/node/src`, `packages/custody/src` and `apps/desktop/src/helper`,
  which is where the desktop helper's lines go; the plugins' rule scans `plugins/*/src` and its
  baseline is empty rather than shrinking, because the exceptions the other two allow are arguments
  no plugin can make ([telemetry.md](./telemetry.md) § Logging);
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
questions the renderer asks: which nodes are there, and can a `/v1` request reach one. A 200 from
`/v1/node` means the pinned TLS connection came up and the device token authenticated, so one
assertion covers the custody stack end to end. Two more check the gate: a socket without the secret
is refused, and a plain HTTP request gets 426.

It also prints how long the node took to start, from the helper's ready line to its `service.start`
mark, and fails over 1,500 ms. That span is spawning the node, evaluating the service bundle, and
the node's boot to a bound listener, about 270 ms on an M2 Pro. The bound is loose on purpose, since
timing on a shared CI runner is noisy. It catches a change that adds seconds, and the printed number
is the one to compare between builds.

The Rust unit tests in `apps/desktop/src-tauri/src/` cover what a headless run cannot reach through
the helper: the renderer CSP and the dev-only widening a packaged build must not carry, the traversal
guard, the highlighter worker's separate policy, the refusal to answer a node route with the shell's
own HTML, the handshake and ready-line parsing, the data key's shape and file fallback, the plugin
scheme's hash grammar and frame CSP, the webview URL policies and the key grammar that picks between
them, the navigation-history bookkeeping, the capability file's webview scoping, and the three
packaging properties in `tauri.conf.json`. The macOS pull request job in `.github/workflows/ci.yml`
runs both halves. `.github/workflows/build-desktop.yml` runs them again before the bundler pass on
`main` and tags, so a broken boot path fails before packaging.

What no headless run reaches is compositing: a child webview positioned over a window needs a window.
That is what items 4 and 5 of the smoke checklist are for.

`pnpm dev:agent:smoke` covers the first real-window step on a graphical development host. It starts
an isolated automation build with a fresh data root, reads the onboarding screen through the embedded
WebDriver server, clicks into the project step, takes a screenshot, and shuts the session down. For
feature work, `pnpm dev:agent` leaves the same kind of window running so an agent can inspect and
operate the main renderer; [local-development.md](./local-development.md) documents the commands.

## The browser smoke test

`plugins/browser/src/server/driver.smoke.test.ts` runs an agent's loop against a real Chrome — load a
loopback page, snapshot it, fill a field by its ref, click a button by its ref, and read back the
console line the page logged with the value it saw. Opt-in through
`pnpm --filter @acorn/plugin-browser test:smoke`, because launching a browser is not something every
`pnpm test` should pay for. On a machine with no Chrome it takes the other branch and asserts the
tools reported why.

## Large-surface fixture

The `tui-navigation` variant uses the same generated diff, review notes, and stopped agent session
as `large-surfaces`, then adds another task in the first project and a task in a second workspace.
Both agent launchers accept `--fixture tui-navigation --profile small|scale|canonical --seed N`.
Run the terminal `navigation` flow and desktop `tui-navigation` flow against separate sessions with
the same profile and seed. Their reports capture visible text at comparable navigation checkpoints;
they do not assert pixel parity across renderers. The terminal's 80 by 24 and 120 by 40 checkpoints
are also useful for spotting content hidden by layout, while the manual pass checks focus and
scrolling that plain text cannot describe. The fixture test checks the seeded tasks and workspaces
in a disposable database.

Large diffs and long transcripts are tested against one generated fixture, built from a seed at run
time so nothing a million lines long is checked in. It has three profiles:

| Profile | Files | Fixed rows | Threads and notes | Agent session | Use |
| --- | ---: | ---: | ---: | ---: | --- |
| `small` | 22 | 9,048 | 20 each | 19 turns, 280 events, about 135 cards | Fast tests and a quick real-window run |
| `scale` | 220 | 104,234 | 100 each | 94 turns, 1,384 events, about 670 cards | The scaling comparison |
| `canonical` | 2,200 | 1,077,852 | 400 each | 476 turns, 7,012 events, about 3,400 cards | Real-engine acceptance and profiling |

The counts are for seed 1. Two generators own the data:

- `packages/client-core/src/testkit/largeDiff.ts`, exported as `@acorn/client-core/testkit/large-diff`,
  streams the files one at a time. Each file carries both sides, the unified patch between them, the
  source's threads, and review notes. The files include very large ones, binary, renamed, added and
  removed files, tabs, very long lines, many hunks with gaps, and text that repeats across files.
  Threads sit on both sides, resolved and not, with several comments, Markdown, images, `<details>`,
  and suggestions. `largeDiffSource` turns the files into a `DiffSource` for rendering the real
  `DiffPane` in a test: it cuts the patches with `@acorn/diff-document` as a provider's node does and
  answers segments and search from them, and it can record every segment request or hold each answer
  back.
- `plugins/agents/src/testkit/largeSession.ts` generates the session's turns and writes them through
  the plugin's own store, the way an imported transcript is written. The session ends stopped with
  every request resolved, so a booting node has nothing to recover.

The tests that hold the fixture and the health probes to their contract:

- `largeDiff.test.ts` pins the small profile's digest, checks that every file's row count matches what
  the diff model builds, that every thread and note sits on a drawn line, that the segmented document
  describes each file with the counts its rows have, and streams the canonical profile to check its
  size without holding it;
- `largeSession.test.ts` seeds a session into a migrated database, reads it back page by page, and
  projects it into cards;
- `plugins/changes/src/testkit/reviewNotes.test.ts` checks that seeded notes are the rows the route
  returns;
- `kit/lib/surfaceHealth.test.ts` covers the registry and its privacy rule,
  `features/diff/diffHealth.test.tsx` renders the real pane over the small profile, and
  `Timeline.test.tsx` checks projected against mounted turns, the window's counts, and exact teardown;
- `apps/desktop/scripts/agent/flow.test.mjs` checks that a flow file with an unknown action, a
  script, an unbounded loop, or no assertions is refused, and runs a flow against a fake window.

The real-window run is the large-surface flow
([local-development.md](./local-development.md) § Large-surface flow). It is not part of `pnpm test`,
because it needs a visible window on a graphical host and minutes of real rendering. It asserts
invariants that do not depend on the machine: no blank or uncovered block in a settled viewport, at
most one geometry commit per frame, no source topology after ready, mounted rows under a fixed
ceiling at every profile, the transcript under the same 400-turn ceiling on open and after one
**Show earlier**, and teardown back to zero. It records, and does not gate, time to first
content, time to ready, preparation and measurement time, correction pixels, and resident bytes,
with the host, engine, build, and fixture beside them. The segmented document was built after the
first partial run, which was the unsegmented baseline; a visible run at `scale` and at `canonical`
is still owed for both. Run it on the host used for release checks and keep both JSON reports.

## Continuous integration

`.github/workflows/ci.yml` runs `pnpm lint` and the non-desktop `pnpm test` suites on every pull
request and on push to `main`. A separate macOS job runs `pnpm --filter @acorn/desktop test` on pull
requests without signing secrets. `.github/workflows/build-desktop.yml` runs the same desktop tests
before building the signed artifact on `main` and tags.

The non-desktop job runs on Linux. A macOS runner has no Docker for the container probes to find,
and its `/var` is a symlink to `/private/var`, which causes one of the pre-existing failures below.

`@acorn/desktop` is filtered out of the Linux test run. Its macOS pull request job installs Rust and
caches the pinned Node runtime; the package's `test` script stages the bundle inputs, builds the
renderer, runs Vitest including the helper boot test, and runs `cargo test`. It does not require
updater signing secrets or build a distributable.

The workflows cache dependencies and the pinned Node runtime, but not Turborepo task outputs. CI
runs suites that a local `pnpm test` might serve from Turborepo's cache. A green local run with 30 of
31 tasks cached is not evidence about the one task you changed.

The startup budget checks live in `build` scripts because they assert properties of built output.
`@acorn/desktop`'s `build` runs
`apps/desktop/scripts/check-renderer-budget.mjs` over the built `index.html` and Vite's manifest, and
`@acorn/tui`'s `build` runs `apps/tui/scripts/check-startup-graph.mjs` over its built chunks. Both fail
the build over a byte ceiling or a denylisted chunk name; [frontend.md](./frontend.md) § Startup budget owns what they
enforce. The TUI build also checks that Node can resolve every external import in its emitted modules,
including lazy chunks, through `apps/tui/scripts/check-runtime-imports.mjs`.

The desktop pull request job builds the renderer through its `test` script, but does not run the
renderer budget check; `build-desktop.yml` applies that check to the real build output. The terminal
client's build check runs when somebody builds that package. Each has a fixture suite that drives the
same script against a directory it writes itself — `apps/desktop/test/scripts/` and
`apps/tui/src/startupGraph.test.ts`. The TUI's `apps/tui/src/runtimeImports.test.ts` exercises its
external-import check. Those fixture suites gate pull requests.

## The smoke checklist

Run this pass against the packaged desktop app on a clean host before an alpha release. Record the
artifact version, operating system, result, and any issue for each step. The development window and
headless suites do not exercise native chrome, packaged schemes, or host-owned child webviews.

First run `pnpm lint`, `pnpm test`, `pnpm --filter @acorn/desktop test`, and `pnpm db:check` on the
release commit. `pnpm test:coverage` is a diagnostic for four critical code paths; it has no release
threshold. See [Coverage measurement](#coverage-measurement) for its scope.

1. Install the signed artifact on a clean host. Launch it, finish onboarding, open a local project,
   create a task, and confirm the local Node reaches online. Quit and relaunch; the task and pairing
   remain available.
2. Pair a second Node by code. Confirm the fingerprint words, switch between Nodes, and open a task
   on each. Disconnect and reconnect the second Node; the first Node's task data remains scoped to it.
3. Start a managed agent with an installed CLI, approve or deny one tool request, and reopen its
   transcript after a restart. Open a terminal session, send a command, and confirm that it survives
   switching tasks.
4. Open a task preview through the tunnel and a host-owned editor. Navigate the preview, open an
   overlay, and confirm that the child webview stays behind it. Check the native menu and one file
   dialog.
5. Install a freshly scaffolded plugin from a local package. Accept the bundle, open its own pane,
   run its command, and confirm its Node route result appears. Reload after editing its entry and
   route module, then disable, enable, and remove it. Confirm that its UI and command follow each
   transition and that an unaccepted bundle cannot draw.
6. Open the terminal client at 80 by 24 and 120 by 40. Navigate the rail, pane strip, plugin pane,
   palette, and a PTY with the keyboard. Confirm that Escape restores focus and that the trust prompt
   holds focus until a decision.
7. Create and run a workflow with a gate, inspect its child task and history, and resume or cancel it.
   If release accounts are configured, run a query-backed schedule against a real provider and check
   that a repeated check creates no duplicate child.
8. Quit with an active agent and confirm the concern prompt and clean shutdown. Exercise Node
   recovery by stopping the helper's Node repeatedly; the recovery screen appears after the retry
   limit.

Run the relevant [specialized manual checks](./testing/manual-checks.md) after changes to plugins,
large diffs, transcripts, palette behavior, appearance, accessibility, provider integrations, or
other surfaces not covered by this pass. The catalog retains the detailed scenarios and dated results.

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
