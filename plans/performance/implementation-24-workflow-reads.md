# Workflow read implementation record

Date: October 2, 2026. Unit 24 is implemented. Native functional verification remains blocked by
the shared Node service size gate. The user authorized implementation and a commit on the shared
 branch. No branch or subagent was created.

## Ownership and changes

Workflow SQLite owns the reads under `plugins/workflows/src/server/`:

- `runs/read/projection.ts` selects explicit scalar fields for the 100-run list, descendant
  navigation, reprocess dispatches, source roots, and root tasks. Source lookup uses an ID map.
- `runs/read/readModel.ts` selects response fields before materialization, retaining `defJson`
  for each historical graph. Parent/root rows and provider admissions use compact fields. Admissions
  are grouped once by root and run with their original summation order.
- `processing/readModel.ts` joins compact decision/status fields for exact global counts and page
  admission, then loads snapshots, dispatch payloads, run errors, and steps for that page. Steps are
  grouped once per run. The result projection reads at most 640 UTF-8 bytes per output column and
  applies the original JavaScript 160-unit preview slice. Empty strings, nulls, embedded NULs,
  multibyte text, surrogate slicing, malformed JSON, nested steps, and structured/plain precedence
  retain their behavior. An explicit empty-blob case avoids SQLite `substr()` converting it to null.
- The three adjacent test files cover tied histories, missing lineage, reprocess fallback, unknown
  versus zero usage, full-selection counts, later filtered cursors, missing runs, skipped attempts,
  malformed title data, exact retry targets, and output preview boundaries.

The Node capability serves these projections through the authenticated workflow routes. The
custody broker transports their serializable responses to the client read cache and workflow run,
record-history, and task navigation consumers. Their route, response, capability, cache, and
renderer contracts stay compatible. Device/task authorization stays ahead of reads. Execution,
retry, processing admission, full detail, named outputs, retained attempts, and persisted rows keep
their authority and data. No migration, index, history cap, or execution-data deletion was needed.

Timestamp ties explicitly use SQLite row insertion order, matching the prior full-scan navigation
and stable task-history sort. Compact projections remove the measured body transfer first. A
latest-per-task SQL rewrite and additional indexes were not needed for this workload. Navigation
still reads all historical descendant scalar rows.

`docs/workflows.md` and `docs/workflows/execution.md` describe the shipped read behavior. The
performance index links this record, and the requested `docs/future/performance/24-workflow-reads.md`
assignment has been deleted.

## Paired evidence

The probe is `unit24-node-probe.mjs`. It uses actual disposable plugin SQLite with the migrations,
10 roots and 1,000 historical children, a 100-run list, repeated task history, and a 300-child,
four-step processing selection. It captures complete returned objects, selected string and binary
bytes, selected rows, CPU, elapsed time, query plans, and owner/probe SHA-256 hashes.

The authoritative pairs are `unit24-{workflow,processing}-{before,after}-verified.json`.
Before replays the three original production owners from commit
`4b8a611af8a474d3ddeb2aeab0e1be9df45a2e04` in disposable modules with current unchanged dependencies.
Those owner hashes match the fresh baseline captured before editing. The same final probe hash is
`f2c5ba0881418ed00f697a0aec441030e8c5fe46e5e394f1de9169f156ebd875` on both sides.
`unit24-comparison.json` records deep equality for all 10 returned objects, including global counts,
later pages, full snapshot/named outputs, and attempt history.

| Read | Selected rows before / after | Selected value bytes before / after | CPU ms before / after |
| --- | --- | --- | --- |
| Task navigation | 1,010 / 1,010 | 33,292,920 / 55,770 | 190.062 / 14.552 |
| 100-run list | 100 / 100 | 3,296,500 / 5,300 | 32.692 / 9.500 |
| One child task history | 6 / 6 | 197,756 / 41,782 | 0.804 / 0.634 |
| First 50, all | 2,401 / 551 | 22,407,792 / 560,287 | 63.157 / 13.293 |
| First 50, failed | 2,401 / 551 | 22,407,792 / 560,467 | 39.942 / 6.363 |
| Later all, after 49 | 2,401 / 551 | 22,407,792 / 560,447 | 42.706 / 5.465 |
| Later failed, after 99 | 2,401 / 551 | 22,407,792 / 561,347 | 33.982 / 9.642 |
| Empty attention filter | 2,401 / 301 | 22,407,792 / 9,897 | 38.617 / 1.865 |
| Full snapshot and outputs | 9 / 9 | 74,787 / 74,787 | 2.177 / 2.388 |
| Full attempt history | 10 / 10 | 74,822 / 74,822 | 3.450 / 3.954 |

Value bytes include binary prefixes: 128,000 bytes for each 50-record page. Excluding them would
understate the after cost. Page reads fall from six selects to four, or two for an empty filter.
The compact join uses the selection-position index and primary-key lookups; page steps use the
run/step index. Query plans are stored separately from measurements.

Preserved `before.json` and `after.json` files are preliminary evidence without binary prefixes.
`before-final.json` and `after-final.json` add the complete-detail workload but used successive
instrumentation versions. The `verified` pairs supersede them. Historical area-14 artifacts remain
unchanged. CPU and elapsed times are single samples under concurrent branch activity. These results
prove reduced selected data and compatible answers, not retained heap or visible navigation latency.
Full detail intentionally retains its input cost.

## Verification commands and outcomes

```sh
rtk proxy node --expose-gc --import tsx plans/performance/unit24-node-probe.mjs workflow before-verified 4b8a611af8a474d3ddeb2aeab0e1be9df45a2e04
rtk proxy node --expose-gc --import tsx plans/performance/unit24-node-probe.mjs processing before-verified 4b8a611af8a474d3ddeb2aeab0e1be9df45a2e04
rtk proxy node --expose-gc --import tsx plans/performance/unit24-node-probe.mjs workflow after-verified
rtk proxy node --expose-gc --import tsx plans/performance/unit24-node-probe.mjs processing after-verified
rtk proxy node plans/performance/unit24-compare.mjs
rtk proxy pnpm --filter @acorn/plugin-workflows test src/server/runs/read/projection.test.ts src/server/runs/read/readModel.test.ts src/server/processing/readModel.test.ts src/server/processing/store.test.ts src/server/routes/workflow.test.ts src/server/dispatch src/server/runs/workflowAgentSession.test.ts
rtk proxy pnpm --filter @acorn/plugin-workflows lint
rtk proxy pnpm --filter @acorn/node exec vitest run test/integration/plugins/workflowRunner.test.ts test/integration/plugins/workflowTasks.test.ts test/integration/plugins/workflowFiles.test.ts --maxWorkers 3
rtk proxy pnpm --filter @acorn/arch-tests test docPaths.test.ts
rtk proxy pnpm lint
rtk proxy pnpm dev:agent -- --session unit24-workflow-reads
```

The focused workflow suites pass 122 tests across 10 files. Workflow TypeScript passes.
The comparison asserts equality of the parsed complete `answer` field for each paired measurement
and identical probe hashes. The first output-prefix test run caught an empty-string/null regression;
the SQL empty-blob case corrects it, and the focused suites pass afterward.

Node integration passes 31 tests across three files. Documentation path/link checks pass three
tests. Targeted oxlint passes all changed workflow modules, tests, and probe scripts. `git diff
--check` passes. Repository `pnpm lint` fails before its type phase on concurrent edits in
`plugins/agents/src/server/sessions/sessionRepository.ts`: unused imports `desc` and `sql`. Earlier
lint also caught unused destructuring in this unit's probe; those bindings have been corrected.
Other agents' files were not edited to resolve their in-progress lint failures.

## Native verification and limits

The native launcher fails during `@acorn/node` staging: the service static graph measures
3,080,127 bytes against a 3,062,000-byte ceiling. An isolated Vite build replacing only the three
workflow readers with their baseline source also fails at 3,071,923 bytes. Concurrent edits mean
these figures are diagnostic samples, not an exact attribution of bundle growth. This unit adds
projection code to the static graph; the branch already exceeds the gate without it.
The ceiling remains unchanged. No Tauri window starts, so history/filter/revisit screenshots and
native visible timing remain unverified. Node version is v24.11.0 on macOS; pnpm reports that it is
below the repository engine range. No provider execution or normal-profile data was used.

Every probe closes its plugin database and removes its temporary fixture in `finally`. The failed
native session has no live child and is retired. Temporary baseline builds are removed after review.
Other agents' source edits and staged work are excluded from this unit's commit.
