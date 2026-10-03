# Adding a plugin contribution

This page lists the steps and files involved in adding a contribution or a whole plugin, and the
golden lists that record what each compiled plugin claims. It's part of the
[plugin reference](../plugins.md).

## Adding a plugin contribution

[Contribution kinds](../contribution-kinds.md) lists every kind, its tier, and where it's declared.
Read it first, because a kind may already draw what you want. Then follow these steps:

1. Put the behavior in the owning plugin, in the right runtime directory ([package
   shape](./package-shape.md)).
2. Use `CoreServices` instead of importing core modules or another plugin's internals. If it needs
   tables, declare the chain ([data ownership](./data-ownership.md)). Don't open a database.
3. Add a narrow `contract/` export, capability, or client registry entry when another plugin needs to
   collaborate, and `ctx.events` if the renderer needs telling. Name each `permissions.node.core`
   token the contribution needs. An undeclared token is a facet absent from `ctx.core`, and a
   `TypeError` on first call.
4. Register the Node or client entry in the right composition list, named below.
5. Add package-local tests.
6. Regenerate the golden lists and read the diff before you commit it.
7. Run the architecture test, `pnpm lint`, and the relevant tests.

### The files a contribution touches

A contribution inside an existing compiled plugin, such as a pane, rail source, route, tool, or
settings page, touches that plugin's `src/` and the golden lists. A new compiled plugin also touches:

- `plugins/<id>/package.json` and the three one-line config files. Nothing else lists the plugin:
  `scripts/db.mjs` finds `drizzle.config.ts` by scanning, and `pnpm lint` and `pnpm test` reach the
  package through the workspace.
- `apps/node/src/composition/plugins.ts`, the Node activation list. If the plugin needs an adapter
  only the composition root can build, `NodePluginDeps` grows a key, and the adapter goes in
  `apps/node/src/composition/pluginDeps.ts`.
- `apps/desktop/src/client/plugins.ts`, the client activation list. Rail and pane order is a field on
  the contribution, not a position in this list.
- `apps/node/package.json` and `apps/desktop/package.json`, each with
  `"@acorn/plugin-<id>": "workspace:*"` for the half it composes.

A loaded plugin needs one entry in `BUNDLED_PLUGINS` in `apps/desktop/scripts/build-bundled-plugins.mjs`
and its own `acorn-plugin.config.mjs`. It touches no composition list and no golden list, because the
manifest is the record. Some loaded packages have an `apps/node` dependency entry only because that
app's tests import them.

## The golden lists

Four test files hold an exact, reviewed record of what each compiled plugin claims. They're
snapshots, and one command rewrites all four:

```sh
UPDATE_PLUGIN_GOLDENS=1 pnpm --filter @acorn/desktop --filter @acorn/node test
```

- `apps/desktop/test/client/parity.snapshot.json`: every compiled pane with its order and chord, and
  every rail source with its order (`parity.test.ts`).
- `apps/desktop/test/client/clientPluginDisable.snapshot.json`: every client registry entry and which
  optional plugin owns it (`clientPluginDisable.test.ts`).
- `apps/node/test/integration/routeRegistry.snapshot.json`: every `/v1/p/<plugin>/` route the compiled
  plugins mount (`routeRegistry.test.ts`).
- `apps/node/test/integration/pluginSystem/pluginDisable.snapshot.json`: the full Node boot's routes,
  tools, context sections, providers, and databases, and which optional plugin owns each
  (`pluginDisable.test.ts`).

Every assertion is exact equality, so a contribution that disappears fails as loudly as one that
appears. The snapshot diff is where a reviewer sees what a plugin claims, so regenerate in its own
hunk and say why the list moved.

Three things stay hand-written: the `required` list in `pluginDisable.test.ts` (agents, memory, notes,
and terminal), because which plugins can't be turned off is policy; the minimum counts that stop an
exact match against an empty snapshot from passing; and the prose above each snapshot read that
explains what's absent and why.

`pluginDisable.test.ts` compares lists by multiset subtraction: it removes each expected entry once and
reports what's left. Some plugins register several entries under one key, such as GitHub's routers
under `github/repos`, so set subtraction would miss a duplicate disappearing. A route's key names its
owning plugin, so an entry credited to the wrong plugin fails even when the total matches.

Two neighbors work differently. `packages/plugin-api/src/surface.snapshot.txt` pins the facade's
exports and regenerates with `UPDATE_SURFACE=1 pnpm --filter @acorn/plugin-api test`. The exact-set
baselines in `tools/arch/boundaries.test.ts` may only shrink, and no flag rewrites them.
