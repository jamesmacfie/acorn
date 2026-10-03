# Test commands

This page lists the test commands, says what each one runs, and explains the limits that keep a full
run reliable. Read it before you run the suite or change how it runs.

## The commands

| Command | What it runs |
| --- | --- |
| `pnpm test:focus <package> <file> [-t <name>]` | One file or one test case. Use it while you edit. |
| `pnpm test --filter=<package>` | One package's full suite through Turborepo. |
| `pnpm test` | Every suite. This is the full gate. |
| `pnpm lint` | oxlint, then `tsc --noEmit` in every package. |
| `pnpm lint:types` | `tsc --noEmit` in every package, without oxlint. |
| `pnpm --filter @acorn/arch-tests test` | The repository-wide architecture rules, including the doc checks. |
| `pnpm --filter @acorn/desktop test` | Stages the bundle, then runs the desktop Vitest suites and the Rust unit tests. |
| `pnpm --filter @acorn/cli test` | The CLI suite. |
| `pnpm db:check` | Replays every SQLite migration chain. |
| `pnpm test:coverage` | Coverage for four contract paths. See [measure coverage](#measure-coverage). |

## Run a focused test

Run `pnpm test:focus @acorn/node-core src/server/core/git.test.ts` while you edit one file. Add
`-t 'test name'` to pick one case. Name one exact workspace package. The script refuses a selector
that matches more than one package, so each run has one report.

The script prepares node-pty once and runs Vitest in that package with three workers, or two for the
TUI. It passes your file and name filters through, and it fails if the selection runs no tests. It
checks only the cases you selected. A plugin with no tests still passes its own package command.

## Check your work before handoff

There is no automatic selection of changed files. Before you hand off work:

1. Run `pnpm lint`.
2. Run `pnpm test --filter=<package>` for each package you changed.
3. Add a `--filter=<package>` for each package that consumes it. For a shared protocol or client
   contract, include the Node, plugin, desktop, and TUI packages that use it.
4. If you changed a plugin manifest, the file layout, renderer adoption, or composition, run
   `pnpm --filter @acorn/arch-tests test`. That suite holds the repository-wide adoption scanner and
   the other uncached rules.

A narrow run doesn't prove that the packages depending on yours pass. `pnpm test` is the full gate.

## Why `pnpm test` limits concurrency

`pnpm test` rebuilds native modules for plain Node, then runs Vitest through Turborepo. It reports
every package instead of stopping at the first failure. Run it instead of `turbo run test`, because
the script sets two limits that keep the suite reliable:

- **Six packages at a time.** Set `ACORN_TEST_CONCURRENCY` to change it. CI sets it to one.
- **Three Vitest workers per package**, through `VITEST_MAX_WORKERS`. The variable overrides any
  `maxWorkers` in a package's config. Set it to try another value.

Many tests spawn a real subprocess, mint a certificate, or run Git. Without the limits, the machine
runs out of capacity and those tests time out, even though they pass on their own. Measured on a
12-core machine:

| Setup | Workers at once | Full suite | Timeout failures |
| --- | --- | --- | --- |
| Six packages, no worker cap | About 66 | 476 seconds | 19 |
| Six packages, three workers each | 18 | 241 seconds | 6 |
| Six packages, four workers each | 24 | 259 seconds | Not recorded |

On a four-core CI runner, six uncapped packages made tests 10 to 15 times slower than they run
locally. Running one package on its own, with `pnpm --filter <package> test` or `vitest run`, leaves
the worker cap off and uses every core.

The TUI suite also caps its own forks at two. A cold shell transform across many forks can miss a
fixture deadline under load, and package concurrency alone doesn't bound Vitest workers.

The desktop package's `test` stages the bundle inputs first, including a build of the plugin SDK for
bundled plugin imports. It then runs its Vitest suites and the Rust unit tests, so the boot test
runs against fresh artifacts.

## Turborepo caching

Turbo's `topo` transit task hashes the source, testkit, manifests, migrations, and configuration a
package hands to its consumers. It leaves assertion files to the package that owns them. Two test
tasks hash extra inputs:

- The client-core test task hashes plugin and desktop CSS, plus the stylesheet list in
  `apps/desktop/scripts/stage.mjs` that its stylesheet checks read.
- The Node test task hashes every loadable plugin config and package manifest that its config check
  reads.

The architecture suite isn't cached, because it scans the whole repository, including added and
deleted files. The shared browser setup is a root dependency, so editing it invalidates every test
task. CI caching is in [continuous integration](./ci.md).

## The Vitest module cache

Every Vitest config except `plugins/agent-cost` turns on `experimental.fsModuleCache`. Vitest keeps
each compiled module in `node_modules/.experimental-vitest-cache` at the repository root, keyed on the
file's path, its content, and the config. It clears the whole cache when `pnpm-lock.yaml` changes. A
change to a core package reruns most suites, but only the edited files compile again. The agents
plugin's suite took 20 seconds without the cache and 15 seconds with a warm one.

The option is experimental. If a run reports a module that doesn't match its source, run
`npx vitest --clearCache` in any package and try again.

## Timeouts

Suites that start real processes or open real databases use a 20-second test and hook timeout instead
of Vitest's five-second default. The settings are in `packages/node-core/vitest.config.ts`,
`packages/custody/vitest.config.ts`, `apps/node/vitest.config.ts`, and `plugins/vitest.shared.ts`. A
real hang still fails. It takes longer to say so.

## Measure coverage

`pnpm test:coverage` runs focused Vitest suites for four contract paths. It writes JSON summaries to
`.coverage/<path>/coverage-summary.json`. Each target names its source files, including files that no
test imports:

| Target | Tests | Source in the report |
| --- | --- | --- |
| Protocol plugin contract | `packages/protocol/src/plugin/` | `packages/protocol/src/plugin/**/*.ts` |
| Node plugin loader | `packages/node-core/src/server/plugins/` | `packages/node-core/src/server/plugins/**/*.ts` |
| Client frame bridge and host | `packages/client-core/src/host/frames/`, including `PluginFrame.test.tsx` | `packages/client-core/src/host/frames/**/*.{ts,tsx}` |
| Workflow execution | Seven suites covering dispatch, child lifecycle, maps, nested runs, processing, projection, and schedules | `runs/runner.ts`, `steps/execution.ts`, `dispatch/dispatcher.ts`, `dispatch/childLifecycle.ts`, `processing/rules.ts`, `runs/read/projection.ts`, and `schedules/service.ts` under `plugins/workflows/src/server/` |

Use the report to find untested branches before you change one of these boundaries. It isn't a
coverage percentage for the repository, and no threshold is set. Integration tests in other packages
can exercise a contract without showing up in its report. The Node plugin worker runs in a separate
thread, so its source shows as uncovered in this in-process V8 report even when loader tests exercise
it.
