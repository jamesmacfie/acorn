# Phase 6: enforcement

Status: shipped 2026-08-30.

## Goal

The layout phases 2 to 5 built is held by tests, and those tests run on every pull request. A new
plugin folder outside the seven names fails, a test under `contract/` fails, a rotted path in the
root docs fails, and none of that depends on a developer remembering to run `tools/arch` locally.

## Why this phase, and why now

The architecture doc's stance is "the boundary is a test". The review found the tests are good and
never run in CI: `.github/workflows/build-desktop.yml` runs only the desktop test and dist, on push
to `main`, with no `pull_request` trigger. The path checker exists because 12 paths rotted; it could
not catch the thirteenth on anyone's machine but the author's. Adding the rules before the layout
settles would have meant rewriting them each phase; adding them after means they guard the final
shape.

## Scope

### tools/arch/boundaries.test.ts

1. A folder-shape rule: for every package under `plugins/`, the children of `src/` are drawn from
   `node`, `server`, `client`, `tree`, `contract`, `shared`, `testkit`. Anti-vacuity: at least 15
   packages scanned.
2. No `.test.` file under any `contract/`. The protocol map already has this check; extend it to
   the plugin wildcards.
3. `node/` holds only `index.ts`, `schema.ts`, and their tests.
4. The `side()` list is `server`, `client`, `tree`, `contract`, `shared`, `testkit` for plugins and
   whatever node-core and client-core's top-level folders became. Nothing named `main`, `service`,
   or `wiring` unless a grep shows a survivor with a written reason.
5. The `./main/index.ts` row leaves the allowed-subpaths set. The `./server/index.ts` allowlist
   stays at two.
6. The kit purity rule has no file-level entries (phase 5 done-when).

### tools/arch/docPaths.test.ts

Walk `README.md` and `CLAUDE.md` at the root in addition to `docs/`. Delete the `docs/reviews/`
exclusion; the folder does not exist. Consider a second rule for extension-less citations of
directories that this programme moved (`src/main/`, `src/app/client`, `client-core/src/kit`): a
denylist of retired directory names that may only appear on a line with a `GONE` marker. It is
cheap and it is exactly the rot the extension escape hatch lets through.

### CI

Add `.github/workflows/ci.yml` (new) running `pnpm install --frozen-lockfile`, `pnpm lint`, and
`pnpm test` on `pull_request` and on push to `main`. `pnpm test` bounds Turborepo's concurrency
(`CLAUDE.md` says why), and `turbo run test --continue` is the form that does not cancel siblings on
the first red. `pnpm --filter @acorn/desktop test` needs the staged bundle inputs and the Rust
toolchain; keep it in `build-desktop.yml` unless the CI runner already has both.

### Package descriptions

Add a one-line `description` to every workspace `package.json` (apps, packages, plugins, tools). The
line answers "what is this" for someone reading `pnpm ls`. `docs/first-party-plugins.md` already has
the sentence for each plugin.

### Docs

`docs/testing.md` gains a CI section. `docs/architecture-overview.md` section "Package boundaries"
names the folder-shape rule. `docs/conventions.md` (new) gains a line saying which rules are test-enforced.

## Out of scope

Closing the `./*` exports on client-core, node-core, dashboards-core, and desktop-helper. The
architecture doc already records it as a bigger job; this programme does not take it on.

## Done when

- A scratch `plugins/agents/src/server/x.ts` (new) fails `tools/arch`.
- A scratch `plugins/github/src/contract/x.test.ts` (new) fails `tools/arch`.
- A scratch `docs/nope/` citation in root `README.md` fails `docPaths`.
- A pull request against `main` shows a lint and a test check.
- `pnpm ls -r --depth -1` shows a description for every package.

## Verify before building

- `.github/workflows/` still holds only `build-desktop.yml`.
- `tools/arch/docPaths.test.ts` still walks only `docs/` and still excludes `docs/reviews/`.
- `tools/arch/boundaries.test.ts` still has no folder-shape rule for plugin `src/` children.

## What shipped differently

**The done-when's first line was wrong and is checked another way.** `plugins/agents/src/server/x.ts` (new)
is a legal file: `server/` holds loose modules in every plugin (`concurrencyStore.ts`,
`harnessRegistry.ts`, `webhookService.ts` in agents alone). What the rule refuses is a folder outside
the seven names, so the check run was a scratch `plugins/agents/src/x/y.ts` (new) plus a scratch
`plugins/agents/src/main/`, and both failed as intended. A scratch loose file directly under `src/`
fails too, which the rule as written in phase 1 did not say and now does.

**`node/` needed no migration.** All seventeen `node/` folders already held `index.ts` and, where they
have tables, `schema.ts`. The rule was added as a latch rather than a cleanup.

**The retired-word rule went in as its own test, and covers every depth.** Scope item 4 asked for a
grep and a written reason for any survivor. There were none — no `main`, `service`, or `wiring` folder
anywhere in `apps/`, `packages/`, `plugins/`, or `tools/` — so what shipped is the rule that keeps it
that way, including nested, so `server/main/` cannot bring the word back one level down. `side()` was
left alone: its node list was already `server`, `mcp`, `entries`, `composition`.

**Scope items 5 and 6 were already done.** Phase 4 dropped `./main/index.ts` from the exports-map
regex and the `./server/index.ts` allowlist is still the two vendor clients; phase 5 left the kit
purity rule with no file-level entries. Both were verified rather than changed.

**The retired-directory denylist shipped, and found three rotted paths.** `src/main/`, `src/app/`,
`src/wiring/`, and `src/service/` may now appear in a doc only on a line that also marks them gone.
`client-core/src/kit` was dropped from the list the scope suggested, because `kit/` still exists —
phase 5 kept it. `docs/future/structure/` is excluded: naming the old directory is what these files are
for, and phase 7 deletes the folder. The three real hits were
`docs/future/terminal/phase-3-process-and-auth.md` (two) and `docs/future/terminal/03-process-model.md`,
all citing `packages/desktop-helper/src/main/`, which phase 3 flattened into `src/supervision/`.

**The package-description check became a test as well.** The done-when asked only that `pnpm ls -r`
show a description. A test costs six lines and is what keeps the next new package honest, so it went in
beside the other four.

**CI runs on Linux and excludes the desktop package.** `ubuntu-latest`, not macOS, for two runner
reasons: a macOS runner has no Docker for the container probes, and its `/var` symlink to
`/private/var` is the artefact behind one of the two pre-existing failures `docs/testing.md` lists.
`pnpm test --filter='!@acorn/desktop'` keeps the staging-plus-cargo pass in `build-desktop.yml`, which
already has the Rust toolchain and the runtime cache — so the boot test and the Rust suite gate `main`
rather than the pull request. The first pull-request run is the real check on this; nothing here has
been exercised on a GitHub runner yet.

**`docs/conventions.md` got one section, not a line per rule.** The scope said "a line saying which
rules are test-enforced". Spreading that across nineteen rules would have been eighteen lines saying
"nothing enforces this", so it is one **What a test enforces** section naming the five, plus a sentence
on why the naming rules are deliberately left to review.
