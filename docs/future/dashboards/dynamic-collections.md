# Dynamic collections: run-once-and-pin, discovery

**Unbuilt, and both parts are gated** on the database plugin's saved-query case actually being
wanted. Two deliverables in dependency order, both about collections whose schema cannot be known at
manifest time.

Shipped baseline (`docs/dashboards.md § Self-describing responses`): every response carries its
schema beside its rows; the manifest `schema` is the optional static case; Linear ships
response-only. The recorded consequence: **a response-only collection cannot be configured until it
has been fetched once** — the editor reads the answered schema out of the node's QueryClient
(`schemaOf` in `dashboards/editor.ts` over `cachedCollectionPage` in `dashboards/data.ts`), issues
no fetch of its own, and cold offers only the three views that ask nothing of the fields, with a
notice saying why.

The third item that used to head this file — making that read reactive — **shipped on 2026-08-16**
(`createCollectionCacheRevision` in `dashboards/data.ts`). An answer landing while the editor is open
now fills the gated sections in place. What it deliberately did NOT do still holds and is the
precondition for everything below: **the editor issues no fetch of its own.** Whether an editor may
*run* a collection to learn its shape is exactly the question run-once-and-pin answers properly, with
a person pressing a button — do not answer it twice with a side effect.

## 1. Run-once-and-pin — the saved-SQL case

**The case.** The database plugin's saved queries as collections: a person writes SQL, whose
columns cannot be known at build time. Self-describing responses were designed for this and
shipped; the pinning half did not.

**The flow, as designed**: an explicit **Run** in the setup flow executes the query once; the
schema is taken off the response and **pinned** into the collection definition. The editor then has
column names, types and kanban eligibility with no live data needed — the cold case above simply
stops applying to pinned collections.

**Decisions carried from the original design:**

- **The pinned definition lives node-side, owned by the database plugin** beside its saved-query
  concept, exposed as an ordinary collection. Dashboards keep addressing `(pluginId, collectionId)`
  and never grow a database special case.
- **Drift is detected, never papered over.** When a later response's schema does not match the pin
  (column renamed, type changed), the host surfaces "schema changed" with a re-pin/re-map
  affordance instead of silently rendering garbage — Grafana handles this loosely (fields just
  vanish) and it is a recurring complaint there. The diff is over field ids and types; a re-pin
  runs the existing `normalizePanel` pass so stale filter/sort/grouping references drop the way
  they do on a collection swap.

**Done when**: a saved SQL query appears as a collection, a panel over it can be fully configured
cold from the pinned schema, and renaming a column in the SQL surfaces a drift notice with re-pin —
not an empty column.

## 2. The discovery route — gated on 1, not before

Collections are manifest-static or compiled-registered today. Saved queries make the set dynamic:
the manifest cannot enumerate what a user will write. The extension is a **discovery route** — the
manifest declares one route that enumerates available collections and their schemas, the two-route
`agentContexts` pattern, with static declaration as the degenerate case.

Constraints, all inherited from the descriptor conventions rather than invented:

- The enumeration is parsed with a real Zod schema in `@acorn/protocol` (core vocabulary, not a
  plugin-named module — `boundaries.test.ts` enforces this), with per-array caps like the manifest.
- The route is confined to the plugin's own route space and re-checked on the device; provenance is
  host-stamped; discovered ids join the same duplicate-id namespace as static ones in the one
  registry.
- References do not change shape: a discovered collection is still `(pluginId, collectionId)`, so
  panels, placements and mappings need nothing.

**Done when**: the database plugin's saved queries show up in the panel editor's collection picker
without a manifest edit, and disabling the plugin leaves panels over them inert, not deleted (the
shipped survival rule, unchanged).

## Verify before building

- `schemaOf` / `cachedCollectionPage` / `createCollectionCacheRevision` — whether the read path still
  looks as described.
- Whether the database plugin's saved-query concept exists in the form run-once-and-pin assumes.
- The `agentContexts` two-route shape — the convention to copy verbatim (envelope, error behaviour,
  provenance stamping).
- The plugin-api surface snapshot — anything exported for plugins here is a deliberate surface
  change.
