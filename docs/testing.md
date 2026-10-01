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
machine badly enough that they time out while passing in isolation. The bound is six packages at a
time. Set `ACORN_TEST_CONCURRENCY` to change it. CI sets it to one. Each package's Vitest already
starts a worker per core, and six packages at once on a four-core runner made tests 10 to 15 times
slower than they run locally.

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
| Client frame bridge and host | `packages/client-core/src/host/frames/`, including `PluginFrame.test.tsx` for iframe connection, startup deadline, and teardown | `packages/client-core/src/host/frames/**/*.{ts,tsx}` |
| Workflow execution | Seven suites covering dispatch, child lifecycle, maps, nested runs, processing, projection, and schedules | Seven modules: `runs/runner.ts`, `steps/execution.ts`, `dispatch/dispatcher.ts`, `dispatch/childLifecycle.ts`, `processing/rules.ts`, `runs/read/projection.ts`, and `schedules/service.ts` under `plugins/workflows/src/server/` |

Use the report to find untested branches before changing these boundaries. It is not a monorepo
coverage percentage. Integration tests in other packages can exercise a contract without appearing
in its package-local report. The Node plugin worker runs in a separate thread, so its source appears
uncovered in this in-process V8 report even when loader tests exercise it. No global percentage
threshold is set.

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
  rather than a scenario: it walks every stop on nine surfaces, which are the browse rail, the six
  panes the pane sweep opens, the browse rail again with the cheat sheet open over it, and the
  Settings route open on Notifications, the one core page the terminal draws a form for. After
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
- long timelines have three layers of test. `kit/lib/timeline/timelineWindow.test.tsx` holds the window's rules:
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
- `kit/lib/telemetry/surfaceHealth.test.ts` covers the registry and its privacy rule,
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
15. Select a plugin-contributed theme; the terminal and CodeMirror pick up the right light or dark
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
38. Open a plugin's search frame, then disable that plugin from Settings → Plugins → Installed. The frame closes,
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
46. With no model provider connected and no agent CLI installed, the commit toolbar has no wand at the
    left of it. Add one in Settings, under AI models, reopen the pane, and stage two files.
    Press the wand: it spins, and
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
    once, with the same indentation the editor drew. Select one, while it is still working: its
    transcript is here, following the newest turn, with the node's toolbar staying put above it and the
    composer staying put below. The composer says a turn sent now runs after the step. The command
    node's output tails as it runs and folds away with its exit code when it stops.
    Then press **Show in Agent pane** and put the two panes side by side on that session: both
    transcripts move together, a file attached in one appears in the other, and the "Workflow: …" chip
    in the Agent pane's header comes back to this pane at that node. Last, run one with child dispatch or a
    worktree-isolated agent step and check the conversation you get is the child task's.
52. Let the run reach the gate. The bell rings, and the row in it lands on the gate node with Approve
    and Reject in front of you; the inbox has the same row and it stays there until you answer.
    Approve, and the run finishes and keeps a notice. Then run a definition whose gate has a form
    bound to an agent step's structured output, and a later step bound to the gate's `/values`. The
    gate node shows the proposed values. Edit one, check it is marked **Edited** and that **Reset**
    restores it, edit it again, and approve. Confirm the later step received the edited value, and
    that the terminal client draws the same form.
53. Make one node fail, by pointing its command at something that exits non-zero. The pane offers
    **Retry**, and an agent node also offers **Retry with edited prompt**; both put the run back to
    running from that node. Then check the pane is not there at all on a task that has never run a
    workflow, and that the agents pane draws no workflow step rows anywhere. In **Agent Center**, the
    workflow session's row carries a **Run** chip: the row body opens the session and the chip opens
    the run at that node.

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

Next is the graph view's ([ui-design.md](./ui-design.md) § The closed kit). A canvas is the one kit
node whose whole point is what it looks like, so a suite can check the geometry and nothing else.

56. Open the owner's first workflow and press **Graph**. It draws two roots joining into the
    synthesis node, with the list column still beside it. Drag a card: it lands on the grid and its
    wires follow. Drag from one card's bottom port onto another: the second now waits on the first,
    and the footer agrees. Press the `×` on that wire and it goes. Select a card and press Backspace:
    it is removed, and the same edit is in the JSON tab. Reload the surface and the cards are where
    you left them. Then start a run and press **Graph** in the pane's Nodes header: a card recolours
    as its step starts and finishes. In the terminal client, both **Graph** views are the indented
    list, the arrows walk the cards, and the editor's has a picker under it that draws an edge out of
    the selected card.

Next is the editor's **Generate** button
([workflows.md](./workflows.md) § Generating one from a description). A pure suite pins the prompt
and drives the reader from a table, and neither can see whether the teaching worked on a real model.

57. With nothing to generate with, no key and no agent CLI, the editor toolbar has no **Generate**
    between the tab strip and **Undo**. Add one in Settings, under AI models, reopen a workflow
    row, and press it.
    Describe the owner's first workflow in words: two agents investigate one issue from different
    angles at the same time, a third reads both and writes the synthesis, and somebody approves
    before anything is pushed. The dialog counts seconds while it works, and a couple of minutes is
    normal. What lands has two roots, a step whose `after` names both of them, and a human gate.
    That is the check the rest of the item hangs off: a straight chain of five steps means the prompt
    failed to teach the graph. Read the footer, press **Save**, then **Run**, and watch it
    in the run pane. Press **Undo** once and the draft you had comes back whole. Then generate again
    from a description that asks for a `code-review` step kind, which no node has: the definition
    still applies, and the alert above the node list says what was taken out of it. Last, open a
    committed file from the rail and confirm there is no **Generate** on that toolbar at all.

Next is the first-run wizard's AI step
([integrations.md](./integrations.md) § Model providers). The plugin's own jsdom suite draws the step
against a fixture route, and what it cannot see is the route answering from a real `which` on a real
machine, or the wizard's own flow around the step.

58. Clear the `onboarded` preference on a node with no projects and walk the wizard end to end. On
    **Generate with AI**, every agent CLI on that machine is a row saying it is installed, and every
    one that offers a one-shot mode and is not there is a quiet row saying so, with no alert. Press a
    provider card, paste a key, and press **Connect**: the rows above gain that provider, and the
    step's **Next** was enabled before you did any of it. Then walk the wizard again on a machine
    with no CLI installed and no key: the step says Settings, under AI models, is where this lives,
    and **Next** still works.

The last four are the Generate list's, owed since the backends over installed agent CLIs shipped and
**not yet run** ([integrations.md](./integrations.md) § Model providers). The list builder, the
dispatch, the containment and the picker all have suites, and none of them can spend a real CLI on a
real machine, which is the whole point of the feature: the reader who has `claude` or `codex` on PATH
and no API key at all. Run them with the keys disconnected first.

59. With no model provider connected and `claude` installed, open the SQL dialog on a task with a
    database connection, press the commit-message wand on a task with staged changes, and press
    **Generate** in the workflow editor. All three offer Claude Code, and all three come back with an
    answer. Then connect a key and run ⌘K → **Generate SQL**, the palette path that draws no picker:
    it spends the key, not the CLI, because connections come first in the list and that fast path
    takes the first backend. Last, sign out of the CLI (or rename it off PATH between the read and the
    press) and generate again: the failure names Claude Code and says to run it once in a terminal,
    and the node log has the stderr tail while the client gets none of it.
60. Pick Codex in the commit wand and press it. The picker offers no model select for Codex, because
    its model list lives in `~/.codex/config.toml` rather than here, and the message still arrives.
    Then run a workflow with a `decide` step whose profile is `codex`: it reaches a verdict and the
    run carries on past the gate, which is the check that Codex's own stream shape is being read
    ([managed-agents.md](./managed-agents.md) § Harnesses).
61. Pick Anthropic in the commit wand, then open **Generate** in the workflow editor: it opens on
    Anthropic. Disconnect the key and open it again: it opens on Claude Code. Change the default in
    Settings, under AI models, and both open on that instead. The SQL dialog is expected not to
    follow any of this and to open on the first backend every time
    ([state-ownership.md](./state-ownership.md) § Scope rules).
62. The acceptance test for the manifest one-shot block, which needs `opencode` installed. Write the
    OpenCode plugin from [plugin-authoring.md](./plugin-authoring.md) § Harnesses alone, without
    reading this repository, install it from a folder, and approve the trust prompt: it shows two
    lines, the ACP spawn and `opencode run --model MODEL` to generate text. OpenCode then appears in
    the Agent pane, in a task terminal, and in every Generate control, and generates a commit
    message. That the doc is enough on its own is what is being checked, so a step that sent you to
    the source is a failure of the doc.

The next two items cover agent-driven delegation. They were not run for this implementation because
the available checkout cannot launch the app without GitHub credentials. The automated suites cover
the Node, storage, MCP, runtime, and component contracts; these items remain the provider-backed
acceptance pass.

63. Enable the execute tier in Settings → Tools and permissions. From a Claude Code terminal, call
    `agent_spawn` once with shared isolation and once with worktree isolation. Use `agent_wait` and
    paged `agent_read` to collect each answer, then use `agent_prompt` for a second turn and
    `agent_cancel` on an active turn. Repeat from a Codex terminal. Confirm that retrying the original
    MCP call does not create another task, session, or turn; the shared child appears in the same task's
    Agent pane; and the worktree child appears under its parent task and opens its own panes.
64. Repeat the same flow from one managed Claude Code parent and one managed Codex parent. Confirm
    that each child nests under its managed parent, the parent chip returns to that session,
    provider-native subagents still render under their provider session, and a child can create one
    directly owned grandchild but the next level is refused. Trigger a permission or question request
    in a child and confirm `agent_wait` reports attention without giving the parent an approval action.
    Narrow the parent's tool ceiling and confirm the child cannot widen it. Run the parent as a
    workflow-owned session and confirm `agent_spawn` is absent.
    Then let the managed parent end its turn while a child is still working. Confirm that one
    "From" report turn arrives in the parent with the child's final message, that the child's
    transcript labels the parent's prompt "From" and the parent's title instead of "You", and that a
    parent which reads the result with `agent_read` before its report runs receives no report.


The next five items are the workflow-task release checks. They were not run in this worktree because
the app requires the main checkout's environment and port. The workflow, integration, and host tests
cover the corresponding state and rendering contracts.

65. Run a workflow whose child stops at a human gate. Confirm the parent is gated, the child card says
    approval is required, and opening it lands on the child gate. Approve it, then use the child
    run's parent and root links to return to the original run.
66. Map three structured items so one child succeeds, one fails, and one waits for approval. Confirm
    the progress and failure counts update, every task and run link opens the right child, and the
    parent waits for all three before failing. Check each bounded result and compare the root's tree
    usage with each child's own usage.
67. Cancel a running mapped workflow and confirm the dialog says it cancels the run tree. Check that
    admitted child runs and managed sessions settle before the parent does, while the child tasks
    remain available. Retry a failed map and confirm it reuses those tasks and runs instead of
    creating replacements.
68. Disconnect the active Node while viewing a parent and child, let both advance, then reconnect.
    Confirm the run list, selected steps, child progress, gates, failures, and usage reconcile without
    relying on the missed frames.
69. On two Nodes, create fixtures with the same task and run IDs and different titles. Switch between
    the Nodes and confirm navigation and history stay with the active Node. Then run one mapped child
    workflow and one static inline workflow reference to confirm both behave as
    documented.
70. Run a Codex session and a Claude Code session that each search the web for a distinctive phrase,
    then open one result. Confirm each call is one card, that the row says `Search web` with the query
    beside it, and that opening it shows the query, any domain filter, and the sources as links. Run
    Claude `WebFetch` and confirm it reads as a page fetch with its prompt rather than as a search.
    Make a provider-native subagent search in each harness and confirm the card stays in the child's
    transcript. Then search Agent Center for the phrase, a result title, a domain and a URL fragment.
    Finish in the terminal client at 80 by 24: open and close the fold, focus a result link, and
    confirm the address is readable. Last, open a Codex session recorded before this shipped and
    confirm its status-only row still draws as the flat `Web search` row
    ([managed-agents.md](./managed-agents.md) § Web activity).

71. The reconnect an agent advertises rather than declares, which needs `dsh` installed and the
    DeepSeek plugin at `../acorn-deepseek` loaded from a folder. Start a DeepSeek session, get an
    answer, quit the app and start it again, then ask the agent about something only the earlier turn
    could know. It should remember, and the transcript should carry no "starts fresh" warning: that is
    `session/resume`, and before it acorn silently began a new agent under the unchanged transcript.
    Check the pane while you are there, because DeepSeek's surface is narrower than Claude's on
    purpose: permission cards work, the model picker lists its models and reasoning effort, cancel
    stops a turn, and there is no plan section, no mode picker and no question card
    ([managed-agents.md](./managed-agents.md) § Harnesses).

72. The two doors a harness declares and the one it does not. With the same plugin loaded, ask DeepSeek
    something only an acorn tool can answer, such as what the task is about or what the local diff
    contains: it reaches them over the protocol, because it has no `mcp add` command to register
    through ([mcp.md](./mcp.md) § Configuration). Then ask Claude Code the same in a task terminal and
    confirm each acorn tool still appears once, not twice. Last, press the commit-message wand and open
    **Generate** in the workflow editor: both offer DeepSeek, and it answers. Its terminal profile menu
    entry should be absent throughout, because `dsh` alone has no interactive mode.

The next six are workflow v2's release checks ([workflows.md](./workflows.md) § Typed data and
conditions, § Record processing history, § Scheduled roots). Controlled provider fixtures cover them
in the suites, but they need connected GitHub, Linear, and Rollbar test accounts and a configured
model provider, and none had been run against real accounts when the programme shipped. Build each of
the first four by hand, then again through **Generate**, and compare the resolved queries and
bindings rather than the prose.

73. Query open pull requests by one author in a real repository and preview them. Publish Find records
    → For each → a review workflow. A closed pull request is left out whatever its merge readiness,
    numbers stay numbers in the bindings, and each selected pull request gets one child task.
74. Query Linear issues by project, exact state, and **Updated in last 24 hours**. The child fetches
    details, sets a typed **Requires work** boolean, and starts an analysis grandchild only when it is
    true. A false value creates no task and is not a failure.
75. Query Rollbar error groups first seen since midnight in a named timezone. An older group with a
    fresh occurrence is left out. Each child fetches the stack trace through **Get record details**.
76. Save one of those queries, then use it from a workflow and a dashboard panel. Editing the panel's
    display changes no source state. Publishing a change to the shared query updates the panel and
    marks the workflow's schedule for review.
77. Schedule the Linear workflow with **Start tracking from now**. After an issue changes, the next
    check starts one child for it, the record history links its task and run, and **Run now** during
    an active run is skipped with a link to that run.
78. Build and schedule a workflow using only the keyboard in the desktop window: open the editor, pick
    fields, publish, and activate the schedule. Focus stays visible and returns to its trigger when
    each dialog closes.
79. Archive a task with a committed change and find it on the Archive page by a word from its agent
    transcript. Open the matching session in the preview, and check that its right rail holds only Agent
    and Notes. Restore it and check that the worktree comes back with the commit. Then
    delete the branch of another archived local task and check that restore asks before it cuts a new
    one.
80. Open a Shell tab on one task and run a command that prints a line a second. Switch to a task
    without the terminal drawer open, wait ten seconds, and come back. The same terminal is there with
    every line printed while you were away. Open more than four terminals across tasks and switch
    between them: each draws, and none goes blank after its GPU context is given to another. Close the
    tab and check that switching back does not bring it back.
81. With GitHub connected, open a pull request with more than 100 files, more than 100 commits, or a
    review thread with more than 100 comments. Every file, commit, and comment is there in GitHub's
    order. Open one with more than 3,000 files: the diff and the file list both say GitHub returned
    3,000 of its total. Compare two branches with more than 300 changed files in the create form: the
    count reads "first 300 files" and the preview says the comparison may have more.
82. Open the diff of the largest pull request to hand, in unified and then split. The scrollbar is its
    final length at once, file headers and the widest line are in place before their rows, rows appear
    plain and then take colour, and a thread's space is there before its segment loads. Drag the
    scrollbar to the end and back: every segment you land on draws within a moment and nothing between
    loads. Find a word that appears only near the end and step to it. Expand a gap, collapse a file from
    the sticky header, and leave the pane open for a minute: the health snapshot shows nothing queued.
    In split mode, scroll a long line sideways before its colour arrives: it stays scrolled when the
    colour lands. Find a match in split mode: the view lands on the band that holds it. With find
    open, expand a gap above the match: the view does not jump back to the match.
    Then do the same in the Changes pane while an agent edits a file: only that file's segments
    reload, and the reader stays where they were. Run `git config diff.noprefix true` in the task's
    worktree and reopen the Changes pane: every changed file still shows its diff. Unset it afterwards,
    because the setting is the whole repository's.
83. In that pull request, scroll to a place with a thread a screen above you and one below. Expand
    and collapse the one above, reply in it so the box grows, and resolve it: the line you are reading
    does not move. Open a `<details>` block and wait for a late image in the one below: nothing on
    screen moves. Open a line composer on screen: what follows moves down once, with no frame where the
    composer overlaps the next line. Flick-scroll through several threads: nothing jumps while you
    move, and the view settles without a correction you can see. Narrow the pane by dragging the
    sidebar, then widen it: the same line stays at the top. Leave the pane and take a health snapshot:
    no observers, no scheduled frames, and `maxAnchorDrift` under a pixel.
84. Open that pull request's diff, scroll to the middle, and switch to another task and back: the
    rows you left are on screen, coloured, before any segment request, and the health snapshot's
    `resident.hits` rose. Open a dozen other large diffs one after another: `resident.rows` and
    `resident.estimatedBytes` stay under `rowCeiling` and `byteCeiling`. In the Changes pane, let an
    agent save the same file several times: `resident.segments` does not grow with each save.
85. Open the `canonical` fixture's Agent pane: it opens on the newest cards with **Show earlier** above
    them, and the health snapshot shows 200 mounted of about 3,400 turns. Scroll a little way up and
    press **Show earlier**: the card you were reading stays put. Select text across two cards, scroll
    to the foot, and let a live session stream past 400 cards: the selection survives, and once you
    clear it the next page of cards trims the window back to 200. The console shows no
    `ResizeObserver loop` error while the stream passes 400 cards. Press **Go to top**: the oldest turn
    is on screen, and the page's find matches its text. Open a notice for an old request: its card is
    drawn and focused. With VoiceOver, a card reads its place in the whole session. In a pull request
    with many threads, open the conversation and scroll: each comment's HTML and each thread's snippet
    appear before you reach them, a capped file's thread says **Snippet unavailable.**, and nothing
    already drawn is rebuilt when the pull refetches.
86. On two paired Nodes with different accepted versions of one loaded plugin, switch between them.
    Each Node shows contributions from its own running version. Update the inactive Node, reject then
    reconsider its new client hash, and switch again: its old runtime remains visible until its Node
    commits the update. After restart, the new version appears only when its exact bytes are accepted.
    Disconnect, reconnect, and unpair one Node; stale or removed observations authorize no loaded UI.
87. Open two remote trees from one loaded bundle with different task or project scopes. Select in one,
    invoke a scoped action in each, then unmount the first. The second remains functional and never
    receives the first tree's selection, document effects, or gesture authority. Revoke the accepted
    hash while a tree is mounted; its worker and registrations disappear immediately.
88. On a Node without a loaded plugin, check its settings page, project importer, task footer, command,
    shortcut, and cooperative slot. They are absent or disabled, and a previously open importer closes.
    Repeat with a failed load and with an unaccepted active runtime. In the terminal client, confirm
    the same selection and trust behavior for a remote tree.

The plugin lifecycle checks are supported by `distributionModel.test.ts`,
`distribution.test.ts`, `availabilityModel.test.ts`, the Node state and bundle-route tests, and the
worker/remote-tree suites. The real desktop driver reaches the main renderer but not native dialogs
or host-owned child webviews; use the release pass for those surfaces. On 2026-09-26 an isolated Tauri
session verified Settings → Plugins and a Findings remote settings tree, including its two controls.

The task-annotation lifecycle's automated coverage described under Test layers was implemented on
2026-09-26. The following real-window and real-terminal checks keep the same host behavior reviewable
when the annotation or rail contracts change.

89. Check the rail under the Terminal, Modern, Cozy, and Cute style packs.
90. Check source, task, pane, run, terminal, add, and close controls at rest, hover, focus, active,
    and busy.
91. Confirm that the left add control and right close control occupy equal 52-pixel boxes with aligned
    dividers.
92. Confirm that project accent stripes stay on the left and right-rail active stripes stay on the
    right.
93. Open a task with pin, Docker, unread, working, dirty, checks, and loaded-plugin annotations.
    Confirm that markers do not overlap and that the tooltip and accessible description list every
    accepted state.
94. Turn on reduced motion and confirm that marker and busy animations stop.
95. Open and dismiss a task-row menu. Confirm that it anchors to the rail button and returns focus to
    that button.
96. Change a loaded plugin's task status without changing the task list. Confirm that its marker
    refreshes after a plugin push, global status, and declared polling.
97. Disable, enable, reload, and remove that plugin. Confirm that its marks disappear synchronously
    and return only while its contribution is eligible.
98. Switch between two nodes that contain the same task id. Delay one node's response and confirm
    that neither the delayed answer nor either retained mark appears on the other node.
99. In `acorn`, show more task markers than the row can fit. Confirm that the row shows `+N`, then
    focus it and press `Shift+F10` to inspect every marker label in the **Task markers** list.
100. Under Settings > Custom agents, make a Codex agent with high reasoning and one instruction line.
     Start it from **New**, from the empty pane's card, and from the palette's own "New *agent*
     session" row. Confirm that the composer shows high, the header chip names the agent, and asking
     the agent what it was told returns the instruction, including after a node restart resumes it.
101. Repeat check 100 on Claude Code, then edit the agent's instructions. Confirm that a running session
     keeps the old text and a new one gets the new text.
102. Install a loaded package whose manifest declares only `customAgents`. Confirm that the trust prompt
     shows the instructions in full, that the agent is listed with **Duplicate** but not **Edit**, and
     that disabling the package takes it out of **New**.

145. Install a loaded plugin whose source declares `showInRailByDefault: false` and whose settings page
     declares `railSourceVisibility`. Confirm that no rail icon appears and the palette offers
     **Open <label>**, which opens the source without adding the icon.
146. Turn **Show in left rail** on from the plugin's page. Confirm that the icon appears at once, the
     switch under Settings > Plugins agrees, and the current view does not change. Drag the icons, hide
     it again while it is selected, and confirm that the window returns to Home and the drag kept its
     slot.
147. Hide a project-scoped source such as GitHub. From Home with no project routed, run its palette
     opener and confirm that the palette keeps an error instead of closing. Disable the plugin and
     confirm that its switch and opener disappear, then re-enable it and confirm that the saved choice
     returns.
148. In `acorn`, confirm that the hidden source is still listed in the terminal's source menu.

Checks 96–99 passed on 2026-09-27 with an isolated `dev:agent` data root and a loaded fixture plugin.
The Tauri window refreshed only that plugin after its push, cleared marks across disable, enable,
reload, and removal, and switched between two nodes whose copied task databases contained the same
task id without retaining the other node's label. The real terminal projected six accepted markers
as `+6`; `Shift+F10` opened **Task markers**, and End reached the sixth label. That run also caught and
fixed a long-title layout that could previously shrink the disclosure out of the row.

The following checks cover [frontend.md](./frontend.md) § Settings. The rail's order, deep links, the
remembered page, and the settings-local node switcher have automated coverage in
`packages/client-core/src/features/settings/SettingsView.test.tsx`; these checks cover the window.

103. Open a task with a running agent session and a terminal running `top`. Press ⌘, and confirm that
     settings covers the whole window, top bar included. Wait ten seconds, press Escape, and confirm
     that the agent's transcript and `top` kept updating and that the terminal has focus again.
104. Open settings, click into the search field, and type into it. Confirm that nothing reaches the
     terminal underneath. Press F6 or the region chord from a rail row and confirm that focus stays
     in settings.
105. Walk every group in the rail and open each page once. Confirm that each page's body draws, that
     its breadcrumb names its group, and that the scope chip reads **This device**, **Node: <label>**,
     or **Workspace: <name>** as the page's registration says.
106. Pair a second node. On Installed, Security and backup, Audit log, Schedules, Run history, and
     Telemetry, switch the header to the second node and confirm that the page shows that node's
     data while the top bar's node, after closing settings, is still the first. On Services and
     on a loaded plugin's page, confirm that the chip is plain text naming the active node.
107. From the GitHub pane's shortcuts link, confirm that settings opens on **Keyboard shortcuts**.
     From the palette's **Settings** group, confirm that every page in the rail has a row and that
     picking one while settings is open moves to that page.
108. With a Select open on Appearance, press Escape once. Confirm that the list closes and settings
     stays open. Press Escape again and confirm that settings closes.
109. Narrow the window below 900 px. Confirm that the rail fills the window, that picking a page shows
     the page with a **‹ Settings** link, and that the link returns to the rail.

The next checks cover [frontend.md](./frontend.md) § Search and deep links and § Pages and the save
model. Saved, a failed write, the unsaved-changes question on Escape, and search ranking with the
section highlight have automated coverage in `settingSave.test.tsx` and `SettingsView.test.tsx` beside
the view; these checks cover the window and the pages.

110. Walk every settings page. Confirm that no page has a **Save** button outside a form, and that
     every text field shows **Saved** beside its label after you change it and press Tab or Enter,
     and that the field keeps its width while it does.
111. Stop the node, or take the machine offline, and change a text field on a node page such as Limits
     and cost. Confirm that the field keeps what you typed and the row shows the error. Bring the
     node back and commit again, and confirm that **Saved** appears.
112. Type a declared section's keyword in the rail's search, for example `text size` for Terminal › Drawer.
     Confirm that the result reads **Page › Section** with a scope chip, and that Enter opens the page,
     scrolls to the section, and outlines it for about three seconds. With Reduce Motion on, confirm
     that the outline still shows. Repeat from the palette's **Settings** group, and with
     `openSettings('terminal#drawer')`.
113. Start a new schedule or edit an MCP server, type into it, and press Escape. Confirm that settings
     asks before discarding, that **Cancel** keeps the form, and that **Discard changes** closes
     settings. Repeat with a rail row and with **Back to acorn**.
114. On a page with a danger zone, such as a workspace's page, press its delete button. Confirm that the
     confirmation paints above settings and names what goes and what stays, and that **Cancel** leaves
     the workspace in place.
115. Change the terminal text size away from its default. Confirm that the row shows a dot and
     **Reset**, and that Reset puts the default back and the dot goes.

The next checks cover [frontend.md](./frontend.md) § Workspaces and projects. The run-targets table's
round trip, the read-only provenance row, Default's protection, a plugin's project tab, and the rail's
tree with ⌘[ have automated coverage in `RunTargetsTable.test.tsx`, `ProjectSettings.test.tsx`,
`WorkspaceSettings.test.tsx`, and `SettingsView.test.tsx`, and the node's `repoConfig` in
`packages/node-core/src/server/routes/projects/membership.test.ts`.

116. On Overview, select two projects in different workspaces. Confirm that the bar says **2 selected**,
     and that **Move to workspace**, **Hide**, **Set colour**, and **New workspace…** each change both
     rows and say so under the bar. Confirm that **Clear** empties the selection.
117. Open a workspace from the rail. Confirm that its projects appear under it only while it is
     expanded, that the chevron and the Right and Left arrows expand and collapse it, and that typing a
     project's name in the rail's search finds its page with the workspace collapsed.
118. Open a project from Overview, then press ⌘[. Confirm that it returns to Overview. Open the same
     project from its workspace's page and press ⌘[ twice: the workspace, then Overview. Confirm that
     the header reads **Project: <name>**, and names the node too with two paired.
119. Walk each tab of a project's page and change one field on each. Confirm that each shows **Saved**,
     and that the value is still there after closing and reopening settings.
120. Add, edit, and remove a run target from the table. Confirm that a task on that project shows the
     run buttons the table lists, and that a second default moves the default rather than adding one.
121. Commit a `.acorn/config.toml` to a project with a `[scripts.run.dev]` target, a `[database]
     url_script`, and a `[preview] mode`. Confirm that the dev script, the database connection script,
     and the preview URL rows read **From .acorn/config.toml**, cannot be edited, and show the file's
     value above this machine's. Delete the file and confirm that the rows are editable again.
122. Try to rename or delete Default from its page, from Overview, and from the rail. Confirm that
     none of them offers it.

The next checks cover [frontend.md](./frontend.md) § Agents. The header's detail and back link, old
page ids, and the device chip have automated coverage in `SettingsView.test.tsx` and the terminal kit
test. The custom agent and MCP server editors, Harnesses and defaults, and both core pages are covered
in `plugins/agents/src/client/settings/*.test.tsx`, `AgentToolsSettings.test.tsx`, and
`McpSettings.test.tsx`, and the project MCP routes and the catalog's owners in
`packages/node-core/src/server/routes/projects/projects.test.ts` and `agentTools.test.ts`.

123. On Harnesses and defaults, turn **Send task context at startup** off, then open Claude Code in a
     task's terminal drawer. Confirm that no task context arrives. Turn it back on and confirm that the
     next one gets it, and that the Terminal page no longer shows the switch.
124. On Custom agents, create an agent, then edit it. Confirm that the editor opens in the pane, that
     the header names it with a back link, and that ⌘[ with an unsaved change asks before going back.
     Delete it from the danger zone and confirm that it leaves New and the palette.
125. On MCP servers, add a server, edit it, and remove it from its danger zone. Confirm that each step
     happens in the pane, that the list names `/mcp`, and that its link opens MCP config files.
126. With no task open, open MCP config files, pick a project with a committed `.mcp.json`, and note
     its servers. Open a task in that project, open the page again, and confirm that it starts on that
     project and lists the same servers.
127. On Tools and permissions, switch between **By owner** and **By tier**. Confirm that a loaded
     plugin's tools sit under its id, and that turning the Execute tier on and off moves every execute
     tool's switch.
128. From a queued agent turn's **Change** link, and with `openSettings('agent-pricing')`, confirm that
     Limits and cost opens on **Turns at once** and on **Claude prices**.
129. Under **Settings > Plugins > Installed**, install a GitHub package on the node and a client-only
     package on this device from **Install…**. Confirm that each target asks for trust, that the device
     plugin appears under **This device**, and that a package waiting for approval appears under
     **Needs you** with a dot on **Installed** in the settings rail.
130. On a plugin page, open each of **Overview**, **Settings**, **Permissions**, and **Versions**. Approve
     a staged package an agent requested, end dev mode for a plugin in development, and revoke one
     approval. Uninstall one plugin with **Keep its data** and another with **Delete its data**, and
     confirm that each confirmation names what goes and what stays.
131. Turn an optional node plugin off from its page's strip. Confirm that the strip says it is off, that
     the page still saves, that **Installed** shows the restart banner, and that the settings rail shows
     a dot until the node restarts. Turn a device plugin off from its strip and confirm that settings
     opens its page under **Installed**.
132. Open the plugin strip on a compiled plugin page (Docker), a remote tree (Sentry export), and a frame
     page. Confirm that the strip sits above the page, outside it, and stays in place while the page
     scrolls.
133. On **Rail and surfaces**, hide a plugin source. Confirm that its icon leaves the rail, that the
     palette offers **Open <source>** and opens it, that the source stays open after it is opened from
     the palette, and that hiding it while it is selected returns to Home. Reorder the rail while it is
     hidden, show it again, and confirm that it returns to its slot. In the terminal client, confirm
     that the source is still in the source menu.
134. With a switch whose write fails (stop the node, then flip **Hidden** on a project page), confirm
     that the switch returns to the stored value and the row shows the error. After confirming a
     danger-zone delete from a clicked button, confirm that Escape still closes settings.
135. With a real Linear key, connect it from **Settings > Connections > Services > Add connection**.
     Confirm that the Linear card asks for **Personal API key**, that typing a key and pressing Escape
     asks before it drops it, and that Save lands back on the list with the connection in it. Open
     **Add connection** again after connecting GitHub: its card says **Connected, one allowed** and
     opens the GitHub connection.
136. Revoke that Linear key at Linear, then press **Test** on its page. Confirm that it moves to the top
     of Services with an amber dot, that the settings rail shows the dot beside **Services**, that the
     bell has a row for it, and that its page starts with the refusal and **Replace key**. Replace the
     key and confirm that the dot, the row, and the banner all clear without reopening settings.
137. On a Linear connection's page, follow a project into one workspace from **Where it shows up**.
     Confirm that the workspace's page lists it under **Connections**, that the project's
     **Connections** tab lists it too, and that **Manage** there opens the connection's page. Search
     for the connection's name and confirm that Enter opens its page, not just Services.
138. On **AI models**, confirm that **Generate with** carries the **This device** chip, that an
     Anthropic key is listed under **API keys** and not on Services, and that an installed `claude`
     is listed under **Agent CLIs**. Search `startup context` and confirm that Enter lands on
     **Harnesses and defaults › New sessions**.
139. In the terminal client at 80 by 24, search `settings` in the palette and confirm that **Open
     settings** is the first row and opens the route on the nine groups. Open a page in each group and
     confirm that a page marked **desktop app** says why and where to go, that Escape climbs one level
     at a time with the caret back on the row it left, and that the plugin pages (Harnesses and
     defaults, Docker, Workflows) draw and scroll to their last row. Repeat at 120 by 40.
140. Start the terminal client with `ACORN_TUI_NOTIFY=bell`, then with no value, and open
     **Settings > General > Notifications**. Confirm that **Terminal alerts** says **Bell only** and
     **From ACORN_TUI_NOTIFY**, then **Bell and terminal notification** and **The default**. In a
     terminal acorn has no notification sequence for (Apple Terminal), confirm that the row says only
     the bell reaches you. Turn **An agent needs me** off and confirm that the change survives a
     restart, then press **Send a test** and confirm that the terminal rings.
141. In the terminal client, add an MCP server or a custom agent, type into its form, and press Escape.
     Confirm that **Discard unsaved changes?** opens with the caret on **Cancel**, that Cancel keeps
     the typed value, and that **Discard changes** returns to the list. Save one, then remove it from
     its danger zone, and confirm that the confirmation names what goes and that the list no longer
     shows it.

The following checks cover [mcp.md](./mcp.md) § Your own servers. The store, routes, runtime,
drivers, handoff flags, and test button have automated coverage in `plugins/agents`; these checks cover
the real harnesses and the window.

142. In Settings → MCP servers, add a stdio server with one secret environment variable and press
     **Test**. The tools are listed. Edit it, leave the secret empty, save, and test again: it still
     connects.
143. Open a Claude Code session and a Codex session, and ask each to call one of the server's tools.
     Type `/mcp` in each composer: the panel opens and nothing is sent. Codex lists every server it has
     with a status. Switch the server off, apply, and confirm that the transcript notes the restart and
     that the agent no longer has the tool while the conversation continues.
144. Continue each session in a terminal and run `/mcp` there. The server is listed. While the terminal
     runs, `ps -axww` shows the server's command but never its secret value.

One known appearance bug is recorded here so it is decided rather than slipped into an unrelated
diff: `:root:not([data-theme="light"])` under `prefers-color-scheme: dark` has the same specificity as
a named theme block and sets `--is-dark: 1`, so with the OS in dark mode the light-palette themes
`solarized-light` and `catppuccin-latte` tell xterm and CodeMirror they are dark while rendering light.
The fix is two lines and changes shipped visual behaviour for users of those two themes; it belongs
in its own change with its own note.

The dashboards backlog keeps its own once-only verification pass in
[docs/future/dashboards/README.md](./future/dashboards/README.md) § 0, because its items gate that
folder's remaining work rather than a release.

Workflow-v2 dashboard checks are split by owner:
`packages/dashboards-core/src/typedProjection.test.ts` covers nested projection and independent exact-status mappings;
`packages/node-core/src/server/dashboards/*.test.ts`
uses migrated temporary SQLite stores for revision and publication behavior; and
`packages/client-core/src/features/dashboards/dashboardEditorModel.test.ts` plus `dashboardRecovery.test.ts`
cover local display semantics and device recovery. Real-window checks still exercise the composed
editor and placement because those interactions are not proved by pure tests.

A normal worktree development run may need the main checkout's `.env`, and an existing development
instance may own the renderer's fixed port, 4319. `pnpm dev:agent` uses isolated data and ports for
real-window checks from a worktree.
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
