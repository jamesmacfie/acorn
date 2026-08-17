# Dynamic collections: run-once-and-pin, discovery

**Unbuilt, and both parts are gated** on the database plugin's saved-query case actually being
wanted. Two deliverables in dependency order, both about collections whose schema cannot be known at
manifest time.

> **A third gate, found by the verify pass below on 2026-08-17 and answered in
> [`project-database.md`](./project-database.md).** Part 1 assumes a saved query can be exposed as an
> ordinary collection. It cannot be yet: a collection is fetched as `fetch(nodeId, params, signal)` and
> *every* layer of `resolveDbUrl` but the last needs a task worktree, while panels carry no task
> anywhere. The saved-query rows exist in the form this file assumes; the **execution** does not, and
> reading the storage alone makes the gate look met. A second, smaller gap rides along: `toResultSet`
> discards `res.fields[].dataTypeID`, so there is nothing to pin *types* from either. Build
> `project-database.md` first. Two claims below are softened by it — "the pinned definition lives
> node-side, owned by the database plugin" now also means a project-scoped connection with a
> project-addressable trust gate, and "column names, types and kanban eligibility" overstates the third:
> a Postgres OID yields no `enum`, so a freshly pinned collection offers stat/list/table and not board
> until somebody says a column is one.

The baseline they build on (`docs/dashboards.md § Self-describing responses`): every response carries
its schema beside its rows, the manifest `schema` is the optional static case, and Linear declares
none. The consequence, which is what these two exist to remove: **a response-only collection cannot
be configured until it has been fetched once.** The editor reads the answered schema out of the
node's QueryClient (`schemaOf` in `dashboards/editor.ts` over `cachedCollectionPage` in
`dashboards/data.ts`), reactively, so an answer landing while it is open fills the gated sections in
place — but cold it can only offer the three views that ask nothing of the fields, with a notice
saying why.

**The editor issues no fetch of its own, and that is the precondition for everything below.** Whether
an editor may *run* a collection to learn its shape is exactly the question run-once-and-pin answers
properly, with a person pressing a button. Do not answer it a second time with a side effect.

## 1. Run-once-and-pin — the saved-SQL case

**The case.** The database plugin's saved queries as collections: a person writes SQL, whose
columns cannot be known at build time. Self-describing responses were designed for exactly this and
exist; the pinning half does not.

**The flow**: an explicit **Run** in the setup flow executes the query once; the
schema is taken off the response and **pinned** into the collection definition. The editor then has
column names, types and kanban eligibility with no live data needed — the cold case above simply
stops applying to pinned collections.

**Two decisions already made:**

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

**Where this lives in the accepted UX** (`wizard.md`): the Run button's seat is the wizard's
**Data step** — the collection card for a never-run query shows the query text and "Run once to
discover columns", and cold view cards in the View step carry the `cold-schema` reason until it is
pressed. Pinning renders the answered fields as chips on the card with a "pinned <date>" mark. The
drift notice is a warning strip on the affected panel and on the card, naming the change in the
schema's own terms ("`route` is now `path` (text)") with one action, "Re-pin & review mappings",
which runs the `normalizePanel` pass described above. None of this changes the flow decided here —
it names the pixels it gets.

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
without a manifest edit, and disabling the plugin leaves panels over them inert, not deleted — the
existing survival rule, unchanged.

## Verify before building

- `schemaOf` / `cachedCollectionPage` / `createCollectionCacheRevision` — whether the read path still
  looks as described.
- Whether the database plugin's saved-query concept exists in the form run-once-and-pin assumes.
- The `agentContexts` two-route shape — the convention to copy verbatim (envelope, error behaviour,
  provenance stamping).
- The plugin-api surface snapshot — anything exported for plugins here is a deliberate surface
  change.
