# One plugin-state bridge for both composition roots

**Strength: Strong.** Smallest diff of the seven plans, and the repo has already made this exact
move once.

## The problem, plainly

acorn's Node runs in two shapes: supervised by Electron (`apps/node/src/service/runtime.ts`) and
standalone (`apps/node/src/server/standalone.ts`). Both have to hand the server a bundle of eleven
functions that answer "what plugins are installed, which are disabled, install this one, remove
that one" — the `PLUGIN_STATE` capability.

That bundle is written out twice, by hand, once in each file. It's not two implementations of a
shared idea — it's the same code pasted twice, down to the comments (`// Re-scanned per call, not
the boot snapshot:` appears verbatim at `runtime.ts:230` and `standalone.ts:98`). Ten of the last
twelve commits that touched one file touched the other in the same commit. That's two files being
kept in sync by human discipline, which is the thing that always eventually fails.

And it has already failed. The two copies have drifted apart in four ways:

| | Electron-supervised (`runtime.ts`) | Standalone (`standalone.ts`) |
|---|---|---|
| When are `{ path }` installs allowed? | `!config.isPackaged` | `process.env.NODE_ENV !== 'production'` |
| What counts as disabled? | disabled file **∪** start-config list | disabled file **only** |
| Disabled list passed to plugin boot | the union | the file only |
| Bundled plugins reconciled into the data root? | yes (`reconcileBundledPlugins`) | **never happens** |

None of these deltas is written down anywhere, and no test can see them —
`standaloneParity.test.ts` covers the service graph and drain order, not this object.

## How it surfaces

- `docs/architecture-overview.md` says "the service reconciles [bundled plugins] into the writable
  data root before plugin discovery." On a standalone Node that sentence is false: the reconcile
  step simply doesn't exist there. Maybe that's intentional (there's no Electron `resourcesPath` to
  reconcile from) — but nothing says so, so the next person debugging a stale plugin on a standalone
  Node starts from a doc that lies to them.
- The comment above `effectiveDisabled` in `runtime.ts:242-245` describes a real bug class it was
  added to prevent: a plugin disabled at start would report `restartRequired` forever. Standalone
  never got that fix, because the fix landed in one copy of the paste.
- A developer testing loaded-plugin installs sees different behaviour depending on which root they
  boot, because "is this a dev build" is answered by two different questions
  (`isPackaged` vs `NODE_ENV`).

There's a second, related smell in the same data flow. The route file
`packages/node-core/src/server/routes/plugins.ts` contains `state()` (lines 93–167): 75 lines of
pure reconciliation logic — cross-joining "what's on disk" with "what booted" with "what's
disabled" to decide which plugins are running, stale, failed, or need a restart. Because it lives
inside a route, testing it means standing up a Hono app plus a nine-member `PluginsBridge` fixture;
`plugins.test.ts` is 495 lines mostly of scaffolding, and the module even grew a
`setPluginsBridge` back door marked *"test compatibility"* — the classic sign that the real
interface is awkward to test through.

## Why this happened

The seam exists in half-finished form. `apps/node/src/server/pluginDeps.ts` was extracted from
these same two files, for this same reason — its header comment says so. The extraction just
stopped before it reached `PLUGIN_STATE`. The remaining copy-paste isn't a design decision anyone
made; it's the part of a good refactor that didn't land.

## The plan

1. **Extract the builder.** Add `buildPluginStateBridge(options)` next to `buildPluginDeps` in
   `apps/node/src/server/` (same file or a sibling — follow `pluginDeps.ts`'s shape). Options are
   the *actual* differences between the roots, made explicit:

   ```ts
   buildPluginStateBridge({
     dataDir,
     allowLocalPathInstalls: boolean,   // was: isPackaged vs NODE_ENV
     extraDisabled?: () => Set<string>, // start-config list; Electron root only
     bundledDir?: string,               // undefined on standalone = no reconcile, on purpose
   })
   ```

2. **Both roots call it.** Delete the two inline literals. Each root shrinks to one small options
   bag that says what's genuinely different about it.

3. **Decide each divergence deliberately, once.** Unify the dev gate. Give standalone the
   union-of-sources disabled semantics (it currently has the pre-fix behaviour). Decide whether
   standalone should ever reconcile bundled plugins — if the answer is "no, there's nothing to
   reconcile from", write that in `docs/node-distribution.md` so the overview stops overclaiming.

4. **Move `state()` out of the route.** The reconciliation logic and the bridge belong together in
   one module whose job is "what is the plugin situation on this Node, and does it need a restart".
   The route becomes parse → call → respond. `PluginsBridge` shrinks from nine members to the two
   or three the route genuinely needs, and `setPluginsBridge` gets deleted.

5. **Give the parity test teeth.** Extend `standaloneParity.test.ts` to assert the *intended*
   deltas between the roots (e.g. "standalone passes no `bundledDir`") so the next divergence is a
   red test, not an archaeology project. Add plain unit tests for the reconciliation logic — no
   Hono, no fixtures, just objects in and rows out.

## What gets better

- Divergence between the roots becomes structurally impossible instead of a discipline.
- The four existing deltas each become an explicit, documented decision.
- The 75 lines of reconciliation logic — where the actual judgement calls live — get direct tests.
- `plugins.test.ts` loses most of its scaffolding weight.

## Files

- `apps/node/src/service/runtime.ts:228-248` — delete the literal, call the builder
- `apps/node/src/server/standalone.ts:96-108` — same
- `apps/node/src/server/pluginDeps.ts` — the precedent; the builder lives beside it
- `packages/node-core/src/server/routes/plugins.ts:93-167` — `state()` moves out
- `apps/node/test/integration/standaloneParity.test.ts` — asserts the intended deltas
