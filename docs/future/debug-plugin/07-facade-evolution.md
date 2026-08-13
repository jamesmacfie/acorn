# 07 — The facade's evolution story: prune now, while every consumer is in-tree

**Strength: Worth exploring. The friction is mostly future tense — which is exactly when it is
cheapest to fix. The package is days old; this is the cheapest it will ever be.**

## The problem, plainly

`@acorn/plugin-api` is the contract plugins build against. Today that contract mostly re-exports
the host's own internal shapes rather than plugin-shaped projections of them, carries dozens of
exports nobody uses, and has a version number that nothing forces to change when the surface
changes. While every consumer lives in this repo, `tsc` across the workspace papers over all of
it. The day one plugin builds out of tree, each of these becomes a breaking change nobody planned.

## What happens today

**Host-shaped types dominate the contract.** Of ~130 exports on `/node`, roughly 95 are the
host's own representation and ~35 are plugin-shaped. The sharpest cases:

- `TaskRow` (`packages/node-core/src/main/taskWorktree.ts:37`) is
  `typeof schema.tasks.$inferSelect` — a drizzle-inferred row off core's own `tasks` table,
  returned by `CoreServices.tasks.load()/active()/resolveCwd()`. Rename a column in core and the
  plugin API breaks with no signal: the surface snapshot pins *names*, and its own test admits it
  cannot see a type changing shape under a stable name (`surface.test.ts:14-16`).
- `Env` (`packages/node-core/src/main/bindings.ts:75`) exposes core's runtime bindings —
  `SECRETS`, `ACTIVE_IDENTITY`, `INTERNAL_TOKEN`, and friends. The facade's own comment calls it a
  prune candidate: "a plugin should be reading its env off ctx rather than naming core's."
- `PluginRouteRegistry.register(router: Hono<AppEnv>, …)` puts Hono in the signature, and
  `PluginDatabase` is `ReturnType<typeof drizzleOverSqlite> & …` — so the host's frameworks are
  structurally part of the contract. The result: 13 plugins declare `hono` as their own
  dependency, 8 declare `drizzle-orm`, 16 `solid-js`.

**Dead weight and doc drift.** 52 of the 377 pinned export names have zero consumers. About 13
exports carry `// prune candidate:` comments in the facade source with no `@deprecated` marker and
no removal plan. `docs/plugins.md:43` says "Six entrypoints" — there are seven (`/ui/editor` is
missing from the table; only `docs/future/monaco.md` mentions it).

**The version that can't move.** `PLUGIN_API_MAJOR = '1'`
(`packages/protocol/src/api.ts:294-300`) is compared by exact string match at load, install, and
bundle-resolution time — that part works. But:

- zero plugins read the re-export; it is itself one of the unused names;
- the builder doesn't use it either — `apps/node/scripts/build-plugin.mjs:70` regex-scrapes the
  constant out of protocol *source text*;
- nothing links it to the surface snapshot: you can add, remove, or rename any export, regenerate
  the snapshot, and the version stays `'1'`. Compatibility is verified only by first-party
  compilation, which an out-of-tree plugin never participates in.

## Why it matters, simply

A contract is a promise about what won't change. Right now the promise accidentally includes
core's database schema, core's HTTP framework, and core's process bindings — things the host must
stay free to change. Every host-shaped type on the surface is a place where an internal refactor
silently becomes a plugin break. Pruning and projecting now costs a mechanical in-tree sweep;
doing it after external plugins exist costs a deprecation program.

## The change

1. **Prune the flagged exports.** Delete the ~13 `// prune candidate` exports and the unused names
   (52 minus the ones kept deliberately, like `PLUGIN_API_MAJOR` itself). Each deletion is
   verified free by the consumer counts; regenerate the snapshot.
2. **Project the hot types.** The repo already did this once and wrote the rule down: plugins get
   `ProjectRef` projections, never the row. `TaskRow` is the same problem one entity over — define
   a `TaskRef` (or `TaskInfo`) owned by the plugin contract, return it from `CoreServices.tasks`,
   and stop exporting the drizzle row. Read env off `ctx`; stop exporting `Env`.
3. **Tie surface changes to the version question.** Cheapest useful form: make the snapshot test
   fail when names are *removed or changed* unless the diff is accompanied by either a
   `PLUGIN_API_MAJOR` bump or an explicit "compatible change" marker in the commit. Even a
   CONTRIBUTING note beside the snapshot ("removing a name means bumping the major") beats the
   current nothing. Have `build-plugin.mjs` import the constant instead of regex-scraping it.
4. **Fix the doc drift.** `docs/plugins.md` says six entrypoints; list all seven.

## Notes for whoever picks this up

- Do this *after* file 04 lands (it grows the surface; better to prune and add in one deliberate
  pass than to bump twice).
- The Hono/drizzle question is the hard one — full abstraction of either would be a framework of
  its own, which nobody wants. The realistic line: keep them for the compiled tier (first-party
  code shares the host's frameworks by definition), but be explicit in `docs/plugins.md` that they
  are part of the tier-1 contract, and keep the loaded tier's carriers (`ctx.routes.fetch`,
  `ctx.storage`) framework-neutral. Deciding and writing that line down is most of the value.
- `TaskRow` consumers are findable with `git grep -l 'TaskRow' plugins/` — the projection sweep is
  mechanical.
- Compatibility: pruning is a hard break on an exact-match version. That is the point of doing it
  now — bump `PLUGIN_API_MAJOR` once, honestly, while the rebuild-all-bundled-packages sweep is a
  single command in this repo and no external plugin exists to strand.
