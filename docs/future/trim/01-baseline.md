# Phase 01: establish the baseline and ownership inventory

Date: 2026-10-04. Status: TODO. Risk: low; measurement and characterization only.
Prerequisite: none. Next: [phase 02](./02-direct-dependencies.md).
Planning revision: `2ae55abb5`; historical audit: `5f2cec506`.

## Task and context

Establish the repeatable baseline for this programme before changing dependencies or responsibilities.
Acorn is a Tauri desktop shell, Node service, terminal client, and plugin tree. The audit found local
hotspots rather than a broken overall architecture. Its dependency counts include platform variants
and development tools; its byte measurements describe an installed macOS arm64 checkout.

The Node owns durable task/session state and operations. Public transport and plugin contracts carry
that state into Node-scoped client queries and shared desktop/TUI components. Desktop staging also
copies an installed external package graph beside the Node helper. Keep these flows distinct when
measuring. Read [architecture](../../architecture-overview.md), [conventions](../../conventions.md),
[testing](../../testing.md), and [packaging](../../shell/packaging.md).

## Scope and starting points

- Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `node-runtime.json`, `turbo.json`.
- `scripts/nodeRuntimePackages.ts`, `scripts/pack-node.mjs`, `apps/node/externals.ts`.
- `apps/desktop/scripts/stage-runtime-dependencies.mjs` and `apps/desktop/scripts/stage.mjs`.
- Hotspot owners: tabs in client-core, agents composer and server sessions, workflow Node activation,
  and node-core pluginHost. Use the subsequent tasks' exact paths to anchor the inventory.
- `tools/arch/boundaries.test.ts`, `tools/arch/dependencySecurity.test.ts`, and the existing tests
  named by phases 06–13. No production refactor or dependency upgrade belongs here.

## Implementation steps

1. Record the working tree and revision. Use pnpm 11 and a supported Node from root engines; prefer
   the bundled pin for comparable runs. The original local Node 24.11.0 was unsupported. Install
   with `pnpm install --frozen-lockfile` only when needed; do not regenerate the lockfile.
2. Retain a small reproducible inventory script with the evidence, outside runtime source. Record
   its command, inputs, output, exclusions, and unresolved cases. It must count manifests and unique
   external names separately from locked version/peer snapshots and installed copies.
3. Traverse production and development importer roots separately through locked dependencies,
   resolved peers, and optional edges. Handle workspace edges and pnpm peer-qualified keys. Report
   union, overlap, and development-only closure. Fail or report unresolved nodes explicitly.
   Determine removable closure by subtracting the graph reachable from all remaining roots.
4. Measure staged/installed package bytes by real installed path, excluding nested node_modules from
   each package's own size. Deduplicate copies by real path. Record OS, architecture, target triple,
   Node, pnpm, versions, and whether bytes describe checkout, staged helper, or compressed artifact.
   Retain per-package and per-platform directory totals. Do not sum overlapping branch closures.
5. Retain a TS value-import graph measurement for the two phase 06 areas. Resolve imports/re-exports
   using package tsconfig rules; distinguish type-only edges, dynamic imports, and unresolved imports.
   Record strongly connected components. Count production file sizes with fixed exclusions for
   generated files, declarations, migrations, tests, testkit, vendored code, and build output.
6. Build a compact behavior/owner table for each hotspot: entrypoint, durable store, mutable owner,
   async boundaries, consumers, public/persisted identifiers, and existing proof. List concrete
   uncovered races only. Add characterization tests only for uncovered behavior needed by a later
   phase, using existing integration fixtures and observable outcomes.
7. Run the baseline gates below. Save exact commands and results in `evidence.md`, with reproducible
   inventory outputs and script locations. Record pre-existing failures separately. Do not proceed
   into a phase whose preservation baseline is unknown or whose required environment is unavailable.

## Verification

```sh
pnpm lint
pnpm test
pnpm build
pnpm pack:node
```

The complete root test includes architecture and desktop suites. Build and pack establish packaging
inputs; they do not prove an installed release launches. Retain build logs and staged helper inventory
for the local target. Identify existing target CI gates rather than claiming all platforms passed.
Review the inventory manually for shared roots such as seroval and the Claude adapter/MCP overlap.
If an inventory script will be reused, check it against a small graph with overlapping roots, peers,
optional edges, and conflicting installed versions; avoid creating a general-purpose analytics tool.

## Acceptance and handoff

- A developer can rerun the inventory from retained commands and get comparable definitions.
- Every phase's preservation invariants have an owner and existing proof or a documented test gap.
- Supported-runtime lint, complete tests, build, and pack have results with no unexplained failures.
- `evidence.md` contains the baseline revision and environment, measurements, artifacts, and blockers.
- Update this status and the programme table, naming phase 02 as next. No source cleanup ships here.

## Verify before building

Check root engines, scripts, packaging target support, and test fixtures. Re-read current code rather
than treating historical counts as assertions. Resolve material discrepancies before refactoring.
