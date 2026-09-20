# Findings

Date: 2026-09-21. Status: source-backed analysis; recommendations not implemented.
Read [context](./context.md) and [target architecture](./target-architecture.md).
Source locations refer to `9727fd85`; line numbers are navigation hints.

## F01: Findings and Memory have two live proposal models

Priority: first. Confidence: confirmed producer-to-consumer trace.

`plugins/memory/src/server/agentTools.ts:72` defines `memory_write`, which still calls the JSON
proposal store. `plugins/findings/src/node/index.ts:113` imports that store during ready, rather than
receiving fresh proposals directly. `plugins/memory/src/node/index.ts:83` registers legacy sources
and redirects mapped approvals; `plugins/memory/src/server/legacyFindingsCompatibility.ts:34`
mirrors canonical decisions back into JSON. The UI still displays legacy proposals.

Replace the tool's producer with canonical Findings submission before deleting the importer, JSON
store, generator, mapping table, compatibility routes, UI, and synchronization. Preserve a human review
before memory changes. Findings absence returns an explicit unavailable result for proposal submission;
ordinary tasks and owner-authored memory remain usable.

Two deletion traps are material. Canonical export is implemented inside
`plugins/findings/src/server/migration.ts:122`; move it before deleting that class. Memory's
`plugins/memory/src/server/findingsReview.ts:68` records write receipts and checks revisions; retain
that protection across filesystem writes and database updates. It is not historical compatibility.

The review-target contract also promises more extensibility than preparation delivers:
`plugins/findings/src/server/runtime.ts:123` and line 183 select `memory:change` directly. Require a
registered target ID and target-provided instructions/schema, with Memory selecting its own target.
Use the existing controller rather than adding another registry.

## F02: Composition contains feature policy and a package-cycle workaround

Priority: first. Confidence: confirmed.

`apps/node/src/composition/pluginDeps.ts:31` checks Findings migration readiness; lines 36–52 select
legacy Memory review; lines 59–63 introduce a second agent completion route. Terminal exit, task
archive, and workflow completion are also translated into Findings content here. The same file
injects Memory launch behaviour into Terminal because the reverse import already exists.

This contradicts the runtime-only dependency bag described in
`apps/node/src/composition/plugins.ts:17`. Move product collaboration to producer-owned contracts.
Agents already provides a completion event plus durable read capability. Follow that pattern for
workflow and terminal completion. Preserve an awaited, bounded pre-teardown archive hook: an
asynchronous event cannot read a ring buffer or worktree after destruction.

Invert launch text through a Terminal-owned contribution. Memory supplies text; Terminal sends it.
Keep process environment, reconciliation, and scheduler construction in composition.

## F03: Task context carries canonical sections and feature-specific duplicates

Priority: first. Confidence: confirmed.

`packages/protocol/src/api.ts:215` defines `sections` alongside `pr`, `issues`, `notes`, and `memory`.
`packages/node-core/src/server/agentTools/contextSections.ts:20` accepts a compatibility projection,
budgets it separately, then assigns it into the response at line 274. Notes, GitHub, and Memory
contributors populate those duplicate fields. Context's client already reads `sections`
(`plugins/context/src/client/contextModel.ts:73`).

Use `task` plus `sections` only. Move remaining production consumers to section IDs/items and update
fixtures/prompts. Remove compatibility formatting, budgeting, defaults, and published declarations
together. Preserve ordering, byte limits, omission counts, and missing-source diagnostics.

## F04: Shared protocol/client packages contain plugin domain knowledge

Priority: boundary cleanup. Confidence: confirmed imports and callers.

`packages/protocol/src/workflow.ts:1` mixes core tool authorization with workflow definition/run rows.
Core auth, tools, and schedules need the former. Workflow and agent clients need the latter.
`packages/client-core/src/features/integrations/PromoteToTaskModal.tsx:22` accepts workflow definitions
and renders workflow input controls even though the workflow plugin owns execution.

`packages/client-core/src/features/notifications/attention.ts:7` consumes full agent session types.
Its managed-session adapter is called by the Agents plugin, while core should consume only the
attention snapshot. `packages/client-core/src/host/registries/shell/agentToolTone.ts:1` imports an
agent tool type for a small status-to-colour function used by Agents and Changes.

Move workflow rows to Workflows' contract, agent domain types/adapters to Agents, and workflow form
logic to its existing StartFromItemHost. Keep tool authorization in a core-owned protocol module.
Split the generic task promotion operation from its workflow form, preserving create/attach-then-start
errors. Move the small pure tool-tone helper to Agents' contract entry point for its two consumers.

## F05: Core hides a Terminal dependency behind route literals

Priority: boundary cleanup. Confidence: confirmed runtime calls.

`packages/client-core/src/features/tasks/agentSessions.ts:23` owns a Terminal session route and
full session store. `packages/client-core/src/features/tasks/taskBridge.ts:20` duplicates Terminal's
send route. Both comments explicitly justify the literals as a way around the package import rule.
Notifications, send pickers, tab focus, and quit concerns consume this shared state.

The import graph therefore passes while the feature dependency remains. Move Terminal fetches,
invalidation, active-tab state, and complete session records into Terminal. Core consumes contributed
session summaries/actions and attention snapshots. Keep true core task/archive/worktree contracts
in protocol, separating them from Terminal transport/session types. Strengthen architecture checks
for executable plugin route literals in shared packages, with generic namespace builders allowed.

## F06: Workflow run cost still falls back to a second accounting source

Priority: legacy removal. Confidence: confirmed.

`plugins/workflows/src/server/workflowRunProjection.ts:25` queries step costs after querying the
turn-admission ledger, then falls back to those values at lines 43–45. The run pane similarly uses
`legacyCost` (`plugins/workflows/src/client/runs/RunPane.tsx:161`). The runner reserves and settles
provider turns through tree safety at `plugins/workflows/src/server/workflowRunner.ts:903`.

Use admission-ledger projections for run totals and preserve child/root aggregation. Keep step costs
where they describe a step, rather than using them as a second run-total authority. A run with no
provider usage remains unknown or zero according to the existing canonical usage response; do not
manufacture usage by summing unrelated steps. Test failed/reserved turns and unknown cost separately.

## F07: State adoption survives in three runtimes

Priority: legacy removal. Confidence: confirmed.

`packages/custody/src/custody/legacyCustody.ts:55` adopts Electron state; desktop helper handshake and
Rust keychain/helper code still support it. `packages/client-core/src/infra/persistence/devicePrefs.ts:87`
seeds device preferences from Node, and its drain moves the opposite set back. Query setup calls both.
`packages/client-core/src/infra/persistence/legacyStorage.ts` purges retired namespaces on startup.

`packages/client-core/src/host/registries/commands/keybindings.ts:77` reads legacy pane shortcuts;
desktop task view supplies `legacyPaneAction`. Task layout parsing accepts the former active/pinned
representation (`packages/client-core/src/features/tasks/taskLayout.ts:107`).

Delete adoption, seeding/draining, legacy binding input, retired namespace startup purge, and old layout
conversion after the explicit reset path exists. Keep device-vs-node ownership, scoped keys, unavailable
storage handling, normal preference persistence, and valid optional layout fields.

## F08: Plugin compatibility and worker semantics obscure the public contract

Priority: contract cleanup. Confidence: confirmed; no observed worker failure claimed.

The manifest exposes both palette descriptors and commands
(`packages/protocol/src/plugin/contract.ts:975`). A missing command `kind` selects the action form
at line 597, requiring an ordinary union to accommodate historical input. Use explicit command kinds
and one commands collection, updating scaffolds, declarations, bundles, and adapters together.

`packages/node-core/src/server/plugins/isolation.ts:27` classifies synchronous methods using path
regexes; other methods default to asynchronous. `pluginRpc.ts:273` rejects an async callback crossing
a sync boundary. A public signature can therefore stay unchanged while a renamed method changes its
runtime return shape. Make the known top-level method modes an explicit checked contract; retain the
RPC mechanism and bounded synchronous calls. Arbitrary capability methods remain asynchronous unless
their documented contract explicitly provides a supported synchronous member.

`packages/plugin-types/src/contract.test.ts:53` lists deliberate parity holes. Keep opaque framework
handles, but expose portable domain DTOs for run configuration and project configuration/setup,
and compare those in both directions. Do not replace the declaration package with runtime imports.

## F09: Small aliases retain extra ownership and parsing paths

Priority: legacy removal. Confidence: confirmed.

- `packages/node-core/src/server/integrations/connections.ts:331` accepts top-level `token` after
  checking `credentials`. Accept the credentials object only; a provider may still have a token field inside it.
- `packages/protocol/src/modelProviders.ts:38` resolves bare IDs as connection IDs. Require the
  already-written `connection:` or `harness:` prefix and reject malformed/unknown prefixes.
- `plugins/memory/src/server/routes/knowledge.ts:7` aliases Notes routes and its bridge accepts
  several note methods returning `unknown`. Delete the aliases and their bridge plumbing; Notes owns notes.
- `packages/node-core/src/server/db/schema.ts:49` names encrypted credential material `authRef`
  in TypeScript and `access_token` in SQLite. Rename to `encryptedCredentials` and
  `encrypted_credentials` in the fresh baseline, following the value's actual meaning.

Do not delete `core.projects.byGithub`: import and pull-conflict routes still call it. Nor is
`conformance.legacyCache` evidence of a runtime upgrade path: Linear and Rollbar supply provider
codec test fixtures. Rename it to `cachedItem` and keep codec conformance.

## F10: Database reset policy and migration history have diverged

Priority: cutover. Confidence: confirmed replay and inventory.

`scripts/db-reset.mjs:3` says chains start at one baseline, but the review replayed 40 SQL files across
11 chains. The script deletes SQLite files only; state also exists in browser storage, custody files,
private memory, notes, plugin installs, and terminal caches. Replaying historical ALTER/COPY chains on
every fresh install preserves work the approved reset no longer requires.

After schema-changing tickets, generate one fresh migration per owning package and retain normal
migration discovery, transaction/error handling, and mismatched-history rejection. Check indexes,
constraints, and seed invariants, not merely successful table creation. Do not renumber Drizzle's
own snapshot format version. Use the [reset inventory](./reset-and-versioning.md).

## F11: Version reset is a coordinated contract change

Priority: cutover. Confidence: confirmed constants and duplicated literals.

Plugin API major is 13 (`packages/protocol/src/plugin/apiVersion.ts:8`), Node protocol is 2
(`packages/protocol/src/node.ts:5`), service protocol is 3
(`packages/protocol/src/serviceProtocol.ts:5`), workflows use format 2, and dashboard persistence uses
version 2. `/v2` also appears in routing, permission checks, telemetry grouping, SDK examples, and tests.
Changing constants alone leaves incompatible paths and consumers.

Use the coordinated map in [reset and versioning](./reset-and-versioning.md). Version 1 has existed
before, so require a baseline identity rather than accepting historical artifacts by number alone.
Keep independent contract versions after this one transition. Plugin API ranges remain useful to
future independently updated plugins; they do not implement old API behaviour and need not be deleted.

## F12: Encapsulation and explanation need targeted maintenance

Priority: after ownership changes. Confidence: confirmed structure; no performance defect claimed.

Four libraries expose wildcard source exports: client-core, node-core, custody, and dashboards-core.
Close them with explicit entry points, following Protocol's enumerated map. Do not create another
global barrel or force feature-owned modules into an arbitrary layer hierarchy.

Large modules are inspection targets, not automatic rewrite orders. The command session combines
row construction, search lifecycle, and frame navigation; terminal region handling combines traversal,
focus bookkeeping, and key dispatch. Extract the pure row builders and region traversal first, keeping
the stateful owner singular. Leave workflow scheduling/admission and agent ledger state machines intact
unless a specific simplification preserves their invariants.

Documentation contains stale explanations: the manifest guide advertises API 12, while source is 13;
the architecture baseline mentions a removed agent renderer path; the scaffold description still says
frame-first. Update owning docs after implementation. Replace historical comments about removed
architecture with present invariants rather than adding more history to code.

## Verify before building

- Trace each listed producer and consumer again, including permission filters and public declarations.
- Treat explicitly retained fallbacks and recovery as requirements, not deletion candidates.
- Each ticket must prove a visible behaviour or enforceable boundary, not merely reduce line count.
