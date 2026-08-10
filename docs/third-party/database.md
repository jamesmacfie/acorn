# database → loaded plugin

**Blockers: none in the carrier.** One open measurement, and it now gates editor too.

## What has changed since this was written

This brief predates the rollbar migration and the agent-context carrier.

- **The `agentContexts` blocker is closed**, on both this plugin and http. The manifest carries
  `{ id, label, description?, options, capture }`; the host derives `source` from the plugin id,
  stamps the capture time, measures the bytes itself, and refuses an over-budget capture whole rather
  than trimming it. See [http.md](./http.md) for the detail.
- **The permission sketch below understates what this plugin does.**
  `plugins/database/src/main/database.ts` runs `execFile('bash', ['-lc', script])` on a
  repo-configured script, calls `core.projects.assertConfigTrusted(taskId)` before doing so, and
  calls `core.fs.resolveInRoot`. So the node facets are `projects:config` and `fs`, not just
  `projects:read` — and `exec: true` is not an over-declaration to reconsider, it is honest
  disclosure of something the plugin actually does twice.
- **`plugins/database/package.json` depends on `monaco-editor`.** So the "Monaco in a frame" question
  [editor.md](./editor.md) raises gates this plugin too, not only editor — and it gates it against a
  hard ceiling: client bundles are capped at 8 MiB (`MAX_CLIENT_BUNDLE_BYTES` in
  `packages/node-core/src/main/pluginLoader.ts`, enforced again in
  `apps/desktop/src/app/main/pluginCache.ts`), and `build-plugin.mjs` builds client bundles with
  `minify: false`. Monaco's ESM tree is 30 MB on disk. Whether an unminified Monaco frame fits under
  8 MiB is unanswered and is the cheapest question here to answer first — a spike, before any UI moves.
- **`rollbar.md` no longer exists.** It was cleared along with these four when `docs/third-party/`
  became the review record. The reference is now [README.md](./README.md) plus `plugins/rollbar/`.
- **A plugin package holds no `acorn-plugin.json`.** The manifest is *generated* by
  `apps/node/scripts/build-plugin.mjs` from the plugin's own `acorn-plugin.config.mjs`, so the sketch
  below is a sketch of `plugins/database/acorn-plugin.config.mjs`.
- **The route carrier has a reference implementation**: `plugins/rollbar/src/server/routes/rollbar.ts`.
  Keep the Hono router, hand `router.fetch` over, and carry the `PluginRequestContext` in through
  `c.env` behind a module-level symbol.

Read [http.md](./http.md) first — this is the same shape, smaller, with one question http does not
have.

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
| Agent context | `client/` | `agentContexts` descriptor, same carrier as http |
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
- **Editor.** The pane *does* embed Monaco — `plugins/database/package.json` depends on it — so the
  frame bundles its own copy against an 8 MiB cap, unminified. That is no longer "know it before it
  surprises you"; it is a measurement to take first, and it is the same measurement editor needs.

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
  "node": { "core": ["tasks", "projects:read", "projects:config", "fs", "prefs"], "secrets": true, "exec": true, "net": [] }
},
"migrations": "./migrations",
"contributions": {
  "frames": [{ "target": "pane", "id": "database", "label": "Database", "glyph": "database", "order": 55 }],
  "agentContexts": [ /* as http's, above */ ]
}
```

`exec: true` is the line to look at twice, and the answer here is that it stays. It is the
process-broker grant, one of only two permissions that need their own manifest boolean rather than a
facet token, and what the trust prompt renders as "Run commands on the node" — and
`plugins/database/src/main/database.ts` really does run `bash -lc` on a repo-configured script, in two
places. `projects:config` and `fs` come along for the same reason: the script comes from project
config (guarded by `core.projects.assertConfigTrusted`) and a path is resolved with
`core.fs.resolveInRoot`. This is the honest declaration, not an over-declaration.

## Done when

Everything in http's list except the source and settings surfaces, plus a documented answer to the
frame-performance question — including, if that is the answer, "this pane should stay first-party
and here is the measurement".
