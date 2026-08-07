# Baseline — frozen metrics

Pinned at commit `279fa860` on 2026-08-08. Every number below carries the command that produced it,
so any agent can re-measure and prove (or disprove) progress. When a work package completes, re-run
the relevant block and record the new value next to the frozen one.

## Repo shape

```sh
git ls-files '*.ts' '*.tsx' | xargs wc -l | tail -1
```

- 1,011 TS/TSX files, **100,379 LOC total**, of which ~29,700 (~30%) is test code.
- 23 workspace packages (`apps/*`, `packages/*`, `plugins/*`, `tools/*`).
- 44 CSS files, 7,406 LOC.

## Big files (non-test)

```sh
git ls-files '*.ts' '*.tsx' | grep -v -e '\.test\.' -e 'e2e/' | xargs wc -l | sort -rn | head -25
```

Frozen top (only 6 non-test files exceed 500 lines; median file is well under 150):

| LOC | File |
|---|---|
| 788 | `plugins/github/src/client/DiffView.tsx` |
| 709 | `plugins/terminal/src/main/terminal.ts` (deliberately co-owned per its header — not a target) |
| 596 | `plugins/github/src/client/PullDetail.tsx` |
| 578 | `packages/client-core/src/settings/WorkspaceSettings.tsx` |
| 559 | `plugins/workflows/src/main/workflowRunner.ts` (deliberately co-owned per its header — not a target) |
| 534 | `plugins/agents/src/main/runtimeEngine.ts` |
| 493 | `plugins/agents/src/client/AgentComposer.tsx` |
| 477 | `plugins/database/src/client/DatabasePane.tsx` |
| 475 | `plugins/agents/src/main/runtime.ts` |
| 456 | `plugins/agents/src/main/store.ts` |
| 445 | `packages/client-core/src/tabs/TabRail.tsx` |
| 442 | `plugins/http/src/server/send.ts` |
| 441 | `packages/client-core/src/ui/diff/DiffRows.tsx` |
| 437 | `plugins/agents/src/main/webhookService.ts` |
| 430 | `plugins/agents/src/client/AgentPane.tsx` |

Target after WP-10: no non-test file over ~500 lines except the two whose headers record deliberate
co-ownership (`terminal.ts`, `workflowRunner.ts`).

## Boundary-test baselines and allowlists

```sh
grep -n 'BROADCAST_BASELINE\|APP_DEEP_IMPORT_BASELINE\|PLUGIN_NAMED_BASELINE\|CHILD_PROCESS_OK\|CORE_IMPORT_ROOTS' tools/arch/boundaries.test.ts
```

| Ledger (line) | Frozen size | Kind | Target |
|---|---|---|---|
| `CHILD_PROCESS_OK` (:221) | 19 files | sanctioned allowlist | unchanged |
| `CORE_IMPORT_ROOTS` (:269) | 35 roots | exact-set allowlist | may shrink via WP-04 |
| `BROADCAST_BASELINE` (:352) | 5 files | shrink-only | **0** (WP-08) |
| `APP_DEEP_IMPORT_BASELINE` (:381) | 7 entries | shrink-only | **0** (WP-08) |
| `PLUGIN_NAMED_BASELINE` (:424) | 4 files | shrink-only | ≤3, ideally less (WP-03 unblocks `managedAgents.ts`) |

A second, undocumented ratchet exists: `packages/client-core/src/ui/adoption.test.ts` — a
`CONVERTED` ledger of 17 `.tsx` files that may only grow. WP-01 documents it in `docs/ui-design.md`.

## Validation counts (non-test files)

```sh
grep -rn '\.parse('    --include='*.ts' --include='*.tsx' packages plugins apps tools | grep -cv '\.test\.'
grep -rn '\.safeParse(' --include='*.ts' --include='*.tsx' packages plugins apps tools | grep -cv '\.test\.'
grep -rn 'JSON\.parse'  --include='*.ts' --include='*.tsx' packages plugins apps tools | grep -cv '\.test\.'
```

Frozen: `.parse(` **130** · `.safeParse(` **76** · `JSON.parse` **86**.

Scoping note: the stated contract (`docs/architecture-overview.md` § Wire validation) is Zod
`safeParse` at every **mutation** boundary; reads are deliberately unvalidated. Only
external-input and persisted-data `JSON.parse` sites are in scope (WP-11). Converting the 130
`.parse(` calls wholesale is explicitly not a goal.

## Test-thin spots

```sh
# per package: test LOC / src LOC
for p in plugins/linear plugins/rollbar plugins/workflows plugins/docker; do
  s=$(git ls-files "$p/src/**" | grep -E '\.tsx?$' | grep -v '\.test\.' | xargs wc -l | tail -1 | awk '{print $1}')
  t=$(git ls-files "$p/src/**" | grep -E '\.test\.tsx?$' | xargs wc -l | tail -1 | awk '{print $1}')
  echo "$p $t/$s"
done
```

Frozen ratios: `plugins/linear` **0.09**, `plugins/rollbar` **0.13**, `plugins/workflows` **0.14**
(engine covered by `apps/node/test/integration/workflowRunner.test.ts`, 552 LOC), `plugins/docker`
**0.17**.

Directories with ≥4 source files and zero colocated tests:

- `plugins/database/src/client` (8 files)
- `plugins/terminal/src/contract` (5)
- `plugins/notes/src/client` (5)
- `plugins/linear/src/server` (4)
- `packages/node-core/src/main/agentProfiles` (4)

## Doc-staleness ledger (WP-01 input)

| # | Location | Problem |
|---|---|---|
| 1 | `README.md:95` | Links `./docs/vNext` — moved to `docs/legacy/vNext` |
| 2 | `docs/release-notes-vnext.md:37` | Same broken `./vNext` link |
| 3 | `docs/integrations.md:49` | "Outbound calls use host allowlists" — contradicted by `docs/http-client.md:21-25` (no allowlist exists; http-client.md is the honest one) |
| 4 | `docs/analysis.md:36` | Describes boundaries test as "330 lines, 13 rules" — now 603 lines, 22 rules |
| 5 | `docs/analysis.md` findings 2,3,4,5,7,11,12 | Landed but still read as open work — needs a status ledger |
| 6 | `docs/analysis.md:313` | "no ESLint (or equivalent) anywhere" — oxlint landed (`.oxlintrc.json`, `pnpm lint`) |
| 7 | `docs/terminal-and-agents.md:28` | Still says Claude/Codex/Aider "profile plugins" contribute launch specs — folded into plugins/agents |
| 8 | `docs/architecture-overview.md:118` | Still lists the profile packages among shipped feature packages |
| 9 | `docs/terminal-and-agents.md:20` | "Plugins do not call spawn/execFile directly" — contradicted by the 19-entry `CHILD_PROCESS_OK` allowlist (10 plugin files); security.md already withdrew this claim |
| 10 | `docs/ui-design.md` | Does not mention the `adoption.test.ts` CONVERTED ratchet |

Also undocumented (fix travels with WP-07, not WP-01): notes' HTTP surface is served under memory's
namespace — `plugins/notes/src/shared/api.ts:15-16` targets `/v2/p/memory/tasks/:id/notes`, served
by `plugins/memory/src/server/routes/knowledge.ts:113-135`. Neither `docs/notes-and-memory.md` nor
`docs/api-reference.md` mentions it (`docs/analysis.md:290` records it).
