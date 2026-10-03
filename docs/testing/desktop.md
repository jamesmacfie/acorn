# Desktop and large-surface tests

This page covers the tests that need the desktop shell or a large generated fixture: the boot test,
the Rust unit tests, the browser smoke test, and the large-surface fixture with its suites. Read it
before you change the shell's startup, a webview policy, or how a diff or transcript renders.

## The desktop boot test

`apps/desktop/test/boot.test.ts` checks that the shell can load its world. It runs the staged helper
under the bundled Node against a fresh data root, with host executables removed from `PATH`, so
first-run certificate creation can't depend on OpenSSL. The helper spawns the real `service.js` over
the service protocol.

The test asks the two questions the renderer asks first: which Nodes exist, and can a `/v1` request
reach one. A 200 from `/v1/node` means the pinned TLS connection came up and the device token
authenticated, so one assertion covers custody end to end. Two more check the gate: a socket without
the secret is refused, and a plain HTTP request gets 426.

The test prints how long the Node took to start, from the helper's ready line to its `service.start`
mark. That span covers spawning the Node, evaluating the service bundle, and booting to a bound
listener. It fails above 10,000 ms on Windows and 1,500 ms on other hosts. On October 1, 2026, it
measured about 270 ms on an M2 Pro and 2,705 to 5,126 ms on Windows CI. Compare the printed number
between builds on the same host.

The desktop test command runs the boot test in its own Vitest run after the unit suites, so their Git,
database, and transform work doesn't compete with the measured startup. Run
`pnpm --filter @acorn/desktop test:boot` to run it against staged files. Windows installer
verification runs it against installed resources.

## The Rust unit tests

The Rust tests in `apps/desktop/src-tauri/src/` cover what a headless helper run can't reach:

- The renderer CSP, and the development-only widening a packaged build must not carry.
- The traversal guard and the highlighter worker's separate policy.
- The refusal to answer a Node route with the shell's own HTML.
- Handshake and ready-line parsing.
- The data key's shape and its file fallback.
- The plugin scheme's hash grammar and frame CSP.
- The webview URL policies and the key grammar that picks between them.
- Navigation history, the capability file's webview scoping, and three packaging properties in
  `tauri.conf.json`.

[Continuous integration](./ci.md) says which workflows run these and the boot test.

No headless run reaches compositing. A child webview over a window needs a window, so the release
pass in the [smoke checklist](./smoke-checklist.md) checks it.

`pnpm dev:agent:smoke` is the first real-window step on a graphical host. It starts an isolated
automation build with a fresh data root, reads the onboarding screen through the embedded WebDriver
server, clicks into the project step, takes a screenshot, and stops. [Agent drivers](../local-development/agent-drivers.md)
documents `pnpm dev:agent` for longer sessions.

## The browser smoke test

`plugins/browser/src/server/driver.smoke.test.ts` runs an agent's loop against a real Chrome. It loads
a loopback page, takes a snapshot, fills a field and clicks a button by reference, and reads back the
console line the page logged. Run it with `pnpm --filter @acorn/plugin-browser test:smoke`. It isn't
part of `pnpm test`, because launching a browser is slow. On a machine with no Chrome, it checks
that the tools report why.

## The large-surface fixture

Large diffs and long transcripts are tested against one fixture, generated from a seed at run time,
so nothing a million lines long is checked in. It has three profiles. The counts are for seed 1:

| Profile | Files | Fixed rows | Threads and notes | Agent session | Use |
| --- | ---: | ---: | ---: | --- | --- |
| `small` | 22 | 9,048 | 20 each | 19 turns, 280 events, about 135 cards | Fast tests and a quick real-window run |
| `scale` | 220 | 104,234 | 100 each | 94 turns, 1,384 events, about 670 cards | Scaling comparisons |
| `canonical` | 2,200 | 1,077,852 | 400 each | 476 turns, 7,012 events, about 3,400 cards | Real-engine acceptance and profiling |

Two generators own the data:

- `packages/client-core/src/testkit/largeDiff.ts`, exported as `@acorn/client-core/testkit/large-diff`,
  streams files one at a time. Each carries both sides, the patch, threads, and review notes. The
  files include very large, binary, renamed, added, and removed files, tabs, long lines, many hunks,
  and text repeated across files. `largeDiffSource` turns them into a `DiffSource` for the real
  `DiffPane`. It cuts patches with `@acorn/diff-document` the way a provider's Node does, and it can
  record or hold back each segment request.
- `plugins/agents/src/testkit/largeSession.ts` writes the session's turns through the plugin's own
  store, the way an imported transcript is written. The session ends stopped with every request
  resolved, so a booting Node has nothing to recover.

The `tui-navigation` variant adds a second task and a second workspace to the same data. Both agent
launchers accept `--fixture tui-navigation --profile small|scale|canonical --seed N`. Run the terminal
`navigation` flow and the desktop `tui-navigation` flow with the same profile and seed. Their reports
capture visible text at matching checkpoints. They don't assert pixel parity.

These tests hold the fixture to its contract:

- `largeDiff.test.ts` pins the small profile's digest, checks row counts, thread and note placement,
  and segment counts, and streams the canonical profile to check its size.
- `largeSession.test.ts` seeds a session, reads it back page by page, and projects it into cards.
- `plugins/changes/src/testkit/reviewNotes.test.ts` checks that seeded notes are the rows the route
  returns.
- `kit/lib/telemetry/surfaceHealth.test.ts` covers the health registry and its privacy rule.
- `apps/desktop/scripts/agent/flow.test.mjs` refuses a flow with an unknown action, a script, an
  unbounded loop, or no assertions.

## Large-surface suites

These suites are under `packages/client-core/src/` unless the path says otherwise.

- **The diff document.** `packages/diff-document/src/segment.test.ts` holds the segmenter to its rules
  over a generated corpus: rows kept in order, stable cuts, both limits honored, and keys that follow
  the patch. `search.test.ts` pages across files. `plugins/changes/src/server/routes/localGit.test.ts`
  runs the Changes document over a real tree.
- **The diff pane.** `features/diff/DiffPane.test.tsx` renders the real pane over the fixture with the
  jsdom layout model in `features/diff/layout.helper.ts`. That helper models a `ResizeObserver`, block
  heights, and a `scrollTop` that clamps like a browser's.
- **Block geometry.** `kit/diff/layoutIndex.test.ts` holds a million rows in 400 blocks through 2,000
  random resizes and checks them against a slow reference. `kit/diff/measureScheduler.test.ts` checks
  one read batch and one commit per frame. `features/diff/diffLayout.test.tsx` checks that the
  reader's row stays put when content above it changes size.
- **The segment cache.** `features/diff/segmentCache.test.ts` covers weights, eviction order, and
  ceilings. `features/diff/segmentLoader.test.tsx` runs the loader with no spare room.
  `infra/node/fleet.test.ts` checks that `dropNode` clears only that Node's segments.
- **Long timelines.** `kit/lib/timeline/timelineWindow.test.tsx` holds the window's paging rules.
  `kit/components/content/Timeline.test.tsx` checks **Show earlier**, trimming, and deferred bodies.
  `plugins/agents/src/client/sessions/AgentTranscript.test.tsx` opens a 1,000-card session.
  `plugins/github/src/client/pullDetail/Conversation.test.tsx` and `features/diff/diffSnippets.test.tsx`
  check that thread snippets load only their own segment.
- **The GitHub mirror.** `plugins/github/src/server/routes/mirror/fakeGithub.helper.ts` paginates the
  way GitHub documents: 100 nodes a page and a 3,000-file cap. `prFetch.test.ts` checks requests,
  cursors, and completeness, and fails on repeated cursors and partial errors. `prMirror.test.ts` runs
  against a migrated `github.sqlite` and checks that a failed page leaves every old row unchanged.

The real-window run is the large-surface flow in [agent drivers](../local-development/agent-drivers.md#large-surface-flow).
It isn't part of `pnpm test`, because it needs a visible window and minutes of rendering. It checks
invariants that don't depend on the machine: no blank block in a settled viewport, at most one
geometry commit per frame, mounted rows under a fixed ceiling, the transcript under 400 turns, and
teardown back to zero. It records timings and resident bytes without failing on them. A visible run
at `scale` and at `canonical` against the segmented document hasn't been recorded. Run it on the
release host and keep both JSON reports.
