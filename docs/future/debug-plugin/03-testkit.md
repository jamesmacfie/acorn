# 03 — A testkit entrypoint: cross the seam in tests instead of reconstructing the host

**Strength: Strong. Knowingly reopens a deliberate deferral — evidence below.**

## The problem, plainly

Production plugin code may only import the host through `@acorn/plugin-api`, and an arch test
enforces it. Test code has no equivalent: there is no way to get a real plugin context in a test,
so every plugin's tests rebuild the host by hand — importing node-core's internal files directly
and forging context objects through `as unknown as` casts. The forgeries drift from the real thing
silently, and a third-party author (who cannot import node-core at all) cannot test their plugin's
node half, full stop.

## What happens today

**The numbers.** 159 import statements in plugin test files reach host internals — 150 into
`@acorn/node-core`, 9 into `@acorn/client-core` — across 46 test files in 13 of the 17 plugins.
These are sanctioned, not accidental: `tools/arch/boundaries.test.ts:298-336` pins a list of 17
allowed module roots and asserts exact set equality. The hottest paths tell you what a test host
would need to provide:

```
30  @acorn/node-core/testkit/db.ts          (temp SQLite AppDatabase, per-plugin migrated DB)
22  @acorn/node-core/server/middleware/auth.ts
20  @acorn/node-core/main/bindings.ts
14  @acorn/node-core/server/db/index.ts
10  @acorn/node-core/server/middleware/requireUser.ts
 8  @acorn/node-core/main/core/secrets.ts
 8  @acorn/node-core/main/core/index.ts
```

**The forged contexts.** Nothing constructs a `NodePluginContext` for tests, so every plugin does
it itself. `plugins/rollbar/src/node/index.test.ts:12-19` is the pattern, repeated in shape across
the 13 plugins:

```ts
const context = {
  routes: { register: undefined },
  providers: { integration },
  core: { projects },
} as unknown as NodePluginContext
rollbarPlugin().init(context)
```

Route tests hand-build full `PluginRequestContext` literals with `as never` casts, and seed core
tables by raw drizzle inserts. Nothing checks any of these mocks against the shape
`server/plugin/host.ts` actually builds — when the host context changes, the tests keep passing
against a shape that no longer exists.

**The smaller absurdity.** Seven client-side tests import client-core deep paths for names the
facade already re-exports (`formatSize`, `synth`, palette model types, and so on). They route
around the barrel because importing `@acorn/plugin-api/client` in a node-environment test feels
risky (see file 08) — so even where the seam exists, tests don't cross it. Across all plugin
tests, imports of `@acorn/plugin-api/client` number exactly zero.

**And nothing validates manifests at test time.** No test checks a plugin's
`acorn-plugin.config.mjs` against the 810-line Zod schema in
`packages/node-core/src/main/pluginManifest.ts`. A malformed config is discovered by running the
builder and then by a boot-time `console.error` (see file 01 for how little of that survives).

## Why it matters, simply

A test is only worth something if it exercises the same surface production uses. These tests
exercise a hand-drawn copy of that surface. When the host changes, the copies stay green and the
real integration breaks — the worst kind of test. And the cost lands twice: plugin authors must
learn node-core's internal file layout just to write a test, and the host team must sweep 13
plugins' tests whenever an internal file moves (commit `79b59761` was exactly such a sweep).

`docs/plugins.md` already names the destination: test-code reach into the host "is a first-party
privilege; a third-party author gets a testkit entrypoint if and when one is built." The evidence
that "when" has arrived: 159 sanctioned leaks, silent mock drift, and a ratchet that polices what
should be an interface.

## The change

Add `@acorn/plugin-api/testkit` (a new facade entrypoint; regenerate the surface snapshot). It
should be built out of the pieces that already exist rather than new machinery:

1. **A real context builder.** `makeTestNodeContext({ plugin, dataDir? })` that constructs a
   `NodePluginContext` using the same code path `host.ts` uses (extract the context-assembly block
   at `host.ts:121-198` into a function both call). A temp data root underneath, via the existing
   `testkit/db.ts` helpers. The mock can no longer drift, because it isn't a mock.
2. **Request helpers.** The principal/gate pair from `testkit/auth.ts` and a
   `PluginRequestContext` builder, re-exported — these cover the 22+10 middleware imports.
3. **A manifest validator.** `validatePluginConfig(configPath)` that runs the real Zod schema and
   returns the issues with paths — so a bad `acorn-plugin.config.mjs` fails in `pnpm test`
   instead of at boot. (The schema is module-level in `pluginManifest.ts`; this is a thin wrapper.)
4. **Shrink the ratchet.** Convert the exact-set list at `boundaries.test.ts:298-336` into a
   shrinking baseline (the repo already uses that pattern elsewhere in the same file), and migrate
   plugin tests to the testkit as they're touched. No big-bang rewrite.

Plugin side afterwards:

```ts
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
const ctx = await makeTestNodeContext({ plugin: rollbarPlugin() })
// ctx is the real shape; ctx.storage.open() is a real migrated temp DB
```

## Notes for whoever picks this up

- Keep the testkit node-environment-safe: no Solid, no `.tsx`, nothing that touches `window`
  (see file 08 — the facade barrels have a documented evaluation gotcha).
- Two integration suites show what "real" means here and are good acceptance references:
  `apps/node/test/integration/pluginLoader.test.ts` (builds and loads an actual package) and
  `httpLoaded.test.ts` (storage/migrations end to end).
- Don't try to cover frame components. Plugin vitest configs are node-env, `*.test.ts` only, no
  Solid transform — a green suite proves nothing about UI in this repo, by design. Frames stay
  covered by live verification; the testkit's job is the node half and the pure client logic.
- The `github` plugin has its own `src/testkit/` that imports node-core directly
  (`githubToken.ts`); it's the natural first migration and will tell you what the shared testkit
  is missing.
- This is additive. Existing tests keep passing while the baseline shrinks.
