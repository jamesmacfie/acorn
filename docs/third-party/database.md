# database → loaded plugin

**Blocker: `agentContexts`, same as [http](./http.md).** Read that one first — this is the same
shape, smaller, with one question http does not have.

## Status of its capability

`docs/first-party-plugins.md` qualified this move with "if nothing else needs `DATABASE`".
Resolved: **nothing does.** `DATABASE` is `routeCapability<DatabaseBridge>('database.route')`,
declared in `server/routes/database.ts` and provided in the plugin's own `init` — a route-capability
the plugin uses to wire its own handlers, not a cross-plugin seam. Grepping the tree for consumers
outside `plugins/database/` returns nothing but core's unrelated `DATABASE_FILENAME` constant.

So the capability is not a blocker and does not need a contract entrypoint. It stays internal.

## What it does today

| Piece | Where | Becomes |
| --- | --- | --- |
| Own SQLite + migrations | `node/`, `server/` | `migrations` in the manifest, `ctx.storage.open()` |
| Routes under `/v2/p/database` | `server/routes/database.ts` | `ctx.routes.fetch` |
| Route capability | `DATABASE` | Unchanged, internal |
| Query pane | `client/paneContribution` | `frame` pane |
| Agent context | `client/` | Blocked, same carrier as http |
| Postgres access | `main/` engine + `core.proc` / connection settings | `exec` where it spawns, `secrets` for credentials |

No rail source, no settings page, no content links. Smaller than http in every dimension.

## The one question http does not have

**Should the query pane be a frame at all?**

This is a database client: a query editor, result grids that can be large, keyboard-driven
navigation. Three things to check before committing, because a frame is a different rendering
environment and this pane is the most latency- and interaction-sensitive of the four candidates:

- **Result-grid size.** Rows cross the bridge as structured-clone payloads. A 50k-row result is a
  different proposition through a port than through an in-realm query cache. Measure with a real
  result set before porting the UI, not after.
- **Keyboard.** A frame owns its own focus and key handling; shell chords do not reach into it and
  its keys do not leak out. For a pane people drive by keyboard, check the boundary feels right
  rather than assuming.
- **Editor.** If the pane embeds Monaco, the frame bundles its own copy — which works, and costs
  bundle size the shell already pays elsewhere. Fine, but know it before it surprises you.

If any of those comes out badly, that is a **finding worth more than the migration**: it would be
the first evidence of a surface class the sandbox does not serve well, and it belongs written up
rather than worked around. The honest outcome may be "database stays first-party because dense
data grids want the realm" — and that is a legitimate result, not a failed port.

## Why you might do this one

Weakest case of the four, and the file should say so. It adds nothing over http on the storage
path, has no integration provider to exercise, and its pane is the riskiest to move. Do it only if
one of these applies:

- You want the frame-performance answer above, deliberately, as an experiment.
- The Postgres engine's release cadence starts diverging from acorn's.

Otherwise leave it compiled in. "Fewer built-ins" is not a goal.

## Manifest sketch

```jsonc
"permissions": {
  "api": ["core.tasks:read", "core.projects:read"],
  "node": { "core": ["tasks", "projects:read", "prefs"], "secrets": true, "exec": true, "net": [] }
},
"migrations": "./migrations",
"contributions": {
  "frames": [{ "target": "pane", "id": "database", "label": "Database", "glyph": "database", "order": 55 }],
  "agentContexts": [ /* once the carrier exists */ ]
}
```

`exec: true` is the line to look at twice. It is the process-broker grant, it is one of only two
permissions that need their own manifest boolean rather than a facet token, and it is what the
trust prompt renders as "Run commands on the node". If the plugin can reach Postgres without
spawning anything — a client library over a socket rather than `psql` — drop it. Check before
declaring; this is exactly the over-declaration rung 1 exists to discourage.

## Done when

Everything in http's list except the source and settings surfaces, plus a documented answer to the
frame-performance question — including, if that is the answer, "this pane should stay first-party
and here is the measurement".
