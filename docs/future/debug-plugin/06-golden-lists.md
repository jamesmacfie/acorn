# 06 — The golden-list registration tax: make it regenerable, and write it down

**Strength: Worth exploring. Cheap, but its audience is first-party authors only.**

## The problem, plainly

When someone adds a compiled plugin — or just a new pane, source, or route to an existing one —
CI fails in up to four test files they have never heard of, one after another. Each failure is a
hand-maintained table of literal ids that must be edited to match. The tables exist for good
reasons, but nothing documents them, so every author discovers them the slow way: red CI, read
the test, find the table, add a row, repeat.

## What happens today

The four golden lists a new contribution can trip:

1. `apps/desktop/test/client/parity.test.ts:21-47` — `PANES` and `SOURCES` literals. Contribute a
   pane or rail source without a row here and CI fails.
2. `apps/desktop/test/client/clientPluginDisable.test.ts` (~L66-90) — `FULL` and `OWNED`: a golden
   literal of every compiled contribution id, per registry.
3. `apps/node/test/integration/routeRegistry.test.ts:94-126` — every `/v2/p/<id>/…` route mount as
   a literal.
4. `apps/node/test/integration/pluginDisable.test.ts:199-229` — required-plugin list, owned keys,
   context sections, provider lists.

Meanwhile the documented checklist — `docs/plugins.md § Adding a plugin contribution`
(lines 736-744, six steps) — mentions registering in "the appropriate composition list" and never
mentions any of the four. There is no path from the docs to these files except failing them.

## Why the lists exist (and should keep existing)

They are deliberate ratchets. The disable tests prove that turning a plugin off removes exactly
its contributions and nothing else; the route table proves ownership of every mounted prefix; the
parity test keeps two composition roots honest. The *property* — a reviewed, exact record of what
each plugin claims — is worth keeping. The problem is only the authoring interface: a hand-edited
literal, where the repo already has a better pattern for the same property.

That pattern is the facade's own surface snapshot: `packages/plugin-api/src/surface.snapshot.txt`
is pinned by a test, and growing it is a deliberate act — you run
`UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`, the snapshot regenerates, and the diff
shows the reviewer exactly what changed. Nobody hand-types export names into a table.

## The change

1. **Convert the four goldens to regenerable snapshots.** Derive each table from the registries
   (boot the plugin lists the way the tests already do, dump the ids to a snapshot file), assert
   exact equality against the snapshot, and regenerate behind an explicit env flag
   (`UPDATE_PLUGIN_GOLDENS=1` or reuse the existing convention). Same property, same review
   surface (the snapshot diff), no hand-editing.
2. **Document the ritual.** One paragraph in `docs/plugins.md § Adding a plugin contribution`
   naming every file a new contribution touches — the composition lists, the package.json entries,
   and the snapshot regeneration command. The author should meet the goldens in the docs, not in
   red CI.

## Why it matters, simply

The lists don't get weaker — the diff still shows exactly what a plugin claims, which is what
reviewers care about. What disappears is the scavenger hunt: four surprise CI failures become one
documented command whose output gets reviewed.

## Notes for whoever picks this up

- Keep the assertions exact-set, not subset — the anti-vacuity concern is real (a snapshot that
  only grows can hide a contribution that silently vanished). Regeneration plus exact equality
  preserves that.
- `pluginDisable.test.ts`'s `required` list (agents, memory, notes, terminal) is policy, not
  derivable — leave that part hand-written; it *should* take a deliberate edit.
- The compiled tier is the shrinking tier by decision (loaded plugins have no golden lists — their
  manifest is the record, validated at parse time). That's why this is "worth exploring" rather
  than "strong": spend effort here only while compiled plugins keep being added or reshaped.
- Quick win available independently: the documentation paragraph costs minutes and removes most of
  the pain even if the snapshot conversion never happens.
