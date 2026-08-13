# 05 — Storage lifecycle and package config: one owner instead of eight copies

**Strength: Worth exploring. Maintenance-shaped friction rather than a daily trap.**

## The problem, plainly

The host already knows how to open, migrate, and close a plugin's database — it does all three for
loaded plugins through `ctx.storage.open()`. But the eight compiled plugins that own tables bypass
that and each carry their own copy of the lifecycle: a five-line migrations file, a hand-wired
open call, and an identical dispose block. On top of that, every plugin carries byte-identical
copies of the same config files. When any of this needs to change, someone edits eight or
seventeen files that say the same thing.

## What happens today

**The DB lifecycle, hand-rolled eight times.** Eight plugins (agents, changes, database, github,
http, memory, terminal, workflows) each have a `src/node/migrations.ts` whose entire content —
including an identical two-line comment — is:

```ts
export const migrationsDir = (): string => pluginMigrationsFolder('github', import.meta.url)
```

The plugin re-declares its own id to a helper that could derive it from `import.meta.url` alone.
Six then call `openPluginDb(dataDir, '<id>', { migrationsFolder: migrationsDir() })` (which means
they also need `dataDir` plumbed to them), and eight repeat the same dispose block with the same
WAL/data-root-lock comment:

```ts
dispose: () => { db?.close(); db = null }
```

Meanwhile the deep seam already exists one tier over: `ctx.storage.open()` gives a loaded plugin a
migrated, confined, host-disposed `PluginDatabase` (4 callers today). The manifest declares the
migrations directory; the host stages it, applies the chain at boot, and drains the WAL handle
before the data-root lock at shutdown (proven by `apps/node/test/integration/httpLoaded.test.ts`).

**The config clones.** Measured by checksum across `plugins/*`:

- `vitest.config.ts` — 17 copies, **one** md5 between them (byte-identical, comment included).
- `tsconfig.json` — 17 copies, two md5s (16 identical; model-providers differs).
- `drizzle.config.ts` — 8 copies, one md5 (identical except none — even the schema path resolves
  the same way).
- `package.json` — the `exports: {"./*": "./src/*"}` map and the
  `{"lint": "tsc --noEmit", "test": "vitest run"}` scripts block are identical in all 17.

That's roughly 42 files of pure mechanical config. History shows what identical copies cost:
commit `293d41c3` ("reset migrations") rewrote 8 plugins' migration journals in one sweep, and
`ca1b7b37` swept 290 files across all 17 plugins to collapse imports — the archetypal
missing-seam commit. Any change to how plugin tests run, or how migrations are configured, will
be another N-plugin sweep.

## Why it matters, simply

Every copy is a chance to drift and a file someone must touch on the next change. The plugin
author's job is schema and queries; open/migrate/close ordering, and what a correct vitest config
looks like, are the host's job. The direction is already on the record —
`docs/extensibility.md § Where this is going` names confining compiled plugins as the long-term
answer — and adopting the host-owned storage seam is a step of that direction that requires no
tier migration at all.

## The change

1. **Compiled plugins adopt `ctx.storage`.** Let a compiled plugin declare (or have derived) its
   migrations folder, and get its database from `ctx.storage.open()` like a loaded plugin does.
   The host owns open, migrate, and dispose for both tiers. The eight `migrations.ts` files, six
   `openPluginDb` call sites, and eight dispose blocks are deleted. The `dataDir` plumbing into
   those plugins' deps goes with them.
2. **Hoist the config skeletons.** One shared vitest config and tsconfig base that each plugin
   extends in one line (vitest supports config extension; tsconfig has `extends` natively). The
   drizzle config likewise, parameterized by schema path. A new plugin's config becomes three
   one-liners.

## Notes for whoever picks this up

- Start by reading what `PluginStorage`/`openPluginDb` actually differ in:
  `packages/node-core/src/main/pluginStorage.ts`. The compiled callers may use pieces of the
  handle (`batch`, raw access in tests) that the loaded projection hides — the seam may need to
  grow a little, and it must grow for the compiled tier *without* widening what a loaded plugin
  can reach.
- github is the heaviest storage user (its testkit seeds tables directly); do it last. `changes`
  or `memory` is the right first conversion.
- Watch the drain order: dispose ordering at shutdown is a named contract
  (`NODE_DRAIN_ORDER` in `apps/node/src/server/composition.ts:112-121` — plugins before sqlite
  before data root). `ctx.storage`-owned handles already respect it; the conversion must not
  change when each plugin's WAL drains.
- This is not a tier migration, so the "do not migrate for tidiness" rule isn't triggered — the
  plugins stay compiled; they just stop hand-rolling a lifecycle the host owns.
- The `sqlite` story is `node:sqlite` via the repo's shim — never call drizzle's front door
  directly (it statically imports better-sqlite3, which is gone). The existing helpers already
  handle this; keep conversions on them.
- Acceptance: `git grep -l pluginMigrationsFolder plugins/` shrinks to zero;
  `pnpm test` and the plugin-disable integration suites stay green; a schema reset like
  `293d41c3` becomes a one-place change plus regenerated journals.
