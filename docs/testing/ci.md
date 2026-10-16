# Continuous integration and reliability

This page says what CI runs, how its cache can hide a change, and how to read a red run. Read it
before you change a workflow, add a test that reads files outside its package, or blame a failure on
the environment.

## What CI runs

`.github/workflows/ci.yml` runs on every pull request, every push to `main`, every `v*` tag, and every
manual dispatch:

| Job | Runner | Runs |
| --- | --- | --- |
| Lint | Linux | `pnpm lint` |
| Test | Linux, three shards | `pnpm test` over a third of the packages each, with `ACORN_TEST_CONCURRENCY=1` and `ACORN_TUI_WIDE=1` |
| Desktop | macOS | `pnpm --filter @acorn/desktop test`, on pull requests and `main` pushes only |

The lint job and the three test shards run side by side. Shards 1 and 2 each name four of the slowest
packages in the workflow's `SHARD_1` and `SHARD_2`. Shard 3 runs every other package except the
desktop and the site, so a new package needs no edit. If a shard grows much slower than the others,
move a package between the lists.

The test shards run on Linux for two reasons. A macOS runner has no Docker for the container probes to
find. Its `/var` is also a symlink to `/private/var`, and one HTTP test compares paths against it.

The desktop job installs Rust and caches the pinned Node runtime. The package's `test` script stages
the bundle inputs, builds the renderer, runs Vitest including the boot test, and runs `cargo test`. It
needs no signing secrets and builds no installer.

Tags and manual dispatches skip the desktop job. Once lint and every test shard pass, they call
`.github/workflows/build-desktop.yml`, which builds the bundle inputs once, runs the desktop tests
against them, and packages the same output into signed installers. A broken boot path fails there
before packaging.

`.github/workflows/site.yml` runs the public site's checks and deploys it, on pull requests and `main`
pushes that touch the site or what it reads from. [The public site](../site.md) covers it.

## The Turborepo cache

The workflows cache dependencies and the pinned Node runtime. The lint job and each test shard also
carry their own slice of Turborepo's local cache between runs, so a lint or test task whose inputs
haven't changed is replayed instead of run. The same happens on your machine.

Each job saves its slice even when a task fails, because Turborepo stores only the tasks that passed.
When the cache saved only on green runs, a red streak on `main` meant every run restored a cache weeks
old and replayed nothing.

That makes `turbo.json` part of the test contract. A test that reads a file outside its package must
declare that file as an input. Otherwise a change to the file serves a stale pass. The architecture
suite and the CLI lifecycle suite read too much of the repository to list, so they're never cached.
A green run with 30 of 31 tasks cached says nothing about the task you changed unless its inputs are
declared.

## Build checks

The startup budget checks run in `build` scripts, because they check built output:

- `@acorn/desktop`'s `build` runs `apps/desktop/scripts/check-renderer-budget.mjs` over the built
  `index.html` and Vite's manifest.
- `@acorn/tui`'s `build` runs `apps/tui/scripts/check-startup-graph.mjs` over its startup manifest. It
  also runs `apps/tui/scripts/check-runtime-imports.mjs`, which checks that Node can resolve every
  external import in the emitted modules, including lazy chunks.

Both budget checks fail the build over a byte ceiling or on a denylisted chunk or module name.
[Frontend](../frontend/startup-budget.md) § Startup budget owns what they enforce.

The macOS desktop job builds the renderer but doesn't run the budget check. `build-desktop.yml`
applies it to the real build output. The terminal client's checks run whenever someone builds that
package. Each check has a fixture suite that gates pull requests: `apps/desktop/test/scripts/`,
`apps/tui/src/startupGraph.test.ts`, and `apps/tui/src/runtimeImports.test.ts`.

## Read a red run

The suite launches Git, PTYs, Docker probes, provider fakes, and Node children, so a full run is
sensitive to load. Before you change a production timeout, run the failing package on its own. Don't
weaken a runtime limit to suit a saturated test runner.

The root `lint` script runs oxlint, `oxfmt --check`, `knip --no-config-hints`, and
`turbo run lint --continue`, in that order. If oxlint, the formatter check, or the unused-export check
fails, `tsc --noEmit` never runs. Check which part failed before you assume the types are fine, or
run `pnpm lint:types` on its own. A formatter failure lists the files. Run `pnpm format` and commit
the result.

## Historical failures

Two failures appeared in older runs:

- A live-PTY `posix_spawnp` failure in the `agentSend` tests.
- A macOS `/var` versus `/private/var` path mismatch in `plugins/http/src/server/send.test.ts`.

The full gate passed on Node 24.21.0 on October 3, 2026. If either failure returns, treat it as a new
red gate. Check the code and reproduce it on an unchanged checkout before you blame the environment.
