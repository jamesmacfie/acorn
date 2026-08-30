# Structure: making the folder names say what the architecture doc says

Status: proposal, 2026-08-30. Not started. Waits on nothing.

This folder is the plan for reorganising the repo so a reader can predict where a file lives without
first reading `docs/architecture-overview.md`. The architecture is documented well and enforced by
`tools/arch/boundaries.test.ts`. The folder names do not carry that meaning. A review on 2026-08-30
(condensed in [01-findings.md](./01-findings.md)) found four root problems, one hygiene list, and
a docs corpus that hides its best material.

Paths in this folder are hints, not promises. Current paths were checked on 2026-08-30. Target paths
are written without a workspace prefix so the path checker does not chase files that do not exist
yet.

## The four problems

**`main/` is a dead word.** It meant "the Electron main process". Electron is gone, the arch test
already treats `main`, `server`, `service`, `mcp`, and `wiring` as one side, and only two of the ten
plugin `main/` folders have an entrypoint. Where a module lands, `main/` or `server/`, is arbitrary:
`agentTools.ts` is under `main/` in five plugins and under `server/` in one, github keeps 43 files in
`server/` and agents keeps 77 in `main/`. `packages/node-core/src/main/` still reads
`electronResourcesPath` in two files. This programme retires the word everywhere.

**Two flat folders hide their structure behind filename prefixes.** `packages/node-core/src/main/`
is 78 files with ten `plugin*.ts` modules doing the job a folder should. `packages/client-core/src/ui/`
is 64 files (37 components, 15 utility modules, 11 tests) and `packages/client-core/src/registries/`
is 60, while `lib/` holds eight leftovers and the three `Ref*` components live under `registries/`
because an arch rule pushed them out of `ui/`. Client-core gets a full regroup into four groups.

**`contract/` versus `shared/` is a rule half the plugins ignore.** The rule is stated in the files
and enforced by the arch test: `contract/` is what another package imports, `shared/` is internal.
Five of github's contract modules have zero external importers, github has no `shared/` folder, and
five test files sit under a `contract/` wildcard export.

**The docs have no front door.** 41 flat files, no `docs/README.md` (new), and the de facto index in
`architecture-overview.md` omits 19 of them. Six plugin docs total 348 KB with two manifest
references. One h2 in `docs/plugins.md` spans 75% of the file.

## The phases

Every phase ends with `pnpm lint`, `pnpm test`, and the `tools/arch` suite green, and with the owning
docs saying the new true thing ([docs-migration.md](./docs-migration.md) says which).

| Phase | What it does | Waits on |
| --- | --- | --- |
| [0: hygiene](./phase-0-hygiene.md) | Deletes and untracks: the `forge` gitlink, `.pnpm-store`, `test-results/`, the stray PNG, `plans/`, the three empty `profiles-*` dirs, the orphan HTML plugin map. Fixes the one dead test. | Nothing |
| [1: docs shape](./phase-1-docs-shape.md) | `docs/README.md` (new), `docs/conventions.md`, the `plugins.md` split, the corrected canonical plugin layout, four renames. | 0 |
| [2: apps](./phase-2-apps.md) | `apps/node` gets `entries/` and `composition/`; `apps/desktop` loses the empty `app/` level and gets `helper/` out of `shell/`. | 1 |
| [3: node-core and desktop-helper](./phase-3-node-core.md) | Finish the `core/` facade migration, merge `main/` into `server/` with real groups, flatten desktop-helper. | 2 |
| [4: plugins](./phase-4-plugins.md) | Retire `main/` in ten plugins, apply the contract rule, subdivide agents and github, apply the naming conventions, drop Electron residue. | 3 |
| [5: client-core](./phase-5-client-core.md) | The four-group regroup: `kit/`, `host/`, `infra/`, `features/`. Re-point the plugin-api facade. | 4 |
| [6: enforcement](./phase-6-enforcement.md) | Arch rules for folder shape and contract tests, the path checker covers the root docs, CI runs lint and test. | 5 |
| [7: docs reference sweep](./phase-7-docs-reference-sweep.md) | Every path and link in `docs/` and `docs/future/` re-checked against the moved tree. Retire this folder. | 6 |

The analysis files are [01-findings.md](./01-findings.md) (what the review found, with counts),
[02-conventions.md](./02-conventions.md) (the naming rules, which become `docs/conventions.md` (new) in
phase 1), and [03-target-layout.md](./03-target-layout.md) (the end-state trees). What was
considered and set aside is in [refused.md](./refused.md).

## Decisions already made

Three choices were put to the owner on 2026-08-30 and settled. They are not re-argued in the phase
files.

- `main/` is retired, not redefined. It merges into `server/` in node-core, desktop-helper, and every
  plugin. The `./main/index.ts` export subpath is dropped; terminal is its only consumer, from two
  call sites in `apps/node/src`.
- client-core gets the full four-group regroup, not targeted fixes.
- `plans/` is deleted. `docs/future/README.md` already says git history is the archive for shipped
  design, and `plans/` contradicted it.

## How this relates

[terminal/](../terminal/README.md) and [client-plugins/](../client-plugins/README.md) both cite
client-core and plugin paths that phases 4 and 5 move. Neither has started, so the cheaper order is
this programme first and those two written against the new tree in phase 7. Nothing in this folder
changes behaviour. If a phase finds itself changing what code does rather than where it lives, that
is a sign it has drifted; stop and file the change elsewhere.

[compiled-tier.md](../compiled-tier.md) and [split.md](../split.md) describe moving plugins between
tiers and repos. Both get easier once every plugin has the same shape, which is the point of phase 4.
