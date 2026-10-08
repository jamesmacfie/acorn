# Phase 01: Measure startup, feature opening, and shipped bytes

Date: October 9, 2026. Status: planned. Depends on: none.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Implement this phase before evaluating optimizations. It defines comparable milestones and exports
bounded numeric records through Acorn's telemetry pipeline to the bundled Sentry sink.

## Starting point and owners

`apps/desktop/src/client/boot.ts` stores local performance marks and emits `renderer.boot` only
through `nodeReady`. That endpoint does not cover restoration or the first useful feature content.
`apps/desktop/src/client/index.tsx` records a requestAnimationFrame callback as first paint; occluded
macOS windows can suspend that callback.

`packages/client-core/src/infra/persistence/appStartup.ts` and
`packages/client-core/src/infra/persistence/startupRestore.ts` own restoration and persistence arming.
`packages/client-core/src/host/registries/panes/panes.ts` measures region mounts, which can precede
usable data. `packages/client-core/src/infra/telemetry/emitter.ts` owns client emission.

`apps/desktop/scripts/check-renderer-budget.mjs`, `apps/node/scripts/measure-service-graph.mjs`,
and `apps/tui/scripts/check-startup-graph.mjs` measure startup graphs.
`apps/desktop/scripts/bundle-inventory.mjs` verifies packaged resources but does not report size.
`plugins/sentry-telemetry/src/server/envelope.ts` converts records; its exporter owns consent,
sampling, retries, and queue bounds. Use these owners instead of adding a Sentry SDK to the renderer.

## Measurement contract

Use stable names and bounded labels. Keep timings in milliseconds and sizes in bytes:

| Record | Definition |
| --- | --- |
| `renderer.startup.first_frame` | Navigation to the first visible startup frame. Label a frame callback as a proxy when paint observation is unavailable. |
| `renderer.startup.restored` | Navigation to completed initial state hydration and destination selection. |
| `renderer.startup.usable` | Navigation to the restored destination's first usable content, or an actionable empty, offline, or error state. |
| `ui.feature.open` | Opening intent to the feature's first usable state; one span per opening. Label the first opening in this document separately. |
| `app.bundle.bytes` | Resource or runtime component bytes, with artifact kind, component, release, platform, architecture, and measurement method. |
| `app.startup.bytes` | Built startup closure bytes, with runtime and build mode; report post-frame registration separately. |

Keep `renderer.boot`'s documented endpoint compatible. Add explicit milestone records and phase
children rather than silently redefining an established span. Define first opening by stable feature
ID and document lifetime, not task ID. Module-cache warmth and query-cache warmth are separate facts.

Usable content is neither an import resolving nor an arbitrary number of animation frames. Register
an explicit completion signal from the visible feature owner. A cached list, completed empty result,
editable document, or recoverable error qualifies. A spinner does not. For restored destinations,
wait for all visible required regions; hidden panes and optional enrichment do not hold the milestone.
Label any mount-only measurement as a proxy until that feature supplies its completion signal.

## Implementation

1. Capture release, checkout, runtime, platform, visibility, graph bytes, and repeated cold and warm
   timings using [profiling](../../local-development/profiling.md). Include fresh and established
   data roots. Publish a dated baseline in Testing without private paths or data.
2. Add a small milestone owner beside the desktop boot account. Use the monotonic navigation clock,
   preserve trace relationships, and emit each startup milestone at most once. Record hidden or
   occluded startup separately; the 250 ms roster fallback is not proof of a visible paint.
3. Add feature completion hooks at host-owned pane/source/settings boundaries. Instrument the restored
   destination and representative Agent, Editor, Changes, and Settings openings. Declare coverage and
   use bounded pending records; do not retain a per-task timing map. Later phases extend these hooks.
4. Produce a versioned JSON size report from build graphs and staged inventories. Separate startup,
   registration, total JavaScript, runtime dependencies, native runtime, installed bytes, and compressed
   release artifacts. Count files once and name the method, excluded metadata, and missing components.
5. Supply immutable build measurements to runtime telemetry. Measure installed component bytes once,
   asynchronously after usability, from known app-owned resource roots. Bound traversal, avoid symlink
   escapes, exclude data roots and repositories, and label development or incomplete installations.
   Final signed installer sizes belong in CI's report; correlate by release and do not invent them at
   runtime or embed a self-referential final archive size.
6. Verify the Sentry conversion of milestone spans and byte metrics. Preserve release/environment,
   units, first-opening labels, and trace sampling. Preserve the prior millisecond timestamps through
   delayed export. Keep failure outcomes visible through the established error records.

Only local numeric marks may precede resolution of the telemetry preference. Do not export without
consent. Discard pending exports when disabled; keep no persistent telemetry backlog. Scope pending
startup records to the mounted Node so switching Nodes cannot export the previous Node's account.
Respect [telemetry limits](../../telemetry/model.md) and the sink's category controls.

## Verification and completion

Add behavioural coverage beside the owning modules for one-time completion, delayed consent,
disablement, Node switching, hidden windows, empty/offline states, first versus repeated opening,
and pending-record bounds. Inventory fixtures must detect double counting, missing components,
symlink escape, and stale graph metadata. Sentry tests must verify envelope units and attributes.

Run `pnpm lint`, `pnpm test --filter=@acorn/client-core`, `pnpm test --filter=@acorn/plugin-sentry-telemetry`,
`pnpm --filter @acorn/desktop test`, and `pnpm --filter @acorn/arch-tests test`. All must pass for changed
owners and consumers. Run `pnpm --filter @acorn/tui build` to check shared telemetry imports remain lazy.

Completion requires readable local reports and test-endpoint Sentry envelopes for every contract row.
Phase 07 owns live-project acceptance. Update the telemetry reference and profiling instructions with
definitions, coverage, and query recipes for startup percentiles and bytes by release.

## Recheck before implementation

Inspect the collector and sink's units and sampling before choosing additional exporter code.
If a feature cannot report data readiness, document proxy coverage instead of labelling it usable.
If a live DSN is unavailable, finish local and envelope verification and record the live gap explicitly.
