# A host-mediated data capability for plugins

Shipped, 2026-09-16. This page is retained as the historical landing path. The implemented behavior
now belongs to:

- [Database plugin](../database.md) — the first consumer, connection lifecycle, pane behavior, and
  workflow query safety.
- [Data layer](../data-layer.md#database-plugin-the-postgres-pane) — task-scoped URL resolution,
  the repo-config trust gate, pooling, catalog invalidation, and ownership.
- [Plugin manifest permissions](../plugin-authoring/the-manifest.md#permissions) — the public
  `ctx.core.data` contract and the `data:query` / `data:write` grants.
- [Security](../security.md#rung-1--permission-shaped-context-phase-1-shipped-with-the-loader) —
  permission-shaped projection and host-side enforcement.

Two live-code findings changed the proposal during implementation. Database sources remain transient,
task-scoped URLs from trusted repo configuration or environment rather than integration-connection
rows; inventing a parallel persisted connection would have changed the product model. The existing
pane also supports row edits and arbitrary SQL, so `data:write` shipped as a separate high-risk grant
instead of silently removing that behavior. Reads use `data:query` and a host-owned read-only
transaction. Core owns `pg`, URL resolution, sockets, pools, catalog caching, timeouts, cell
normalization, and row caps; the loaded database plugin owns its routes, saved queries, SQL editor
workflow, identifier validation, and pane-specific statements.
