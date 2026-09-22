# Context and coverage

Date: 2026-09-21. Status: analysis complete; proposed changes not implemented.
Evidence baseline: `9727fd85`. Start with the [programme](./README.md).

## Goal and constraints

Make Acorn understandable through clear ownership, typed communication, consistent names, and fewer
representations. The output is a developer handoff, not an application refactor. The user approved
discarding all Acorn-owned state and resetting Acorn-owned contracts to version 1. Source repositories,
worktree files, external provider state, and unrelated files remain protected.

Challenge architectural choices with evidence. Do not assume every abstraction is excessive or every
fallback is historical. Preserve behaviour that serves a present failure mode, optional plugin, or
external protocol. No new branch, application edits, migrations, or real-state reset are part of this review.

Research used the documentation index, architecture and extensibility references, package inventory,
plugin activation/configuration scans, dependency and compatibility searches, and targeted source traces.
One sequential subagent investigated Findings/Memory; the main review covered the other boundaries.
Coverage is an entry-point and contract review across the repository, with deeper inspection of the
findings below. It is not a claim to have read every implementation or exercised every feature.

## Runtime ownership and data flows

| Boundary | Source to consumer | Intended owner and finding |
| --- | --- | --- |
| Desktop request | Solid UI → platform transport → Rust bridge/helper → custody broker → authenticated Node route → core/plugin service → SQLite or external operation → response → node-scoped cache → UI. | Preserve transport/custody separation. Plugin session routes are an exception to correct in F05. |
| Terminal request | Shared client UI → terminal platform adapter → in-process custody → the same Node API. | Preserve the module boundary even though custody and presentation share a process. |
| Loaded plugin | Installed manifest → validation/permissions → worker → scoped context → registered contributions → authenticated routes/events → host-rendered descriptor/tree or frame. | Preserve the worker and permission boundary; make descriptor and RPC contracts explicit in F08. |
| Task context | Core task/link data + plugin section contributors → bounded section assembly → context route → Context pane and agent consumers. | Canonical sections coexist with named compatibility fields; F03 removes the second projection. |
| Review proposals | Memory agent tool → JSON proposal store → Findings startup importer → review candidate → approved Memory filesystem write + durable receipt. | Replace the live JSON producer before deleting import machinery; F01. |
| Completion capture | Agents event/read contract → Findings; terminal/workflow callbacks → composition → Findings or Memory fallback. | One feature uses a plugin contract; the others embed feature policy in composition; F02. |
| Workflow execution | Definition/draft → published frozen graph → run/step/dispatch records → admission ledger → agent/tools/child tasks → run projections. | Retain durable admission and recovery. Remove cost fallback and move workflow-owned forms/types; F04/F06. |
| External items | Provider connection → provider-specific codec/resource → core item projection → tasks, sources, and context. | Keep the shared item index and credential custody; do not move provider parsing into core. |

Findings and Memory changed after the baseline. The rows above still hold: composition still owns the
callbacks and the legacy proposal store still has a live producer. Two things narrowed. The task
archive is the only boundary that schedules preparation, and core now awaits that capture before
teardown. Memory supplies its own generation instructions to Findings. See F01 and F02 for what is
left.

Useful source anchors are `apps/node/src/composition/runtime.ts`,
`packages/custody/src/broker/nodeBroker.ts`, `packages/client-core/src/infra/node/apiClient.ts`,
`packages/node-core/src/server/pluginHost/context.ts`, and
`packages/node-core/src/server/plugins/isolation.ts`. The same storage and service graph boots for
standalone and supervised Nodes. The application root may select plugins and inject runtime handles;
it should not decide which feature reviews an agent turn.

## Package coverage

| Packages/runtime | Disposition |
| --- | --- |
| Node application | Keep composition and boot/drain ordering; remove feature fallback policy, F02. |
| Desktop application and Rust shell | Keep shell custody/native operations; remove Electron credential adoption and legacy shortcuts, F07. |
| Terminal application | Keep its renderer and in-process custody; include file caches and node-path selection in reset. Large focus/navigation modules merit focused separation, F12. |
| node-core | Keep shared entities, auth, scheduler, registries, and storage facilities; remove compatibility projections and credential alias, F03/F09. |
| client-core | Keep host rendering, kit, navigation, cache, and notification delivery; move plugin adapters/forms/state, F04/F05. |
| protocol | Keep cross-runtime host contracts; split mixed plugin/core vocabulary, F04. |
| custody | Keep broker, pins, trust, supervision, and bundle cache; remove legacy adoption, F07. |
| dashboards-core | Keep pure shared shaping: Node sampling and client rendering are two real consumers. |
| plugin-api | Keep re-export-only facade and tier separation; update exports after ownership changes. |
| plugin-types / plugin-sdk | Keep independently consumable declarations/helpers and parity tests; tighten published portable shapes and RPC coverage, F08. |
| create-acorn-plugin | Update generated manifests/examples and description to the tree-first model, F11/F12. |

## Plugin coverage

The activation/configuration scan covered all 23 plugin packages. Retain means no additional
architectural rewrite is justified by this review, not that every function has been certified.

| Plugin | Contract/ownership disposition |
| --- | --- |
| agent-cost | Retain remote-tree session-header contribution; consume plugin-owned agent contracts. |
| agents | Retain native driver/ledger; move its attention adapter/types out of core and remove fallback completion callback. |
| browser | Retain Node-owned Playwright and bounded tools; reset its database baseline. |
| changes | Retain diff/check contributions; consume agent-owned tool contracts through their public entry point. |
| context | Retain section-based composition; remove compatibility field fixtures and assumptions. |
| database | Retain loaded plugin with host-mediated SQL capability and workflow step contribution. Never reset the user's external Postgres database. |
| docker | Retain compiled stream transport and archive checks; no blanket conversion to a loaded plugin. |
| editor | Retain host editor/document boundary and contributed pane; no second editor implementation. |
| findings | Remove migration ownership; make review target selection real and keep canonical export/application receipts. |
| github | Retain provider/mirror ownership; remove PR compatibility projection. Keep project lookup used by import/conflict operations. |
| http | Retain loaded request execution and workflow contribution; header/auth variants are present features. |
| linear | Retain loaded provider, codec, and source; rename misleading conformance fixture vocabulary without deleting provider parsing. |
| memory | Replace proposal JSON and generator fallback with Findings; retain approved library, launch text, and receipt-backed application. |
| model-providers | Retain credential-mediated adapters; remove bare backend-ID fallback in shared resolver. |
| nodes-file | Retain file-driven fleet contribution; external node declaration files are reset exclusions. |
| notes | Retain note store/section/routes; remove Memory's alias of these routes. |
| onboarding | Retain bootstrap-only client role before trusted plugin activation. |
| preview | Retain terminal capability reads and host webview; distinguish provider selection fallback from historical compatibility. |
| rollbar | Retain loaded provider/codec/source; same conformance naming cleanup as Linear. |
| sentry-telemetry | Retain contributed exporter; Sentry envelope versions are external protocol, not Acorn's version reset. |
| terminal | Own session records/client state; expose narrow shared projections and lifecycle contributions. |
| workflows | Own workflow forms, wire rows, and lifecycle; retain scheduler integration and durable execution semantics. |

## Validation evidence

Completed during the review:

- `pnpm --filter @acorn/arch-tests test`: four files, 63 tests passed before documentation changes.
- `pnpm lint`: exited successfully; oxlint reported existing warnings; all 34 Turborepo package checks were cache hits.
- `pnpm db:check`: all 11 chains replayed on temporary databases. Migration counts were core 8,
  agents 5, browser 1, changes 1, database 2, findings 7, GitHub 1, HTTP 1, memory 3, terminal 1,
  and workflows 10. This verifies replay, not equivalence of a future consolidated schema.

The final documentation checks are recorded in [acceptance](./13-acceptance.md). No full product suite,
provider-connected test, or real-window UI test was run for this documentation-only review.

## Verify before building

- Re-run searches from findings and follow both production and test consumers before removing a contract.
- Recheck workspace status and schema chains; preserve changes made after this review.
- Use the reset and target-architecture documents as the shared decisions; tickets do not repeat them.
