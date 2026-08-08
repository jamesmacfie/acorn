# WP-02 — Characterization tests for thin areas

**Effort:** M · **Depends on:** nothing · **Do early** — later packages land refactors in exactly
these areas (WP-07 touches notes/memory, WP-10/11 touch agents and docker).

## Context

Four packages have test:src LOC ratios well below the repo norm (~0.3), and five directories with
four or more source files have no colocated tests at all. See [BASELINE.md](BASELINE.md)
§ Test-thin spots for the frozen numbers and the re-measurement command.

Characterization tests **pin current behavior** — they document what the code does today so later
refactors can prove they changed nothing. They are not a review of whether the behavior is right.

Repo test conventions (`docs/testing.md`): vitest everywhere, tests colocated as `src/**/*.test.ts`,
composition-root behavior tested in `apps/node/test/integration`, route protection tested through
the real `createApp()`, and non-vacuity — a test that asserts source shape must fail when the
behavior is removed. Note: tests are node-environment only, no Solid rendering plugin — a `.tsx`
component cannot be render-tested; test its extracted pure logic instead.

## Pre-flight

```sh
# still thin?
for p in plugins/linear plugins/rollbar plugins/docker; do
  s=$(git ls-files "$p/src/**" | grep -E '\.tsx?$' | grep -v '\.test\.' | xargs wc -l | tail -1 | awk '{print $1}')
  t=$(git ls-files "$p/src/**" | grep -E '\.test\.tsx?$' | xargs wc -l | tail -1 | awk '{print $1}')
  echo "$p $t/$s"
done
# still test-free?
for d in plugins/database/src/client plugins/terminal/src/contract plugins/notes/src/client \
         plugins/linear/src/server packages/node-core/src/main/agentProfiles; do
  echo "$d: $(ls $d | grep -c test)"
done
```

## End state

Each listed area has focused characterization tests over its highest-value seams. No source file is
modified except where a tiny extraction (a pure function pulled out of a component) is needed to
make logic testable — flag any such extraction in the commit message.

## Non-goals

- `plugins/workflows` engine — already covered by
  `apps/node/test/integration/workflowRunner.test.ts` (552 LOC). Record, skip.
- Coverage thresholds or tooling (`docs/analysis.md` deferred them deliberately).
- Component render tests (no Solid test environment exists — do not add one here).
- Refactoring the code under test.

## Slices (one commit each)

Per slice: read the directory, identify the pure/parsing/normalizing seams, write tests against
them. Priorities:

1. **`plugins/linear/src/server`** (4 files, zero tests, package ratio 0.09) — provider
   normalization and route shapes; test through `createApp()` where routes are involved.
2. **`plugins/rollbar/src/server`** (ratio 0.13) — `provider.ts` (403 LOC) normalization paths;
   note the repo memory that its field mappings came from docs, not live payloads — pin what the
   code does, and mark fixtures as synthetic.
3. **`plugins/docker`** (ratio 0.17) — `src/main/parse.ts` (3 `JSON.parse` sites) and
   `src/client/dockerPrefs.ts` merge/migration logic. These directly de-risk WP-11.
4. **`plugins/database/src/client`** (8 files) — extractable pure logic only (query building,
   result shaping); skip the pane component itself.
5. **`plugins/notes/src/client`** (5 files) — pure logic; de-risks WP-07's namespace move.
6. **`plugins/terminal/src/contract`** (5 files) — contract shapes and pure functions; cheap and
   fast.
7. **`packages/node-core/src/main/agentProfiles`** (4 files) — profile resolution logic; de-risks
   WP-10d's regroup.

Not every slice must produce many tests — if a directory turns out to be all thin glue with nothing
worth pinning, write the one test that proves the glue holds and say so in Progress.

## Gates

Per slice: `pnpm --filter <touched package> test` and `pnpm lint`. No e2e.

## Risks & rollback

Additive-only; every slice reverts by deleting its test file. Main risk is vacuous tests — apply
the non-vacuity rule: sabotage the code locally once, confirm the test fails, revert.

## Doc updates

None (no contracts change). If a test reveals the docs misdescribe behavior, fix the doc in the
same commit and note it.

## Done criteria

- [x] Ratios for linear/rollbar/docker measurably improved (re-run BASELINE command, record).
- [x] All five test-free directories have at least one colocated test file.
- [x] Every new test failed at least once under deliberate sabotage.

## Progress

Measured in the current worktree with `rg --files` (including the new tests), the test/source
ratios are Linear `259/1968` (`0.13`), Rollbar `331/2257` (`0.15`), and Docker `490/2676`
(`0.18`). Each formerly test-free directory now has at least one colocated test. Existing
Rollbar normalizer and Docker parser suites were retained and extended at their missing seams.
The full `@acorn/node-core` suite was attempted; its pre-existing TLS/server failures and hanging
MCP tests are environmental. The new agent-profile test passes directly, and `pnpm lint` is green.
Representative sabotage checks made the Linear, Rollbar, Docker, database, notes, terminal, and
agent-profile tests fail before each implementation was restored.

- [x] Slice 1 — linear/server
- [x] Slice 2 — rollbar/server
- [x] Slice 3 — docker parse + prefs
- [x] Slice 4 — database/client
- [x] Slice 5 — notes/client
- [x] Slice 6 — terminal/contract
- [x] Slice 7 — agentProfiles
