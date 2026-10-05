# Trim evidence and handoffs

Date: 2026-10-05. Status: phase 01 complete; later phases remain TODO.

## Historical investigation

The audit inspected revision `5f2cec506`. Planning rechecked owners at `2ae55abb5`.
The intervening change remembered the transcript's Chats only filter per session; phase 06 must
preserve it. Measurements below describe the audit checkout, not a fresh installed release.

| Measure | Observed | Definition or limitation |
| --- | --- | --- |
| Workspace packages | 36 | Root manifest excluded. |
| First-party plugins | 21 | Plugin workspace packages. |
| Production files / lines | 2,182 / 250,050 | TS, TSX, Rust, CSS, MJS in apps, packages, plugins, tools; generated/vendor/test code excluded. |
| Production TS/TSX files / lines | 2,079 / 233,639 | Same exclusions; median 70 lines; 47 files above 500 lines. |
| Production files at most 300 lines | About 92% | TS/TSX census. Small files are evidence about shape, not proof of simplicity. |
| Source test files | 1,100 | Test/spec files; testkit helpers counted separately. |
| Unique direct external names | 79 | 37 manifests including root; 61 production and 18 development-only names. |
| Locked entries / unique names | 566 / 528 | Version/peer snapshots, including optional platform packages. |
| Production closure entries / names | 285 / 283 | Union from external production importer roots; includes resolved peers and optional edges. |
| Development-only closure entries / names | 281 / 245 | Development closure minus production closure; not everything marked dev in a manifest. |
| Runtime staging closure size | 327.8 MiB | 112 installed package copies, macOS arm64; uncompressed package files, nested node_modules excluded per copy. |
| Claude adapter closure size | 244.8 MiB | Overlapping subset of staging closure; 103 installed package copies. |
| Optional Claude arm64 binary | 216.7 MiB | Installed SDK binary package; omission is not yet proven safe. |
| node-pty package size | 61.4 MiB | Windows prebuild directories accounted for about 57.7 MiB on this macOS checkout. |

The dependency closures overlap. Never add branch sizes to estimate total savings. Removing a direct
declaration may remove no locked package: Solid still requires seroval, for example. Lock entries are
neither installed package copies nor shipped bytes. Rust's lockfile was also substantial, but the
audit did not establish unused Tauri crates. No fresh vulnerability audit was performed.

## Structural findings

- Workflow value imports formed a six-module strongly connected component around file definitions,
  built-in execution, resolution, and incremental processing. Agent pane selection formed a
  three-module component through the pane ID import.
- `TabRail.tsx` had 750 lines and mixed task editing with queries, menus, ordering, and rendering.
  `AgentComposer.tsx` had 776 lines and mixed rendering with asynchronous draft operations.
- Workflow activation had 689 lines; plugin host initialization lived in an 805-line host file.
- Agent engine and runtime files had 1,312 and 813 lines respectively. Inheritance exposed mutable
  process, scheduling, and shutdown state to product commands.
- GitHub project identity and task pull relations appeared in core storage and public transport.
  Generic external-item and project mapping models already exist; a migration needs a concrete need.

Paths and counts are dated evidence. Phase 01 must retain its exact exclusion list, graph resolution
rules, scripts, and raw summaries so phase 15 can repeat the same method.

## Verification already performed

On Node 24.11.0, `pnpm --dir tools/arch exec vitest run --maxWorkers=2` passed 11 files and 85 tests.
This runtime did not meet the root's supported Node 24 floor. Full tests, production packaging,
installed launch, and paired performance measurements were not established by the investigation.

Planning validation on 2026-10-04: `pnpm --filter @acorn/arch-tests test` passed all 11 files and
85 tests, including path/link checks over the new documents. It ran on the same unsupported Node
24.11.0, with the engine warning visible. A separate check resolved every focused-test command's
package/file and confirmed the required sections in all 15 tasks. Whitespace checks passed.
These checks validate the handoff documents; they do not satisfy phase 01's implementation baseline.

## Phase 01: implementation baseline (2026-10-05)

Baseline source revision: `9dfd29df7116d44b16f5bd81e4a18b39df0e32c7`, clean worktree before
measurement. Target: Darwin arm64, `aarch64-apple-darwin`; supported cached runtime
`node-v24.21.0-aarch64-apple-darwin`, pnpm 11.0.0. The Node binary is the SHA-256 checked runtime
that desktop staging caches for the root `node-runtime.json` pin. Set `PATH` so this binary is
called `node` before invoking pnpm or any gate; the host default is unsupported Node 24.11.0.

The worktree had no modules. `pnpm install --frozen-lockfile` could not resolve npmjs.org (`ENOTFOUND`),
and `pnpm install --offline --frozen-lockfile` named missing `esbuild@0.25.12` in the store. For this
baseline, modules were copied from a sibling checkout at the **same revision and identical lockfile
SHA-256** (`78076612aee79894d1089d4a581953b17bf2785458ff343d3c977ee48c573c40`). The
workspace-local pnpm state was rebased to this worktree. This is not evidence that a fresh install
succeeds offline. Dependencies, overrides, and lockfile were left unchanged.

### Reproduce the inventory

Run `node docs/future/trim/inventory.mjs --self-test` and then
`node docs/future/trim/inventory.mjs > docs/future/trim/artifacts/phase-01-inventory.json` from the
repository root under supported Node with an installed graph matching the lockfile. The self-test
uses overlapping roots, peer-qualified snapshots, optional and workspace edges, and conflicting
versions. The [raw inventory](./artifacts/phase-01-inventory.json) is the comparison input for phase
15. It contains the complete per-package size rows and SCC members. The script fails on unresolved
locked nodes or relative TS imports; optional installed packages absent on this target are listed.

Lock traversal starts with all 37 importers. `dependencies` and `optionalDependencies` form the
production roots; `devDependencies` form separate development roots. It follows each snapshot's
resolved dependency and optional edges, including peer-qualified keys, and skips local `link:`
workspace edges. A removable root count subtracts everything reachable from every other production
**or development** root. These are lock snapshot counts, never installed copies or byte savings.

| Measure | Implementation baseline | Definition |
| --- | ---: | --- |
| Manifests / workspace manifests / plugin manifests | 37 / 36 / 21 | Read each locked importer's package manifest; root included only in the first count. |
| Direct external declarations / unique names | 392 / 79 | Manifests declare 205 production and 187 development dependencies: 61 production names, 22 development names, and 18 development-only names. |
| Locked package entries / snapshots / names | 566 / 566 / 528 | Version and peer-qualified snapshots; optional targets included. |
| Production closure | 285 snapshots / 283 names | Reachable from production roots. |
| Development closure / overlap / development-only | 310 / 29 / 281 snapshots | Development reachability, intersection with production, then subtraction. Development-only snapshots contain 247 names; 245 names are absent from production. |
| Installed desktop runtime graph | 112 copies / 111 names / 343,706,024 B | 327.78 MiB of actual package files on Darwin arm64, before staging. Real paths deduplicated; each package excludes its nested `node_modules`. |
| Staged helper package graph | 113 copies / 111 names / 343,726,775 B | 327.80 MiB in `apps/desktop/dist/helper/node_modules`; staging creates two nested copies of `content-type@2.0.0`. |
| Claude adapter installed branch | 103 copies / 256,702,359 B | A subset of the installed runtime graph, so its bytes cannot be added to the total. |
| Production files / lines | 2,276 / 262,013 | TS, TSX, Rust, CSS, MJS under apps/packages/plugins/tools. |
| Production TS/TSX files / lines | 2,172 / 245,143 | Same exclusions; 1,140 test files counted separately. |

The source scan excludes hidden directories, `node_modules`, `dist`, `build`, `target`, `generated`,
`__generated__`, `migrations`, `testkit`, `vendor`, `vendored`, `.turbo`, declarations, and test/spec
files. Lines count newline-terminated lines. The installed branch follows the same peer and optional
manifest edges as desktop staging and records missing target optionals. Source size and historical
figures differ because the audit revision and exclusion implementation differ; do not compare those
figures as a before/after reduction. The lock's production importers also resolve the optional
`@types/node` peer of `packages/plugin-types/package.json`, giving 62 locked production root names
versus 61 manifest dependency names. Snapshot intersection shares 29 names; comparing closure
names independent of versions shares 31. The raw inventory retains both definitions.

Manual shared-root checks: removing the direct `seroval` or `seroval-plugins` root removes **zero**
locked snapshots while all other roots remain. The direct `@modelcontextprotocol/sdk` root also
removes zero; Claude ACP reaches it. The Claude ACP root has 11 uniquely reachable snapshots, but
its 103 installed copies overlap other runtime branches. The installed Claude branch is 244.81 MiB,
including the optional Darwin arm64 binary package. The `node-pty` branch occupies 64,760,054 B,
including 64,363,742 B in the package itself. Its
`prebuilds/win32-arm64` and `prebuilds/win32-x64` directories contain 29,341,768 and 31,092,288 B
respectively on this macOS checkout. These are characterization figures, not proposed omissions.

The TS measurement resolves relative imports and re-exports through each package's tsconfig via
TypeScript's module resolver. Bare package and built-in imports are excluded from these internal
graphs. Type-only and dynamic edges are counted separately; dynamic edges do
not enter the static SCC graph. Both areas have zero unresolved relative imports. Workflow server:
64 files, 128 static value edges, 102 type-only edges, no dynamic edge, one six-file SCC around
`definitions/files.ts`, `definitions/resolution.ts`, `steps/builtins.ts`, and three `processing/`
modules. Agent client: 93 files, 193 static value edges, 60 type-only edges, 11 dynamic imports,
one three-file SCC: `paneContribution.ts`, `sessions/agentPaneModel.ts`, and
`sessions/managedSelection.ts`. The raw inventory names every member and dynamic edge.

### Ownership and preservation map

| Phase / entrypoint | Durable store and mutable owner | Async boundary and consumers | Contract to preserve / existing proof or gap |
| --- | --- | --- | --- |
| 02–05 dependency and packaging roots: manifests, `scripts/nodeRuntimePackages.ts`, `apps/node/externals.ts`, desktop `stage*.mjs`, standalone `pack-node.mjs` | pnpm lock owns dependency resolution; staging owns copied helper files; generated standalone manifest owns install requirements. | Desktop helper/service and standalone Node resolve the external runtime graph after bundles load. | Keep root security overrides, ABI-matched `node-pty`, target optionals, and separate standalone installs. Existing `dependencySecurity.test.ts`, staging tests, build and pack checks; installed release launch remains a later host gate. |
| 06 workflow definitions and processing: `definitions/files.ts`, `steps/builtins.ts`, `definitions/resolution.ts` | Workflow plugin SQLite in `node/schema.ts` stores definitions, revisions, runs, and processing identity. File/processing services own resolution state. | File reads and resolution feed dispatch, incremental processing, and run readers. | Fingerprint bytes, validators, and persisted definition identity. Existing resolution/catalog/processing tests; raw SCC graph above. |
| 06 agent pane selection: `sessions/managedSelection.ts` and `paneContribution.ts` | Device-scoped selection signals in `managedSelection.ts`; Node owns session rows separately. | Pane registration and conversation components read selection after navigation. | `AGENT_PANE_ID`, focus, selected child, per-session Chats only. `managedSelection.test.ts` and `agentPaneModel.test.tsx`. |
| 07 task rail: `packages/client-core/src/features/tabs/TabRail.tsx` | Core tasks/projects in Node SQLite; rail signals own dialog draft, query cache owns fetched rows. | Node-scoped task/project queries, project config bridge, branch/worktree availability, create/patch/archive mutations; desktop and TUI consume the shared rail. | Task/project IDs, branch source, worktree path, setup choice, task order. `TabRail.test.tsx` covers conflicts, fail-open lookup, setup, drag and lineage. **Gap:** held availability across project/Node switch or dialog reopen has no explicit test. |
| 08 agent composer: `plugins/agents/src/client/composer/AgentComposer.tsx` | Session events/attachments in agents plugin SQLite and blob store; `composerDraftState(sessionId,nodeId)` owns shared unsent draft; view signals own picker state. | Upload, replacement, context capture, and durable turn acceptance through Node routes; multiple desktop/TUI surfaces share a draft. | Draft storage keys, attachment IDs, revision acknowledgment, limits and focus. Ownership/state/attachment tests cover held send, picker, replacement, hydration, and CAS. **Gap:** held automatic context capture across a Node/session switch lacks explicit component proof. |
| 09 workflow plugin activation: `plugins/workflows/src/node/index.ts` | Workflow plugin DB and runner/schedule/processing services; activation owns registration/disposal handles. | Host `init`/`ready`, capability calls into agents and GitHub, routes/events/schedules, reconciliation before start; Node and clients consume run state. | Capability IDs, route IDs, workflow run/step IDs and ready ordering. Node integration `workflowRunner`, `workflowTasks`, `workflowFiles` tests plus plugin host tests. |
| 10 plugin host: `packages/node-core/src/server/pluginHost/host.ts` | Host owns per-plugin DB handles, contribution cleanup, roster and reload transaction; plugins own their own DB data. | Ordered init, all-init-before-ready barrier, loaded candidate reload, reverse disposal; Node routes/registries and loaded bundles consume bindings. | Manifest permission gates, API major 3, same capability graph, failed-reload old instance. `host.test.ts`, schedules and Node runtime-contribution integration cover major paths. **Gap:** partial multi-contribution registration failure rollback lacks a direct focused assertion. |
| 11–13 agent runtime: `plugins/agents/src/server/sessions/runtime.ts` and `runtimeEngine.ts` | Agents plugin `AgentStore` persists sessions, turns, events and requests. Runtime/engine own live generations, queue scan, timers, callbacks, and exposed stores. | Durable enqueue precedes provider startup; pump rereads heads after awaits; drivers callback into event buffer; routes, delegation and workflow capabilities consume runtime. | Session/turn IDs, event order, admission fairness, startup reservations, retry, stop joins and public methods. `runtimeQueue`, `runtimeStartup`, `runtimeIdleStop`, `runtime`, session-control/execute and driver tests cover the named races. |
| 14 provider coupling: core `db/schema.ts`, protocol `transport/api/projects.ts` | Core SQLite owns project GitHub identity, task pull relations and generic external-item links; GitHub mirror is disposable plugin data. | Core routes expose fields to rail/task context, Changes, workflow and agent PR linking. | Project/task wire fields and DB history. Core project/task tests and protocol/architecture checks establish current behavior; phase 14 must map each reader/writer before any migration decision. |

The three named gaps are specific characterization work for their owning later phases. Phase 01
changes no behavior, schema, public export, route, or persisted identifier. The existing fixtures
already cover the admission and process lifetime races, so no redundant tests were added.

### Baseline gates and artifacts

All commands ran from this root with `PATH=/private/tmp/acorn-trim-node-bin:$PATH`, where `node` is
a symlink to the cached 24.21.0 binary. `TURBO_FORCE=true` bypasses shared results made on
unsupported Node 24.11.0. Recreate the symlink under a temporary path or use an installed supported
Node before rerunning. The full test required permission to bind local loopback listeners.

| Command after the PATH prefix | Result | Retained log |
| --- | --- | --- |
| `TURBO_FORCE=true pnpm lint` | Passed, 37/37 tasks, zero cached; 3m11s. | [Lint log](./artifacts/phase-01-lint.log.gz) |
| `TURBO_FORCE=true VITEST_MAX_WORKERS=2 ACORN_TEST_CONCURRENCY=2 pnpm test` | Passed, 36/36 tasks, zero cached; 3m44s. Includes architecture, desktop boot, and 62 Rust unit tests. | [Test log](./artifacts/phase-01-test.log.gz) |
| `TURBO_FORCE=true pnpm build` | Passed, 6/6 tasks, zero cached; 19s. Staging used pinned Node from cache. | [Build log](./artifacts/phase-01-build.log.gz) |
| `TURBO_FORCE=true pnpm pack:node` | Passed; service, CLI, and TUI runtime imports checked, nine migration chains staged. | [Pack log](./artifacts/phase-01-pack.log.gz) |
| `pnpm --filter @acorn/arch-tests test` | Passed after the handoff edits, 12 files and 86 tests. | [Final architecture log](./artifacts/phase-01-arch-final.log.gz) |

The inventory graph fixture, `node --check docs/future/trim/inventory.mjs`, scoped oxlint, and
`git diff --check` also passed. The inventory imports the runtime-root list directly and retains
static edge pairs so phase 06 can inspect the same graph without rediscovering resolution rules.

The first full test attempt in the sandbox was stopped after a direct Node startup confirmed
`listen EPERM` on `127.0.0.1`. With loopback permission and the default six package jobs, the
second full run failed one architecture test at its five-second timeout and one client-core
telemetry assertion. Both passed focused reruns:

```sh
pnpm test:focus @acorn/arch-tests boundaries.test.ts -t "shared runtime code does not execute a named plugin route"
pnpm test:focus @acorn/client-core src/host/frames/sdk.test.ts -t "ends a hand-held span once"
```

The third full run passed with two package jobs and two Vitest workers. The [failed concurrent
run](./artifacts/phase-01-test-concurrent-failed.log.gz), [focused architecture
run](./artifacts/phase-01-arch-focus.log.gz), and [focused client run](./artifacts/phase-01-sdk-focus.log.gz)
retain the diagnosis. No code change suppressed either failure.

The staged helper package inventory contains 113 copies and 343,726,775 uncompressed bytes.
Its helper JS bundle is 286,956 B. The staged Node binary is 122,129,232 B, SHA-256
`e4b5a3af0e05c75de2eae013904145f40fe7fc2a6e6f17510128bf45cca4e79b`.
The generated standalone `acorn-node-1.0.0.tar.gz` under `apps/node/release/` is 2,096,529 compressed bytes,
SHA-256 `df6db6b6f346b216c6444aa45fd0a79e91cef717a9141a4c51ca470c5bb7f861`.
It has 576 archive paths. Its manifest retains the supported Node engine, root security overrides,
and runtime dependencies. The tarball contains bundles and migration chains; operators install its
dependencies separately. Its compressed bytes are therefore a different measure from helper package
bytes. Retain its digest as baseline evidence rather than committing the generated archive.

Measure artifact files with `stat -f "%N %z bytes"`, `shasum -a 256`, and
`tar -tzf apps/node/release/acorn-node-1.0.0.tar.gz`. Inspect the manifest with
`tar -xOzf apps/node/release/acorn-node-1.0.0.tar.gz acorn-node/package.json`. Archive timestamps
can change the digest on a rerun. Build and pack do not prove an installed release launches.

Target gates live in `.github/workflows/ci.yml` and `.github/workflows/build-desktop.yml`: Linux CI,
macOS arm64, and Windows x64 desktop bundles. This baseline covers local Darwin arm64 only.
Phase 02 is next. Reuse the inventory definitions for later comparisons, and add characterization
proof for the named gaps before changing their owners.

## Future implementation record

Add one dated section per later phase containing:

1. Start and accepted implementation revisions; dependency versions and target where relevant.
2. Responsibility or dependency changes, including preserved public and persisted contracts.
3. Exact commands, results, and durable relative paths to supporting logs, inventory scripts,
   artifact manifests, screenshots, or host reports. Index any added Markdown evidence.
4. Before/after metrics using the phase 01 method, including zero savings and retained dependencies.
5. Required gates that failed or were unavailable, the reason, and the effect on the next assignment.
6. The next task and its new code locations. Mark retention decisions explicitly as retention.

Do not store credentials, provider prompts containing private project data, or host-specific secrets.

## Verify before building

Check the current revision, supported runtime, and working tree. Read the numbered task's acceptance
criteria before adding a completion record. A missing verification result is not a passing result.
