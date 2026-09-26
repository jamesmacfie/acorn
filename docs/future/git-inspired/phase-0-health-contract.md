# Phase 0: health contract, fixtures, and unattended reproduction

Status: not started, 2026-09-26. Waits on nothing.

## Goal

Make large-surface behavior observable and reproducible before changing it. The desktop can open a
deterministic fixture with 2,200 files, at least 1,000,000 fixed diff rows, 400 dynamic blocks, and a
long timeline without GitHub credentials. A declarative flow drives cold and warm opens, deep
scrolling, resizing, mode changes, disclosures, composers, and teardown in the real Tauri window.
The diff and Timeline publish permanent numeric health signals that the flow can assert later.

This phase records the current baseline. It does not claim the current renderer passes the later
budgets.

## Why first

The failures in this programme depend on data size, WebKit layout, scroll position, and timing.
Component snapshots and hand-timed runs cannot prove that measurement is viewport-bound, observers
tear down, or a correction retained the same row. Later phases need a stable fixture and the same
signals before and after each change.

Acorn already has most of the driver: `pnpm dev:agent`, an isolated data root, WebDriver snapshots,
scrolling, clicking, filling, screenshots, and arbitrary read-only JavaScript execution. It also has
renderer telemetry and performance-timeline spans. This phase extends those seams rather than adding
a second automation stack.

## Scope

In:

- A generated large-diff source used only by test and agent-automation builds. It goes through the
  real shared `DiffPane` and supplies source-owned threads and line extras.
- A generated long managed-agent session, so the real `AgentTranscript` and `Timeline` are exercised.
- Small, medium, and canonical deterministic profiles. The canonical profile matches the GitHub
  article's order of magnitude; smaller profiles make scaling assertions practical in CI.
- Permanent numeric probes for diff topology, mounted work, queues, measurement, correction,
  observers, coverage, cache weight, and Timeline construction.
- A bounded health snapshot on the existing renderer performance-timeline diagnostic path and
  equivalent privacy-safe telemetry samples.
- A declarative large-surface flow runner under `apps/desktop/scripts/agent/`.
- A dated baseline report emitted by the runner as JSON and a short human-readable summary.

Out:

- Pagination and mirror changes (phase 1).
- Segment loading, geometry, caching, or timeline windowing (phases 2 to 5).
- A production fixture route or a global diagnostic containing source, paths, comments, or
  transcript text.
- Timing gates copied from another machine. This phase gathers the Acorn baseline first.

## Fixture design

### Profiles

Use a deterministic seed and generate content at run time. Do not check in a million-line patch.

| Profile | Files | Fixed rows | Dynamic blocks | Timeline projection | Use |
| --- | ---: | ---: | ---: | ---: | --- |
| `small` | 22 | about 10,000 | 20 | about 120 cards | Fast behavior tests |
| `scale` | 220 | about 100,000 | 100 | about 600 cards | CI scaling comparison |
| `canonical` | 2,200 | at least 1,000,000 | 400 | at least 1,200 cards from a 7,000-event session | Real-engine acceptance and profiling |

The generator must include:

- many small files and several very large files,
- additions, deletions, unchanged context, multiple hunks, gaps, renamed files, binary/no-patch
  files, tabs, and individual very long lines,
- threads on both old and new sides, resolved and unresolved states, multiple comments, Markdown,
  images with delayed dimensions, `<details>`, suggested-change-like code, and reply composers,
- source line extras that appear, resize, and disappear,
- anchors near segment, file, and document boundaries,
- duplicate-looking hunk text and line content, so identity cannot accidentally depend on display
  text or array position,
- a transcript with streaming messages, folded and open tools, requests, code blocks, subagents, and
  a target near the oldest retained turn.

The large diff should be a fixture implementation of the published source port, placed in an
existing testkit or `__fixtures__/` owner. It is registered only when the isolated agent session asks
for `--fixture large-surfaces`. Production bundle registration must not make the fixture reachable.
Use a generated local Git repository as a secondary Changes smoke if useful, but do not make a
million-line repository a prerequisite for every fixture run.

The Agent fixture should seed through the Agents plugin's own database/testkit contract, after its
migrations, rather than write core tables that happen to resemble the current schema. The task,
session, turn, event, and request relationships must be real enough that `loadSnapshot()` performs
the same paged walk as a production session.

### Agent commands

The intended operator flow is:

```sh
pnpm dev:agent -- --session large-surfaces --fixture large-surfaces
pnpm dev:agent:ui -- --session large-surfaces flow large-surfaces
pnpm dev:agent:ui -- --session large-surfaces stop
```

`session.mjs` owns fixture selection and records the fixture name and seed in its manifest. `ui.mjs`
owns the `flow` verb. The flow file is data: named actions, targets, fractions, and assertions. It
does not embed arbitrary JavaScript strings. The WebDriver client may gain narrow methods for window
size, scroll fraction, performance entries, and health snapshots.

## Permanent health model

Add one client-core registry for rendered-surface health. A surface registers on mount, updates
numeric counters, and unregisters on cleanup. A snapshot contains fixed fields and fixed enum labels:

```ts
type RenderedSurfaceHealth = {
  kind: 'diff' | 'timeline'
  topology: { files: number; fixedRows: number; dynamicBlocks: number; ready: boolean; lateSourceBlocks: number }
  mounted: { segments: number; fixedRows: number; dynamicBlocks: number; blankBlocks: number; uncoveredRanges: number }
  work: { queuedSegments: number; queuedEnrichment: number; furthestQueueDistance: number }
  measurement: { candidates: number; reads: number; commits: number; maxCommitsInFrame: number; activeObservers: number }
  correction: { count: number; maxPixels: number; maxAnchorDrift: number }
  resident: { documents: number; segments: number; rows: number; estimatedBytes: number }
}
```

The exact TypeScript owner and field grouping may change during implementation. The semantic rules
may not:

- Counts describe the currently mounted surface or the most recent completed pass. They never carry
  file paths, row text, comment bodies, thread IDs, task IDs, session IDs, or search terms.
- A mounted block is blank when its container is visible and has neither skeleton nor content. An
  uncovered range is visible document space not owned by a fixed row, dynamic block, or explicit
  loading placeholder.
- `lateSourceBlocks` counts only source-owned topology inserted after `ready`. New user composers and
  optional extension annotations have their own fixed reasons and do not falsify that invariant.
- Observer counts increment at construction and decrement at disconnect, so teardown can be
  asserted without relying on garbage collection.
- Anchor drift compares the stable identity and intra-item offset captured before a correction with
  the resolved place after it. A missing identity is a failed correction, not zero drift.
- Queue distance is measured in segments or pixels from the active prefetch range, not by path.

Reuse the existing telemetry emitter for histograms and events. Reuse the existing
`acorn:*` performance-timeline diagnostic path for the exact bounded snapshot read by WebDriver.
Keep only a short ring or the latest snapshot so a long loop cannot grow the performance timeline.
Do not add a content-bearing `window` global or a production HTTP diagnostics route.

## Flow and assertions

The canonical flow performs these stages and records a health checkpoint after each:

1. **Cold diff:** open the fixture, wait for topology-ready and the first nonblank rows, and capture
   the first interactive checkpoint.
2. **Deep sweep:** visit at least 0%, 10%, 25%, 50%, 75%, 90%, and 100% of the scroll range in both
   directions. At each stop, wait for the range to settle and assert content coverage.
3. **Dynamic content:** open and close a visible disclosure, open and type into a reply composer,
   resolve or collapse a thread, and complete a delayed image size. Capture correction and commit
   counts.
4. **Layout:** resize narrow and wide, toggle the file navigator if present, collapse and expand a
   file, switch unified to split and back, and jump to a named file and line.
5. **Warm revisit:** switch to another pane and back. Record time to first content and resident-cache
   state, even before phase 4 adds cache hits.
6. **Timeline:** open the long agent session, select text in an older stable card, allow a streamed
   update, use top/bottom controls, reveal the old target, toggle disclosures, and switch away/back.
7. **Teardown:** leave both surfaces and assert that mounted counts, observers, scheduled frames, and
   pending offscreen renders return to baseline.

The runner waits on stated health conditions and animation frames. It does not use long fixed sleeps
as evidence that work probably finished.

## Budgets

Phase 0 adds invariant checks that are machine-independent:

- mounted counts and active observers are within a fixed additive band between `scale` and
  `canonical`, rather than multiplying with ten times the topology,
- `maxCommitsInFrame <= 1`,
- source-owned late topology is zero after ready,
- teardown returns lifecycle counts to baseline,
- every settled viewport has zero blank blocks and zero uncovered ranges.

It records, but does not yet gate, first-content latency, frame gaps, measurement duration, parse
duration, resident bytes, and correction pixels. The phase report includes hardware, OS, WebKit,
build mode, fixture seed, and cold/warm status. Each later phase converts the measures it owns into a
budget after it has a before-and-after result. CI may use generous absolute backstops for hangs, but
those are test timeouts, not product performance claims.

## Code touched

- `packages/client-core/src/infra/telemetry/` or a neighboring diagnostics owner: the bounded surface
  health registry and performance-timeline snapshot.
- `packages/client-core/src/features/diff/`: diff probe registration and counters.
- `packages/client-core/src/kit/components/content/Timeline.tsx`: Timeline lifecycle counters only.
- `plugins/agents/src/client/sessions/AgentTranscript.tsx`: projected and mounted-card counters.
- `packages/plugin-api/src/testkit/` or the nearest existing fixture owner: generated diff source.
- `plugins/agents/src/testkit/` or an Agents-owned fixture helper: generated session ledger.
- `apps/desktop/scripts/agent/session.mjs`: `--fixture` selection and manifest fields.
- `apps/desktop/scripts/agent/ui.mjs`, `webdriver.mjs`, and a data-only flows folder: the runner and
  narrow controls.
- Focused tests beside each new module; no standalone diagnostics application.

## Tests

- Registry test: register, update, snapshot, unregister; two mounted surfaces do not overwrite one
  another; a disposed surface contributes nothing.
- Privacy test: the health snapshot schema accepts numbers and fixed enums only. Feed fixtures whose
  paths and bodies contain canary strings and assert the serialized snapshot contains none.
- Diff probe test: mounted rows and observers rise and return to zero; source blocks added after
  ready increment only the source-owned counter.
- Timeline probe test: projected and mounted counts are distinct and cleanup is exact.
- Fixture determinism test: a seed produces the same topology, identities, row counts, anchors, and
  content digests without retaining the full canonical document in the assertion.
- WebDriver test: flow parsing rejects unknown actions, unbounded loops, scripts, and missing
  assertions.
- Small profile real-window smoke in the desktop test lane.
- `scale` versus `canonical` real-window acceptance on the graphical host used for release
  verification. Store the JSON reports as CI artifacts when that host is available.

## Docs owed

Per [docs-migration.md](./docs-migration.md): `docs/telemetry.md`, `docs/testing.md`, and
`docs/local-development.md`.

## Done when

- The three commands above can create, drive, and stop an isolated fixture session without GitHub
  login or hand interaction.
- The canonical report identifies the first-content, whole-document preparation, measurement,
  correction, resident-memory, and timeline-construction costs separately.
- Scaling and lifecycle invariants are machine-asserted; time and memory values are recorded with
  their environment and are not presented as universal budgets.
- The fixture produces at least one known unhealthy current behavior, or the report contains the
  evidence that the current implementation already passes that particular invariant.
- `pnpm lint`, the focused client-core, Agents, and desktop automation suites, and `pnpm test` pass.

## Verify before building

- `apps/desktop/scripts/agent/seed.ts` still creates only a project and does not migrate or seed
  plugin-owned fixture data.
- `apps/desktop/scripts/agent/ui.mjs` still supports only snapshot, click, fill, scroll, screenshot,
  status, and stop; inspect `webdriver.mjs` before adding duplicate controls.
- `docs/local-development.md` still requires a visible real window because WebKit pauses animation
  frames while occluded.
- `packages/client-core/src/infra/telemetry/emitter.ts` still owns renderer samples and the
  performance-timeline diagnostic switch.
- `packages/client-core/src/features/diff/DiffPane.test.tsx` still uses 200 files and
  `apps/tui/src/diffLong.test.tsx` still uses a 5,000-line fixture; neither is the canonical desktop
  stress case.
- `plugins/agents/src/client/sessions/managedStore.ts` and its testkit remain the owner of snapshot
  relationships; do not seed an imitation in core.
