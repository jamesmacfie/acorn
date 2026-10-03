# Testing

This page is the way into acorn's tests: which command to run, where a test belongs, and what to
check by hand before a release. The detail lives in the topic pages under `docs/testing/`.

## Commands

```sh
pnpm test:focus @acorn/node-core src/server/core/git.test.ts
pnpm test --filter=@acorn/node-core
pnpm lint
pnpm --filter @acorn/arch-tests test
pnpm --filter @acorn/desktop test
pnpm db:check
pnpm test
```

[Test commands](./testing/commands.md) says what each one runs, why `pnpm test` limits concurrency,
how the caches work, and how to measure coverage.

<a id="coverage-measurement"></a>

### Focused agent runs

While you edit one file, run `pnpm test:focus <package> <file>`, and add `-t 'test name'` to pick one
case. Name one exact workspace package. The script prepares node-pty once, caps Vitest workers, and
fails if your selection runs no tests.

Before you hand off work:

1. Run `pnpm lint`.
2. Run `pnpm test --filter=<package>` for each package you changed and each package that consumes it.
3. If you changed a plugin manifest, the file layout, renderer adoption, composition, or a doc, run
   `pnpm --filter @acorn/arch-tests test`.

A narrow run doesn't prove that dependent packages pass. `pnpm test` is the full gate. Run it instead
of `turbo run test`, because the script caps concurrency, and tests that spawn processes time out
without the cap.

## Topic pages

<a id="test-layers"></a>
<a id="composition-root-tests"></a>
<a id="testkit"></a>
<a id="non-vacuity"></a>
<a id="the-desktop-boot-test"></a>
<a id="the-browser-smoke-test"></a>
<a id="large-surface-fixture"></a>
<a id="continuous-integration"></a>
<a id="reliability"></a>
<a id="historical-failures"></a>
<a id="the-smoke-checklist"></a>
<a id="memory-acceptance"></a>
<a id="memory-phase-3-acceptance"></a>

| Page | Covers |
| --- | --- |
| [Test commands](./testing/commands.md) | Every command, focused runs, concurrency limits, caching, timeouts, and coverage measurement. |
| [Test layers](./testing/layers.md) | What each runtime's suites cover, composition-root tests, and the testkit. |
| [Architecture rules](./testing/architecture-rules.md) | Rules that read source shape, the kit invariants, loadability, the doc checks, and non-vacuity. |
| [Desktop and large-surface tests](./testing/desktop.md) | The desktop boot test, the Rust unit tests, the browser smoke test, and the large-surface fixture. |
| [Continuous integration](./testing/ci.md) | What CI runs, the Turborepo cache, build checks, reading a red run, and historical failures. |
| [The smoke checklist](./testing/smoke-checklist.md) | The release pass, the index of feature checks, and known gaps. |

These old section names now live in the pages above:

- Test layers, composition-root tests, and the testkit are in [test layers](./testing/layers.md).
- Non-vacuity is in [architecture rules](./testing/architecture-rules.md#non-vacuity).
- Coverage measurement is in [test commands](./testing/commands.md#measure-coverage).
- The desktop boot test, the browser smoke test, and the large-surface fixture are in
  [desktop and large-surface tests](./testing/desktop.md).
- Continuous integration, reliability, and historical failures are in
  [continuous integration](./testing/ci.md).
- The smoke checklist is its own [page](./testing/smoke-checklist.md).
- Memory acceptance is in [memory checks](./testing/memory.md).

## Feature checks

Some behavior needs a real window, a real terminal, or a real provider. Each feature's manual checks
have their own page, indexed in [the smoke checklist](./testing/smoke-checklist.md#feature-checks) and
in [the manual check catalog](./testing/manual-checks.md). The dated results in those pages are
evidence. Don't rewrite them.

Use `pnpm dev:agent` for an isolated desktop session and `pnpm dev:tui:agent` for an isolated
terminal session. [Agent drivers](./local-development/agent-drivers.md) has the commands.
