# The data contract: collections, fields, and rows

Design notes from the dashboards session (2026-08-12). Nothing here is scheduled. This file is the
heart of the folder: the node↔client contract everything else composes over. The design rule it
serves (`README.md`): the field-type vocabulary is where this succeeds or fails — **small,
semantic, closed, versioned**. All JSON in this file is illustrative, not normative.

## Collections

A **collection** is a plugin-declared, typed, queryable set of records: "my open PRs",
"issues assigned to me", "recent occurrences", "this saved query". Declared in the manifest under
a new key, following the existing descriptor conventions:

```jsonc
// illustrative
"collections": [
  {
    "id": "pulls-mine",
    "name": "My pull requests",
    "items": "./collections/pulls-mine",   // route, confined to the plugin's route space
    "refresh": 60,                          // client hint, same 30–86400s bound as other descriptors
    "params": [                             // optional, plugin-owned meaning, host renders inputs
      { "id": "involvement", "type": "enum", "values": ["author", "review-requested", "commented"] }
    ],
    "schema": { "fields": [ /* see below */ ] }  // the static case; optional once responses self-describe
  }
]
```

- `(pluginId, collectionId)` is the **universal reference** — panels, placements, and future
  discovery all address collections this way and nothing else.
- The route is confined to the plugin's route space exactly like every descriptor route; the host
  appends scoping (project/task) and the device re-checks path ownership (`ownsRoute`). A plugin
  cannot choose the node, the namespace, or the cache key.
- `params` are declared inputs the host renders in the panel editor and passes through opaquely —
  the plugin owns their meaning (Grafana's opaque-target lesson, `prior-art.md`).
- Caps and Zod bounds follow the manifest conventions (`pluginManifest.ts` per-array caps).

## The field schema

Each field has an `id`, a display `name`, a **type** from a closed semantic set, and optionally a
**role**. Semantic types — not primitives — are the load-bearing choice: they are what let the
host render a person as an avatar and a datetime as "2h ago", and what let it *derive* which views
a collection supports (`composition.md`).

Candidate type set (the exact list is the first decision to finalize when building — each entry
must earn its place):

| Type | Renders as | Enables |
| --- | --- | --- |
| `text` | plain text | search/filter |
| `number` | formatted number (optional unit) | sort, aggregate, chart axis (later) |
| `boolean` | check/dash | filter |
| `datetime` | absolute + relative ("2h ago") | sort, filter-by-range, chart axis (later) |
| `duration` | humanized | sort |
| `enum` | status dot / chip, with declared `values` each carrying label + tone | **group-by (kanban), filter** |
| `person` | avatar + name | filter ("assigned to me"), group-by |
| `link` | clickable, host-mediated open | click-through |
| `badge` | count pill | glanceable |

Display hints (unit, tone, icon) attach to the **field definition**, never to the panel — the
Grafana `FieldConfig` lesson: they survive view switches.

**Roles** are optional semantic markers on fields — `title`, `status`, `assignee`, `url`,
`updated` — a tiny closed second vocabulary. They exist for one reason: cross-source mapping
(`composition.md`) is tedious if the user aligns every field by hand; roles let the host pre-fill
("both collections have a status-role enum; here is a suggested column mapping"). This is Home
Assistant's `device_class` lesson carried from day one instead of retrofitted (`prior-art.md`).

**The budget discipline.** `refResolvers.ts:12-19` already states it for descriptor vocabularies:
every field added here is a field every provider's answer gets rendered with. Grafana ended a
decade with eight field types; Notion has about a dozen property types. That is the budget. When a
plugin needs something the vocabulary can't express, the answer is a frame pane, not a new type
(`refused.md`).

## Rows, identity, and provenance

```jsonc
// illustrative response
{
  "schema": { "fields": [ /* as declared, or inferred — see self-describing below */ ] },
  "rows": [
    {
      "id": "PR_kwDOA...",                       // stable across refreshes — REQUIRED
      "values": { "title": "…", "state": "review-requested", "updated": "2026-08-12T01:00:00Z" },
      "action": { "kind": "openUrl", "url": "https://github.com/…" }   // closed verb set only
    }
  ]
}
```

- **Stable row identity is required.** Mixed-source boards need it to dedupe across refreshes and
  to key rendering; write-back would need it later.
- **Provenance is host-stamped.** The host attaches `(pluginId, collectionId)` to every row as it
  ingests, exactly as `refResolvers` stamps `providerId` — never read from the response body. A
  mixed board renders source badges and routes row actions on the host's stamp, so a plugin cannot
  impersonate another's rows.
- **Row actions come from the closed verb set** (`PluginChromeAction`), so a click can do exactly
  what a command can do, nothing more. Note that `runNodeAction` already makes verb-shaped
  mutations expressible in v1 ("pick up review", "restart server") — what v1 does not give an
  action is confirmation, optimistic UI, or failure surfacing; it fires, and the panel refetches.

**Reserved seam: destructive and confirmed actions.** An action that destroys something ("delete
worktree") must not ship without arm-to-confirm, and v1 therefore ships no destructive actions at
all. The extension is an optional `risk` (or `confirm`) key on the action descriptor — an
additive optional field on a versioned Zod schema, so adding it later breaks nothing — with the
**host** rendering the confirmation from the declared tier; a plugin never renders its own. The
precedent already exists in the tree: agent tools declare a risk tier
(`AgentToolContribution`, `packages/node-core/src/server/agentTools/registry.ts`) that the host
projects into permission UI. This is recorded so a reviewer knows the v1 omission is deliberate,
and so the growth path is this key on the descriptor — not a new verb, and not plugin-drawn
confirmation UI. (Optimistic updates and failure surfacing are host machinery over the same
contract and need no wire change at all — see the invariant in `README.md`.)

## Self-describing responses, and run-once-and-pin

Responses carry their schema alongside the rows (Grafana's DataFrame move). The manifest-declared
schema becomes the *static* case — a promise about what the route returns, used so the panel
editor can offer views before any data exists. This one decision buys the dynamic case for free:

- **A query-shaped collection needs no manifest schema.** The motivating case is the database
  plugin: a user writes SQL, whose columns cannot be known at manifest time. The setup flow is
  **run once, pin**: run the query, take the schema off the response, save it into the collection
  definition. The editor then has column names, types, kanban eligibility — everything.
- **Drift is detectable.** When a later response's schema doesn't match the pinned one (column
  renamed, type changed), the host surfaces "schema changed" with a re-pin/re-map affordance
  instead of silently rendering garbage. Grafana handles this loosely (fields just vanish) and it
  is a recurring complaint there; pin-and-diff is the better position.

The pinned definition lives **node-side as a saved query owned by the database plugin** (which
already has a saved-query concept), exposed as a collection like any other. Dashboards reference
`(pluginId, collectionId)` uniformly and never grow a special database case.

## Discovery

v1 is manifest-static only. The extension for dynamic collections is a **discovery route** — the
manifest declares one route that enumerates available collections and their schemas, the two-route
`agentContexts` pattern. Static declaration is then the degenerate case. Nothing in the reference
shape has to change: collection ids from discovery are still `(pluginId, collectionId)`. Build
discovery when the database saved-query case lands, not before.

## Freshness

Two knobs, two owners, both already conventional:

- **Node-side TTL is plugin-owned**, via `serveThenRevalidate({ ttlMs })` exactly as github and
  rollbar do today. A collection route is a projection over data the plugin already mirrors.
- **Client-side refresh is per-panel and user-set**, within the existing manifest bound
  (30s–86400s). This is the first descriptor whose refresh policy must be per-contribution rather
  than the shared chrome revision + min-refresh timer — the split the `ponytail:` note at
  `chrome/data.ts:64` reserved for "when a refetch cost shows up". Panels fetch through
  `createFleetQuery`-style machinery and inherit cache-as-fallback and the live/stale/offline
  vocabulary.

## Validation stance

Real Zod schemas in `@acorn/protocol` from day one — the collection schema, the response envelope,
and the row shape — following the `agentContexts`/`refResolvers` template (host fetches, parses,
stamps provenance), explicitly **not** the `PluginRailItems` field-sniff. This is a deliberate
exception to the house rule that reads are not validated: that rule holds "because every consumer
is TypeScript in this repo", and a loaded plugin's response is not — it is untrusted wire the host
renders under its own chrome. All four existing exceptions are exactly this boundary; collections
are the fifth.

The persisted side (panel and dashboard definitions) is versioned from day one — see
`composition.md § The persisted model`.

## What plugins actually have to do

Almost nothing new. GitHub, Rollbar, and Linear each already hold record-shaped data
(`current-state.md § The three data paths`); a collection route is a mapping over the mirror they
already maintain, served through `serveThenRevalidate` they already use. Proving the contract
means expressing GitHub PRs and Linear issues as collections and checking that one schema
vocabulary fits both without strain — that is phase 1 in `README.md`.

## Verify before building

- The Zod manifest vocabulary and its caps (`pluginManifest.ts`), and whether the `refresh` bound
  moved.
- The `agentContexts`/`refResolvers` protocol schemas — the shape conventions (envelope, error
  behavior, provenance stamping) to copy verbatim.
- The chrome freshness model (`chrome/data.ts`) — this design assumes it splits per-panel here.
- `serveThenRevalidate`'s signature and the plugin-owned-TTL convention (`sync/engine.ts`,
  per-plugin `syncPolicy.ts`).
- Whether the database plugin's saved-query concept still exists in the form assumed by
  run-once-and-pin.
- `boundaries.test.ts` protocol rules — the collections schema must land as core vocabulary, not
  a plugin-named module.
- The plugin-api surface snapshot — any helper exported for plugins (e.g. a collection route
  toolkit) is a deliberate surface change.
