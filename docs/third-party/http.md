# http → loaded plugin

**Blockers: none.** Everything below is available today.

## What has changed since this was written

This brief predates the rollbar migration and the agent-context carrier.

- **The `agentContexts` blocker is closed.** The manifest now carries the descriptor this file
  sketches, near enough verbatim: `{ id, label, description?, options, capture }`, both routes
  confined to `/v2/p/<id>/` at parse time and again on the device. What differs from the sketch is
  what the host keeps for itself — it derives `source` from the plugin id, stamps `capturedAt`, and
  measures the content's bytes rather than believing a plugin's `byteSize`, so the 512 KiB ceiling
  below cannot be talked past. A body it cannot parse yields no snapshots; one over the ceiling is
  refused outright rather than trimmed. `revision?()` has no manifest form and gets none — it is
  synchronous, and a descriptor answers across a fetch — so the "fold it into the options response"
  option is off the table and the invalidation ping is the answer.
- **`activate` has no loaded-plugin equivalent.** `plugins/http/src/client/index.ts` runs
  `activate: () => purgeStoredHttpDrafts()`, and a loaded plugin's client half is a frame bundle, not
  a `ClientPlugin` — there is no lifecycle hook to hang that on. The draft purge needs a new home
  along with the drafts themselves, which the table below already moves to the bridge's
  `state.get`/`state.set`.
- **`rollbar.md` no longer exists.** It was cleared along with these four when `docs/third-party/`
  became the review record. The reference is now [README.md](./README.md) plus `plugins/rollbar/`.
- **A plugin package holds no `acorn-plugin.json`.** The manifest is *generated* by
  `apps/node/scripts/build-plugin.mjs` from its `PLUGINS` table, so the manifest sketch below is a
  sketch of a row in that table, not of a file you add to `plugins/http/`.
- **The route carrier has a reference implementation**: `plugins/rollbar/src/server/routes/rollbar.ts`.
  Keep the Hono router, hand `router.fetch` over, and carry the `PluginRequestContext` in through
  `c.env` behind a module-level symbol, so the same routes run in both tiers.

Read [README.md](./README.md) first for the common mechanics.

## Why this one is worth moving

It is the first candidate that **owns tables**, so it is the only one of the four that proves the
whole storage path: a manifest-declared migrations directory, `ctx.storage.open()`, a plugin
SQLite file bound to the manifest id, and — the part nothing has exercised — an *update* that
ships a new migration to an installed plugin.

That last one is the real prize. Install/update/uninstall are covered by tests and one e2e; a
schema change arriving through the installer, applied at the next boot, against a database with
real rows in it, is not. If a loaded plugin's migration story is broken, this is how you find out
before someone's data does.

It is also a feature plugin rather than an integration, which is a different shape for the tier to
carry: a pane that is the whole product, a settings page, and per-task data.

## What it does today

| Piece | Where | Becomes |
| --- | --- | --- |
| Own SQLite + migrations | `node/`, `server/` | `migrations` in the manifest, `ctx.storage.open()` |
| Routes under `/v2/p/http` | `server/` | `ctx.routes.fetch` |
| Request pane | `client/paneContribution.tsx` | `frame` pane |
| Rail source | `client/sourceContribution.ts` | Descriptor source |
| Settings page (variables) | `client/HttpVariablesSettings.tsx`, lazy-loaded | `frame` settings surface |
| Agent context: saved requests | `client/agentContextContribution.ts` | `agentContexts` descriptor — see below |
| Local drafts | `client/draft.ts` (localStorage) | Bridge `state.get`/`state.set` |
| Draft purge on activate | `client/index.ts` (`activate`) | Needs a new home; no client lifecycle hook |
| Use-scoped secrets | `core.secrets` | `secrets: true` in the manifest |

## The agent context, and what the carrier looks like

`httpAgentContextContribution` puts "Saved HTTP requests" in the agent composer: `options()` lists
the task's saved requests, `capture()` renders the chosen ones as markdown — method, URL, folder,
auth *mode*, body mode and header *names*, with values, bodies and variables redacted, so an agent
learns the shape of your API without your tokens.

The contract already crosses a boundary cleanly:

```ts
options(scope: { taskId, workspaceId? }): Promise<AgentContextOption[]>
capture(scope, optionIds?): Promise<AgentContextSnapshot[]>
```

Two async functions, plain data out. The manifest form — which now exists — is two routes and a
descriptor:

```jsonc
"agentContexts": [{
  "id": "saved-requests",
  "label": "Saved HTTP requests",
  "description": "Capture request shapes with authorization, header values, variables and bodies redacted.",
  "options": "/v2/p/http/context-options",     // GET ?taskId= → AgentContextOption[]
  "capture": "/v2/p/http/context-capture"      // POST { taskId, optionIds } → AgentContextSnapshot[]
}]
```

The data is in http's own SQLite on the node anyway — the client version calls
`requestsForTask(taskId)` — so node routes are arguably the more natural home. `revision?()` is not
a wrinkle any more, it is simply gone: it has no manifest form by decision, and the invalidation ping
covers the freshness it was for.

Two things to keep right while moving it:

- **The redaction is the feature.** It runs today on the client, over data the client already
  holds. Moved to a route it runs on the node, over rows read straight from SQLite — so the
  redaction has to move with it, and be tested there. Sending unredacted request bodies into an
  agent's context would be a real leak, and it is the kind that looks fine in review.
- **Snapshot budget.** Context has a 512 KB ceiling (`MAX_AGENT_CONTEXT_BYTES`) shared with notes,
  memory and the PR body. The host now enforces it on the way in — an over-budget capture is refused
  whole, with nothing attached — so a route that returns everything by default does not leak past the
  limit, it just makes the feature fail for the user. Keep the existing bounding.

## Migrations, specifically

The one part with no precedent, so treat it as the experiment:

- Ship v1 with tables and rows. Confirm the SQLite file lands as `<dataRoot>/plugins/http.sqlite`,
  bound from the manifest id — **do not change the id mid-move**, or existing data is orphaned.
- Ship v1.1 with one added column. Install the update, restart, confirm the chain applied and rows
  survived.
- Try a deliberately broken chain and confirm it fails contained: the plugin is reported failed on
  the roster, the node still boots, and nothing else is affected.
- Confirm uninstall-without-purge leaves the file, and reinstall picks it back up.

## Manifest sketch

```jsonc
"permissions": {
  "api": ["core.tasks:read", "core.projects:read"],
  "node": { "core": ["tasks", "projects:read", "prefs"], "secrets": true, "net": [] }
},
"migrations": "./migrations",
"contributions": {
  "frames": [
    { "target": "pane",     "id": "http",           "label": "HTTP",      "glyph": "globe", "order": 50 },
    { "target": "settings", "id": "http-variables", "label": "HTTP variables", "group": "general" }
  ],
  "sources": [{ "id": "http-requests", "label": "HTTP", "glyph": "globe", "order": 50, "items": "/v2/p/http/rail-items" }],
  "agentContexts": [ /* the descriptor above */ ]
}
```

`net: []` is deliberate and worth a moment: the *plugin* makes no outbound calls of its own — the
user's requests are executed by the node on the user's behalf through existing routes. If that
ever changes, the declaration has to change with it.

## Done when

Installed from a tarball, sending requests, saving them, variables settings working, drafts
surviving a reload, saved requests attachable in the composer with redaction verified **on the
node**, and a migration shipped through an update against a populated database.
