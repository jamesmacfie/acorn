# Phase 6: enforcement

Status: not started. Waits on phase 5.

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
directories that this programme moved (`src/main/`, `src/app/client`, `client-core/src/ui`): a
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

- A scratch `plugins/agents/src/main/x.ts` (new) fails `tools/arch`.
- A scratch `plugins/github/src/contract/x.test.ts` (new) fails `tools/arch`.
- A scratch `docs/nope/` citation in root `README.md` fails `docPaths`.
- A pull request against `main` shows a lint and a test check.
- `pnpm ls -r --depth -1` shows a description for every package.

## Verify before building

- `.github/workflows/` still holds only `build-desktop.yml`.
- `tools/arch/docPaths.test.ts` still walks only `docs/` and still excludes `docs/reviews/`.
- `tools/arch/boundaries.test.ts` still has no folder-shape rule for plugin `src/` children.
