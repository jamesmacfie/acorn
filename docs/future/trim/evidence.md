# Trim evidence and handoffs

Date: 2026-10-04. Status: investigation evidence; implementation baseline pending phase 01.

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

## Implementation record

No phase is implemented yet. Add one dated section per phase containing:

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
