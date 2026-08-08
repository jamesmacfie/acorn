# WP-10 — Big-file decomposition

**Effort:** M · **Depends on:** per slice group (below). Groups are mutually parallel-safe
(disjoint file territories) once their predecessors land.

## Context

Only six non-test files exceed 500 lines (see [BASELINE.md](BASELINE.md) § Big files), and two of
those record deliberate co-ownership in their headers and are **exempt**:
`plugins/terminal/src/main/terminal.ts` (709) and `plugins/workflows/src/main/workflowRunner.ts`
(559). Read the header before touching any big file — this repo documents intent at the top of
files, and a documented decision beats a line-count heuristic.

Rules for every split:

- Extract **pure models/helpers first** (parsing, shaping, formatting), UI shells last.
- Preserve the import surface: sibling modules + re-export from the original path where anything
  external imports it. `verbatimModuleSyntax` is on — keep type-only imports type-only.
- Target ~300–500 lines; do not shard into confetti — a coherent 450-line component beats four
  120-line fragments with circular knowledge.
- Colocated tests move with their code; components get no render tests (node-only vitest — test
  extracted pure logic instead).
- Match the file's existing comment density and naming; splits are not rewrites.

## Slice groups

### Group A — plugins/github client (after WP-04, WP-05, WP-06 — they relocate these files' data
reads, routes, and CSS; splitting first means rebasing every one of them)

- `plugins/github/src/client/DiffView.tsx` (788) — two components (`DiffView`, `DiffForPull`).
  Likely extractions: diff-model/highlight helpers (note core's shared diff machinery in
  `packages/client-core/src/ui/diff/` — reuse, don't duplicate), thread/comment subcomponents,
  the pull-fetching wrapper.
- `plugins/github/src/client/PullDetail.tsx` (596) — panel sections into sibling components.

### Group B — client-core settings (independent; anytime)

- `packages/client-core/src/settings/WorkspaceSettings.tsx` (578) — per-section components
  (repo assignments, appearance, etc. — follow the visual sections). Check
  `adoption.test.ts`'s CONVERTED ledger before and after: split files must stay converted.

### Group C — plugins/agents (after WP-11 decides `webhookService.ts` validation; coordinate —
same files)

- `runtimeEngine.ts` (534), `runtime.ts` (475), `store.ts` (456), `sessionRepository.ts` (429),
  `webhookService.ts` (437) — main-process engine cluster; extract per-concern modules (driver
  dispatch, persistence mapping, webhook event shaping). Read `docs/managed-agents.md` first;
  the driver/profile seam was deliberately folded in (commit `5d983af5`) — do not reintroduce a
  fake extension seam.
- `AgentComposer.tsx` (493), `AgentPane.tsx` (430) — client; pure state/format helpers out first.

### Group D — node-core main/core regroup (after WP-08 — it edits `main/` context threading)

- `packages/node-core/src/main/core/` — 16 single-purpose files (`fs`, `git`, `proc`, `secrets`,
  `tasks`, `repos`, `prefs`, `identity`, `models`, `context`, …) behind `core/index.ts`. The
  problem is the generic name, not the contents. Regroup into domain-named directories (e.g.
  `vcs/`, `exec/`, `identity/` — derive the grouping from the CoreServices facets in
  `docs/plugins.md`), keep the barrel re-exporting from new paths so no consumer changes. Cheap
  because the barrel is the only public surface — verify that with
  `grep -rn "main/core/" packages plugins apps --include='*.ts' | grep -v node-core/src/main/core`.

## Pre-flight

```sh
git ls-files '*.ts' '*.tsx' | grep -v -e '\.test\.' -e 'e2e/' | xargs wc -l | sort -rn | head -15
head -20 plugins/github/src/client/DiffView.tsx   # and each target: read the header for intent
ls packages/node-core/src/main/core/
```

Re-measure; a file already split (or newly grown) changes the slice list. Read every target's
header comment before planning its split.

## End state

No non-test file over ~500 lines except the two documented co-ownership exemptions. No consumer
outside the split file changed imports except via the preserved barrel/re-export. All suites green.

## Non-goals

- `plugins/http/src/server/send.ts` (442), `TabRail.tsx` (445), `DiffRows.tsx` (441),
  `DatabasePane.tsx` (477), and everything else under 500 — under the line; touch only if another
  WP passes through them.
- No behavior changes, no new abstractions beyond the extraction itself, no renaming exported
  symbols.

## Slices

One file (or Group D as one regroup) per commit. For each: read header → extract pure parts with
their tests → extract components/sections → re-export shim if anything external imports the old
path → gates.

## Gates

Per slice: owning package's vitest + `pnpm lint`. Group D additionally
`pnpm --filter @acorn/arch-tests test` (relative-import and barrel rules). Groups A/B end with
desktop e2e + user QA note (diff view, PR detail, workspace settings are core UX).

## Risks & rollback

- **Solid reactivity:** splitting a component can break reactive scope (props destructuring kills
  reactivity; `<For>` vs `<Index>` keying — repo memory records a focus-loss gotcha). Extract
  leaf components with explicit props; never destructure props in the extracted signature.
- **Group C double-touch with WP-11** — single owner for both or strict ordering.
- Every slice is one file's split; revert is `git revert` of that commit.

## Doc updates

`docs/diff-rendering.md` if DiffView's structure is described there; `docs/managed-agents.md` for
Group C if module names it cites change. Group D: none externally visible (barrel unchanged), but
update any doc that cites `main/core/` paths (`grep -rn 'main/core' docs/`).

## Done criteria

- [x] BASELINE big-file table re-measured; no non-exempt implementation file >500.
- [x] No external import-path churn (legacy `main/core/*.ts` facades preserve existing imports and
  `core/index.ts` now assembles from domain-owned paths).
- [x] Owning package tests and lint are green. Desktop e2e remains environment-blocked by local
  listener permissions; the required visual-QA handoff is recorded below.

### UX QA handoff — 2026-08-08

The split is behavior-preserving at the entry points: `DiffView`, `PullDetail`, and
`WorkspaceSettings` keep their existing imports and CSS. Automated package gates cover the extracted
models and TypeScript boundaries. A live desktop e2e pass is still blocked in this environment by
`listen EPERM` from the preview-tunnel/node-broker tests; manual visual verification should cover a
virtualized diff, PR summary/actions, and workspace repository settings before release.

## Progress

- [x] Group A — DiffView, PullDetail
- [x] Group B — WorkspaceSettings
- [x] Group C — agents cluster (runtime engine concern extracted; remaining cluster files are below the threshold)
- [x] Group D — main/core regroup

## Completion amendment — 2026-08-08

Group A extracted the diff canvas, find controller, sticky-file model, and PR summary while keeping
the lazy `DiffView` and `PullDetail` entry paths unchanged. Group B moved repository-level workspace
editors into `WorkspaceRepoSettings.tsx`. Group C moved transcript/fork shaping out of the runtime
engine without recreating a provider-driver extension seam. Group D placed core implementations under
domain directories (`vcs`, `exec`, `filesystem`, `identity`, `security`, `models`, `tasks`, and
`context`); the historical `main/core/*.ts` paths remain one-line facades for external consumers.
