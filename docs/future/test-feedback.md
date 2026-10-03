# Faster agent test feedback

Date: 2026-10-03

Status: Implemented and verified.

The shipped command and cache contracts are in [Testing](../testing.md). This record keeps the
measurement and the follow-up boundary. The implementation uses the task branch created from
`327d6e2582abf36f829b2ccf5167985263f17025`.

## Scope delivered

- `pnpm test:focus` runs an explicit package selection with one native preparation step, bounded
  workers, forwarded Vitest filters, and a nonempty result check. Normal package and root commands
  keep their existing empty-package and complete-gate behavior.
- Turbo's transit hash excludes pure assertion files while owner test tasks still include them.
  The repository-wide primitive adoption scan moved to the uncached architecture suite. CSS and
  plugin-config filesystem readers retain explicit inputs, and the shared jsdom setup is declared.
- The TUI fixture reports outstanding requests to the harness. A press waits for fixture work and
  render frames; frame holds and timeouts reject with diagnostics. The real renderer and key path,
  slow transport delay, and reachability budgets remain in use.

Review fixes: frame releases now belong to the surface that acquired them, so a callback arriving
after a surface reset cannot consume a new hold or schedule its paint. The focused command launches
pnpm through its JavaScript CLI with Node when available and requires one exact package name. The
client-core stylesheet task hashes the exact desktop staging script whose `FRAME_STYLES` list it
reads.

## Measurement environment

macOS arm64, 12 logical CPUs, 32 GiB RAM, Node 26.8.1 for paired warm TUI measurements
(supported by `node-runtime.json`), and the exact repository pin Node 24.21.0 for the final full
gate; pnpm 11.0.0. Root test defaults: six package tasks, three Vitest workers per package, and two
workers in TUI. Baselines and final TUI measurements are warm Vitest runs in this worktree. Logs
were kept in `/tmp`.

| Reachability command | Before, old 80 ms press wait | After, completion wait |
| --- | ---: | ---: |
| Default 80 by 24 | 72.77 s; 16/16 passed | 3.72 s; 16/16 passed |
| Wide flag, 80 by 24 plus 120 by 40 | 135.29 s; 25/25 passed | 5.85 s; 25/25 passed |

The first supported-runtime baseline was red because the fixture `window` lacked event listener
methods needed by the editor pane. The repaired baseline passed at default width. An earlier wide
baseline had one exact heading masked by the focused order control's accessible hint; the wide case
now waits for a fixture-backed sidebar count while the 80-cell case keeps its heading marker. No
reachability case or press budget was removed.

## Cache mutation probe

Turbo `run test --dry=json` resolved all package test tasks for each temporary edit; files were
restored after each probe. Node-core, client-core, and memory assertion edits each changed only the
owner test hash. A node-core production edit changed 31 test hashes, including Node, plugins,
desktop, and TUI. A shared node-core testkit edit changed the same dependent set. A memory manifest
edit changed memory, Node, desktop, and TUI. A core migration edit changed its dependent set. A
browser setup edit changed every test hash, including every jsdom consumer. A new plugin stylesheet
changed the client-core scanner hash and consumers; removing it restored the baseline hash. A new
plugin config changed the Node scanner hash; removing it restored the baseline. `ACORN_TUI_WIDE=1`
changed only the TUI test hash. The architecture suite remains uncached and sees repository additions
and deletions on every complete run.

Review mutation: a temporary comment inside desktop `stage.mjs`'s `FRAME_STYLES` changed the resolved
client-core test hash from `e2e3e292da48a881` to `3d0186f1dc1d3a45`. The script was restored.
The scanner's other filesystem reads are client-core local token sheets, plugin and desktop source
CSS, and the plugin-config and manifest reader in Node. Their package or specific cross-package
inputs cover those paths; the repository-wide adoption reader remains uncached.

## Verification and remaining work

`pnpm lint` and `pnpm --filter @acorn/arch-tests test` passed (79 architecture cases). Focused
selection passed a real file, rejected a missing file and empty named selection, and propagated an
intentional assertion failure. Three final default-width repetitions passed 17/17 tests each
(3.80, 3.75, and 3.78 s wall time); three wide repetitions passed 27/27 each (6.10, 6.09, and
6.11 s). The slow two-pane transport case runs at 100 cells by default and adds 120 cells under
the wide flag; 80 cells show only the list, so that specific re-suspending detail subtree is not
present there. The isolated real PTY rendered at 80 and 120 cells, accepted Tab and Enter navigation,
and passed the `navigation` flow from a fresh fixture session. A first flow attempt after manual
navigation failed its initial-screen precondition; both sessions were stopped. The forced bounded
`pnpm test --force` gate passed all 36 package tasks under Node 24.21.0 in 3m33.835s of Turbo time
(214.16 s wall), including the desktop Rust suite. The forced run avoided reusing results produced
under Node 26.8.1. The following bounded `pnpm test` run passed all 36 tasks in 8.078 s of Turbo
time (8.42 s wall), reusing 34 eligible task results; architecture and CLI lifecycle remained
uncached and executed.

The first full run on Node 26.8.1 was red in four packages. Node-core backup timeouts disappeared
on the exact pin. The other failures reproduced in isolated suites from an unchanged HEAD archive:
two unclassified project routes and a component-scoped CSS property in client-core, a stale Rollbar
rail expectation in Node, and a missing config watcher plus stale title-case expectations in desktop
tests. The route table now classifies both reads as permanently unmappable, preserving the existing
denial. The stylesheet scanner recognizes local declarations, and the fixtures/expectations match
their current owners. Their targeted suites and the final complete gate passed.

Review verification: the new frame-owner regression failed before the fix because an old release
painted a replacement surface, then passed with the fix. It also covers duplicate release, normal
settlement, and the bounded lost-hold error. The command behavior suite runs a real named protocol
test, rejects an empty named selection and a multi-package selector, and checks JavaScript CLI
argument boundaries. The frame, reachability, and slow transport suites passed together on the
exact Node pin (20/20). `pnpm lint` passed after these edits. The first bounded complete gate found
one broken path in this document's testing-guide update; it was fixed. Its CLI and TUI socket tests
also hit `listen EPERM` under the sandbox. The same bounded gate with loopback permission passed
36/36 tasks, including architecture 82/82, CLI 48/48, TUI 673 passed and 2 skipped, and
client-core 2283/2283. Turbo reused 32 eligible tasks and ran the four changed or uncached tasks.

Follow-up work remains desktop build/test separation, CLI lifecycle splitting, CI runner sharding,
remote caches, upgrades, broad test deletion, and production performance refactors.

## Verify before building

Reopen `package.json`, `turbo.json`, `scripts/test-focus.mjs`, the Vitest configs,
`apps/tui/src/harness.tsx`, `fixture.ts`, `tree/frames.ts`, `reachability.test.tsx`,
`browseSlow.test.tsx`, the filesystem readers in client-core and Node, and
`tools/arch/primitiveAdoption.test.ts`. Recheck Turbo resolved inputs and actual task executions
after changing any of those contracts.
