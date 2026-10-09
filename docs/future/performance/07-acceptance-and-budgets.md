# Phase 07: Verify performance, packaged behaviour, and Sentry delivery

Date: October 9, 2026. Status: planned. Depends on: phases 01 to 06.
Source baseline: `989b069c389df6143b90ffb9889dfeaae5db6010`.

Review the combined implementation and record comparable before-and-after evidence. Complete this
phase only when the actual installation, loading transitions, and Sentry records have been checked.

## Review and budgets

Read the phase 01 baseline and all implemented diffs. Recheck owners, asynchronous cleanup,
registration ordering, persisted-state protection, and extracted-installation dependencies.

Keep three independent measurements: first-frame graph bytes, required registration/restore work,
and total shipped bytes. A dynamic import cannot hide mandatory pre-usability work from the report.
Keep source-module denylists and stale-graph checks alongside byte ceilings. Do not convert the
500 KB Vite warning into an app-size limit or compare compressed bytes to an uncompressed ceiling.

Set ceilings from measured production builds with a documented allowance. Budget changes need an
attributed reason and before-and-after report. Recheck the renderer and terminal values in
[startup budgets](../../frontend/startup-budget.md); their dated prose can lag the scripts.
Record measurements and changes by release in CI artifacts so growth is attributable.

## Repository and artifact gates

Run these gates, recording the checkout and environment:

1. `pnpm lint` and `pnpm --filter @acorn/arch-tests test` must pass.
2. Run changed package and consumer suites, then `pnpm test`. Use the capped repository script.
3. Run `pnpm --filter @acorn/desktop build` and `pnpm --filter @acorn/tui build`. Startup graph,
   denied-module, runtime-syntax, and generated size-report checks must pass.
4. Build the desktop distribution with `pnpm --filter @acorn/desktop dist` on a matching runner and
   run `pnpm --filter @acorn/desktop verify:bundle`. Apply the release's signing gates separately;
   this programme does not waive them.
5. Produce the standalone archive with `pnpm pack:node`, extract outside the checkout, and follow
   the generated dependency installation policy. Exercise the CLI, TUI, Node, and loaded plugins.
6. Compare staged, installed, and compressed artifact inventories on each supported release target.
   Confirm the SDK fallback executable is absent and required native runtime assets still load.

Investigate failures attributable to this programme. Report unrelated baseline failures separately;
do not change unrelated code or claim a failing required gate passed.

## Real-host matrix

Run desktop sessions with `pnpm dev:agent -- --session performance-acceptance`; use a separate fresh
session and a reused session. Use `pnpm dev:agent:ui -- --session performance-acceptance snapshot`
and the returned references for actions and screenshots. Stop every session after collecting evidence.
Use installed artifacts for installation claims, not only the agent development session.

Cover these cases:

| Case | Required evidence |
| --- | --- |
| Fresh data root and onboarding | Correct stage messages, one wizard, usable first-run actions, and no empty gate. |
| Established root and saved task | Hydrated destination/layouts, retained drafts, and visible restored-content loading. |
| Slow or rejected lazy loading | Local placeholders, actionable failure, successful retry, and no duplicate registrations. |
| Node changes and offline remote Node | Correct cache partition, retired requests/workers, and no false local-starting message. |
| First and repeated feature opening | Agent, Editor, Changes, Settings, GitHub, and loaded plugin timings with declared readiness coverage. |
| Installed Claude present or absent | Create/resume/hooks/skills work, or the launch explains the prerequisite; the app still opens. |
| Established Node restart | Agent/workflow recovery and scheduled work do not depend on opening a view. |
| Terminal client | Shared changes preserve navigation, loading, and runtime dependency resolution. |

Repeat comparable visible launches at least 10 times per cold/warm case on the same machine and
build mode. State the method used to call a launch cold; a process restart does not clear the OS
file cache. Report median and observed tail values with sample count. Keep hidden-window observations
separate and avoid claiming stable p95 estimates from small samples.

## Sentry acceptance

Connect a designated test project through Settings and enable the relevant telemetry categories.
Reuse the established sink; do not add direct renderer uploads or bypass user consent.

Confirm startup milestones, feature-opening transactions, graph bytes, and installed component
bytes appear with correct units, release, platform, and architecture. Verify first versus repeated
opening, cached/offline outcomes, and stage failures can be queried. Show example queries or dashboard
instructions for usable-startup duration, first-opening latency, and byte growth by release.

Check trace sampling, unit conversion, rate-limit/retry behaviour, and queue bounds through the
existing exporter tests. Confirm no paths, prompts, file content, credentials, or user/workspace
identifiers were added as performance labels. Turn telemetry off and disconnect the DSN; subsequent
attempts and queued retries must respect those changes.

A mocked envelope is not live Sentry evidence. If no test DSN is supplied, record that gap and keep
this phase incomplete while handing off the completed local checks. If Sentry rejects the metric
category, investigate its supported ingestion format instead of silently reporting only local bytes.

## Handoff

Create dated evidence under Testing and index it in `docs/README.md`. Record source revision,
hardware, target, runtime/Claude versions, first-frame and usable timings, first feature openings,
inventory reports, screenshots, gate results, Sentry queries, and remaining limits.

Update the owning references for shipped behaviour, phase statuses, and this programme's table.
Keep implementation notes discoverable without requiring the original chat. Do not claim smaller
JavaScript proves lower memory use, faster startup, or a smaller compressed installer unless the
corresponding measurement supports it.
