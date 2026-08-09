# http → loaded plugin

**Blocker: `agentContexts` has no manifest form.** Everything else is available today. Read
[rollbar.md](./rollbar.md) first for the common mechanics.

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
| Agent context: saved requests | `client/agentContextContribution.ts` | **Blocked** — see below |
| Local drafts | `client/draft.ts` (localStorage) | Bridge `state.get`/`state.set` |
| Use-scoped secrets | `core.secrets` | `secrets: true` in the manifest |

## The blocker, and what closing it looks like

`httpAgentContextContribution` puts "Saved HTTP requests" in the agent composer: `options()` lists
the task's saved requests, `capture()` renders the chosen ones as markdown — method, URL, folder,
auth *mode*, body mode and header *names*, with values, bodies and variables redacted, so an agent
learns the shape of your API without your tokens.

The contract already crosses a boundary cleanly:

```ts
options(scope: { taskId, workspaceId? }): Promise<AgentContextOption[]>
capture(scope, optionIds?): Promise<AgentContextSnapshot[]>
```

Two async functions, plain data out. The manifest form is two routes and a descriptor:

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
`requestsForTask(taskId)` — so node routes are arguably the more natural home. `revision?()` is
the wrinkle: synchronous, used for cache invalidation. Fold it into the options response or let
the existing invalidation ping cover it.

Two things to keep right while moving it:

- **The redaction is the feature.** It runs today on the client, over data the client already
  holds. Moved to a route it runs on the node, over rows read straight from SQLite — so the
  redaction has to move with it, and be tested there. Sending unredacted request bodies into an
  agent's context would be a real leak, and it is the kind that looks fine in review.
- **Snapshot budget.** Context has a 512 KB ceiling (`MAX_AGENT_CONTEXT_BYTES`) shared with notes,
  memory and the PR body. A route that returns everything by default is worse-behaved than the
  current contribution; keep whatever bounding exists.

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
  "agentContexts": [ /* once the carrier exists */ ]
}
```

`net: []` is deliberate and worth a moment: the *plugin* makes no outbound calls of its own — the
user's requests are executed by the node on the user's behalf through existing routes. If that
ever changes, the declaration has to change with it.

## Done when

Installed from a tarball, sending requests, saving them, variables settings working, drafts
surviving a reload, saved requests attachable in the composer with redaction verified **on the
node**, and a migration shipped through an update against a populated database.
