# Dashboards

The home page is a grid of panels a person composed themselves. A panel draws rows that came from a
plugin, and it can draw rows from two plugins at once — a board whose columns are the user's own
invention, fed by GitHub pull requests and Linear issues, with each provider's statuses mapped onto
those columns.

The invariant the whole feature rests on: **everything user-composed lives host-side against one
typed contract; plugins are providers of well-described records and get zero say over pixels.**
Cross-source composition, user-invented statuses and future placements are all client machinery over
the same node↔client contract, so the contract never grows to chase a use case. The design record —
the seven-system prior-art survey, the refusals, and the reasoning behind each — is
[`docs/future/dashboards/`](./future/dashboards/README.md); this file is what shipped.

## Collections

A **collection** is a plugin-declared, typed, queryable set of records: "my open pull requests",
"issues assigned to me". It is the descriptor tier grown one size — from a node stat's one integer
with a label to a table of them — and it is data, not code: the host fetches it, parses it, and draws
it with its own components.

`(pluginId, collectionId)` is the **universal reference**. Panels, placements and the mapping layer
address a collection that way and no other way, which is what lets a composition outlive the plugin
being disabled and reinstalled. The registry mints a `<pluginId>:<collectionId>` key for its own
lookups; nothing else spells one.

The wire contract is `@acorn/protocol/collections.ts`. A route answers:

```jsonc
{
  "schema": { "fields": [{ "id": "status", "name": "Status", "type": "enum", "role": "status",
                           "values": [{ "id": "open", "label": "Open", "tone": "accent" }] }] },
  "rows": [{ "id": "acme/web#412", "values": { "status": "open" },
             "action": { "verb": "openUrl", "url": "https://github.com/acme/web/pull/412" } }]
}
```

Caps are on the schema and are the usual manifest discipline: 24 fields, 500 rows, 32 declared enum
values, 8 params, 2048 characters in a cell. A row is a row, not a document — a body belongs behind
the row's action, and a host that has to virtualise a plugin's answer has been handed a database
export.

### The two vocabularies, and the budget

Seven field types and five roles. Both closed, both versioned with the protocol.

| Type | Drawn as | Enables |
| --- | --- | --- |
| `text` | plain text | filter by `contains`/`eq`/`ne` |
| `number` | formatted, with the field's declared `unit` | sort, `sum`/`avg`/`min`/`max` |
| `boolean` | check or dash | filter |
| `datetime` | absolute plus "2h ago"; epoch milliseconds on the wire | sort, before/after |
| `enum` | toned chip, from the field's declared values | **group-by (kanban)**, filter |
| `person` | a name — `person` is a display string, and an avatar wants a resolved account | filter, group-by |
| `link` | anchor that does not trigger the row's own action | click-through |

An absent cell draws an em dash rather than a blank, because "this row has no value here" is a fact
worth showing and it is a different fact from an empty string — which is also why `null` is on the
wire and sorts differently.

Roles are `title`, `status`, `assignee`, `url`, `updated`, optional everywhere. They exist for exactly
one reason: a role is the only thing two independently-written collections agree about, so it is the
only thing the host can align without asking. That makes the cross-source field mapping pre-fillable
("both of these have a status-role enum") instead of a column-by-column chore.

Types are **semantic, not primitive**, and that is the load-bearing choice. A semantic type is what
lets the host render a person as an avatar and a datetime as an age, and what lets it *derive* which
views a collection supports — only an `enum` can become columns, only a `number` can be averaged.

**The budget is the design.** Every type added here is a rendering, sorting, grouping and filtering
rule that every provider's answer inherits forever, and a table is much further down the
descriptor-tier slope than a state chip. Grafana ended a decade with eight field types and Notion
with about a dozen properties; that is the ceiling this aims at. `duration` and `badge` were
candidates and were cut, because neither of the two providers that proved the contract needed them
and an unused type is a rendering rule nobody has checked. Both are additive later, at the cost of
arguing for them. **When a plugin needs something the vocabulary cannot express, the answer is a
frame pane, not a wider wire format.**

Display hints hang off the **field**, never off a panel — a `number`'s unit, an `enum`'s values with
their labels and tones. That is Grafana's `FieldConfig` lesson: a unit written on a table's column
config is gone the moment the panel becomes a list, and written on the field it survives every view
switch, every placement and every cross-source mapping. Tones come from the host's own `StatusDot`
vocabulary (`ok`, `warn`, `bad`, `muted`, `accent`), so an appearance pack owns the colour and a
plugin never names one.

### Declaring one

A **loaded** plugin declares `collections` in its manifest, up to eight. Linear's, verbatim:

```jsonc
"collections": [{
  "id": "issues-mine",
  "name": "My Linear issues",
  "items": "/v2/p/linear/collections/issues-mine",
  "refresh": 600
}]
```

`items` is confined to the plugin's own `/v2/p/<id>/` route space at manifest parse and re-checked on
the device, exactly like every other descriptor route, and the contribution id shares the manifest's
one duplicate-id namespace with every other kind. The host appends the declared params as query
parameters and nothing else — a caller cannot smuggle a second `nodeId` or a scope the plugin never
agreed to answer for.

A **compiled** plugin registers through `ctx.collections` and supplies its own fetch, because it has
no manifest for the host to synthesise one from. GitHub's:

```ts
ctx.collections.register({
  collectionId: PULLS_COLLECTION_ID,
  name: 'My pull requests',
  schema: pullsCollectionSchema,
  params: [{ id: 'repo', name: 'Repository', type: 'text' }],
  refresh: 60,
  fetch: async (nodeId, params, signal) => { /* … */ },
})
```

`pluginId` and the registry id are bound by the host from the registering plugin, so a collection
cannot be filed under a stranger's name. Both feeders land in one registry
(`client-core/src/registries/collections.ts`) and nothing downstream can tell them apart — which is
the point: a third-party plugin's panels ship no client bundle, trigger no trust prompt, and are
pixel-identical to a first-party one's under every appearance pack.

`params` are up to eight declared inputs, each `text` or `enum`. The host renders one control per
param in the panel editor and hands the value back opaquely. The plugin owns what `repo` means, and
the day it means something else the host does not change. Deliberately not the field vocabulary
above: a param is an input, not a rendered cell.

### Self-describing responses, and the cold case

Every response carries its schema beside its rows. The manifest `schema` is therefore the *static*
case — a promise about what the route returns, so a panel editor can offer views before any data
exists — and it is optional. A collection whose columns cannot be known at build time simply omits
it.

Linear omits it, and the reason generalises: a Linear workflow state is `{ name, type, color }` where
only `type` means the same thing in every workspace and `name` is whatever that workspace called it.
A schema written at build time would render every board in vocabulary nobody there uses, so the rows
carry the stable `type` and the response labels each declared value with the workspace's real name.

**The consequence, found in build rather than in design: a response-only collection cannot be
configured until it has been fetched once.** The editor reads the answered schema out of the node's
own QueryClient (`schemaOf` in `dashboards/editor.ts`, over `cachedCollectionPage` in
`dashboards/data.ts`) and issues no fetch of its own. Cold, there is nothing to gate a view on, so the
editor offers the three views that ask nothing of the fields and no filter, sort or grouping — and
says so in a notice rather than showing an empty form. Placing the panel once fills the cache and the
full editor is there on reopen. The saved-SQL case this optionality was designed for has not shipped;
Linear arrived at it first.

### Provenance, and what a row may not claim

`pluginId` and `collectionId` are **absent from the wire on purpose**. The host stamps both from the
contribution whose route answered, the same rule that stops a ref resolver naming another plugin's
provider. A row that could name its own source could put a stranger's items on a board under a
stranger's badge, and a mixed board renders source badges and routes row clicks on that stamp. The
response schema does not carry the two fields at all, so a body that states them has them stripped
before anything reads it. The badge is the rail's own `brand:<pluginId>` mark — registered by the
descriptor pass from the manifest `icon`, or by core for its own — falling back to the plugin's id as
text, so a plugin that ships a logo gets one here for free and one that does not gets its name rather
than a generic placeholder.

Row identity is required and has no fallback: `id` must be stable across refreshes, because that is
what a mixed board dedupes and keys its rendering by.

A row's optional `action` takes the manifest's **context-free** verb set — `openPane`,
`runNodeAction`, `openUrl`, `openOverlay`, `surfaceAction` — and runs through the host's ordinary
chrome dispatcher, so a click can do exactly what a command can do and nothing more. Not the full
chrome-action union: a panel row has no rail row to promote and no routed project to substitute, so
`createTask` and `navigate` would parse and then do nothing. There is no `risk` or `confirm` key,
which is why v1 ships no destructive row action at all; the growth path is an additive optional field
on that action with the **host** rendering the confirmation, never a new verb and never plugin-drawn
confirmation UI.

`openUrl` is not automatically a trip to the browser. Before opening one, the dispatcher asks the
content-link registry whether the URL names something acorn has its own surface for
(`registries/contentLinks.ts` § `openInAppUrl`). The URL stays the row's identity and the plugin
still declares the same verb; only the destination is resolved late, by whoever owns the pattern.

There are three destinations and a provider gets whichever it declared, in this order:

| Declared | Destination | Who has it |
| --- | --- | --- |
| `path` on the recogniser | the plugin's own route | github — `/p/:projectId/pulls/:number` |
| `providerId` + a `refPanel` frame | the reference panel, over the page | linear — `linear-ref` |
| `openPane` on a manifest content link | a task pane, when a task is open | linear — `linear` |

So a pull request row opens acorn's PR view and a Linear ticket row opens the ticket panel over the
dashboard, and **neither plugin has any dashboard-specific code** — both had already declared these
for content links in rendered prose, and the row click now asks the same registry. A plugin that
ships any one of the three gets panel rows resolving for free.

**The clicking surface ranks them, not the target.** A dashboard row asks for `route`: a panel row is
a jumping-off point, and you are looking at the list precisely in order to leave it. A surface you are
working *inside* asks for `refPanel` — a PR conversation, a reference panel, a plugin frame — because
swapping what a reader is part-way through is the worse mistake. A caller that states nothing gets the
historical order, pane then panel then route, so nobody is moved who did not ask to be.

That ranking is the whole reason `prefer` exists. When it first shipped, a route was tried *first and
unconditionally*, which is two wrong answers in one line: a dashboard row for a Linear ticket got a
glance panel when the reader was asking to go there, and a GitHub link clicked inside a Linear issue
would have torn the surface away from someone mid-sentence. The target cannot know where the reader
is, and it was deciding anyway. Every rung stays a *preference*, because any of them can be
unavailable — no task means no pane, no installed plugin means no panel, no navigator or no declared
`path` means no route — so a surface never has to know which of the three a provider actually shipped.

Taking a route also **selects the rail source that owns it** (`registries/sources.ts` §
`sourceIdForPath`). The shell draws from the rail selection, not from the location — every
contributed route mounts as a `noop` and the surface comes off the rail — so navigating from a
dashboard to another source's route without that step moves the address bar and leaves the dashboard
on screen. A path no source claims leaves the rail alone; core's own routes are not rail sources.

A URL nothing claims, or one for a repo this install does not track, opens externally exactly as
before — that fall-through is deliberate and is the same one a content link in a PR body takes. The
`link`-typed cell follows the same rule for a plain left click and keeps the real `href`, so
copy-link and modified clicks still give the browser.

A loaded plugin's answer is parsed with `pluginCollectionResponseSchema` and dropped **whole** if it
fails, logged against the offending plugin, with the panel rendering an empty page. Not per-row
sanitising: a half-parsed collection renders some rows and silently drops the rest, so a person reads
a complete-looking list that is missing the thing they were looking for. This is a deliberate
exception to the house rule that reads are not validated
([architecture-overview.md § Wire validation](./architecture-overview.md)) and sits at the same
boundary as the other exceptions — untrusted wire drawn under the host's own chrome.

### Freshness

Two knobs, two owners.

**Node-side TTL is plugin-owned**, through the sync engine or whatever the plugin already uses. The
two providers answered it differently and both are right. Linear declares `refresh: 600` on the
descriptor because its reads fan out across connections with per-item freshness, so there is no
single resource for `serveThenRevalidate` to hold. GitHub's route deliberately declares no TTL and
never drives the mirror: freshness there stays owned by the repo-scoped list route a person is
actually waiting on, because a panel polls unattended across every repository at once and a
revalidate here would multiply one dashboard by the user's repo count against a shared rate limit.
The honest ceiling is a panel showing rows as old as the last time that repo's PR list was opened.

**Client-side refresh is per panel and user-set**, clamped to the same 30s–86400s bound the manifest
holds a declared `refresh` to. A panel polls at its own setting, else the collection's declared hint,
else not at all; a hidden window skips the tick and a manual refresh is exempt. This is the first
contribution where per-contribution freshness was worth having — **chrome keeps its single shared
revision and its one min-refresh timer**, because a handful of tiny descriptor reads is not worth
splitting, and a panel is a page of rows a person chose to keep on screen.

Panel reads go through the fleet fan-out pinned to one node, like a descriptor rail list, so they
inherit the per-node deadline, the cache fallback and the live/stale/offline vocabulary: a panel on an
offline node shows what it last had, badged stale, rather than a spinner with no end.

## Panels

A **panel** is a definition with four layers, each owned by a different party.

| Layer | Owner | Contents |
| --- | --- | --- |
| `queries[]` | plugin (meaning), user (choice) | collection references plus declared params |
| `mapping` | host, declarative | per source: field mapping, value mapping, the derived enum |
| `shaping` | host, declarative | filter, sort, group-by, limit, visible-field projection |
| `view` | host | which view, and its options |

The layering is what lets a user flip a panel from table to board without losing their filters, and
swap a source without losing the layout. Shaping runs **client-side over the returned rows as the
baseline**; declared server-side params are an optimisation a collection may offer, never a
requirement, which keeps the plugin obligation at "answer with your rows".

### Views are derived, not chosen from a menu

Kanban is not a component — it is group-by over a field with finite values. That insight gates every
view: `stat`, `list` and `table` ask nothing of the schema, and `board` requires an `enum` field. The
editor offers only what passes, so a collection with no enum is never offered a board and a
misconfigured panel is **unrepresentable rather than validated**.

Group-by lives in `shaping`, not in the view, so flipping a board to a table and back keeps the
grouping the way it keeps the filters. A board's columns are the declared enum values in declaration
order, and **a declared column draws whether or not anything is in it** — a kanban column that
vanishes when its last card leaves is disorienting, and it is also where you want to drop the card
back. An undeclared value gets its own muted column after the declared ones, in first-appearance
order; a row with no value at all goes to one catch-all "Uncategorised" column that exists only when
something is in it. Every row lands somewhere.

### The mapping layer, and cross-source panels

A panel over more than one collection, or over one with user-declared columns, goes through
`dashboards/mapping.ts`. Three sub-layers apply in order: **field mapping** (which of a source's
fields feeds each panel-local field), **value mapping** (which of a source's enum values land in each
of the panel's columns), and the **derived enum** (the columns themselves — ids, labels and tones the
user invented, belonging to no plugin).

Five things about it are decisions rather than implementation:

- **A mapped panel's fields are the role vocabulary and nothing else.** That is a real ceiling, and
  it is the one the design pays for: a role is the only thing two independently-written collections
  agree about, so github's `repo` and linear's `identifier` have no panel-local home.
- **The derived enum *is* the panel's `status` field**, so the board draws the user's columns without
  knowing a mapping exists. The unmapped-value rule above is inherited rather than re-derived, and
  the mapping's `unmapped` key chooses between the catch-all column and hiding the row — never
  silently dropping it.
- **`bySource` is keyed by `(pluginId, collectionId)`**, never by the query's array index, so removing
  a source cannot silently rebind another source's mapping onto a different provider's values.
- **The role is the runtime default, not a one-time copy** into the config, so a panel that never
  opened the mapping step still unions correctly and a plugin that moves a role to another field is
  followed. An explicit `''` is the user saying "this source has nothing here", which is a different
  answer from an absent key.
- **Fetching is per collection and the union is client-side**, so two panels over one collection share
  the read, a slow source does not hold up a fast one, and **partial availability is data**: a source
  that failed is a banner naming that source with the rest of the panel still rendering. A panel goes
  inert only when none of its collections resolve.

Nothing in that layer is reachable from a manifest, and none of it grew the wire format. Neither
plugin knows the other exists. If a future change here wants a new protocol field, that is the design
failing rather than the protocol being short.

### The generated editor

No panel settings UI is hand-written, because a hand-written editor drifts from its schema. One
component serves both entry points — "add" is the same question asked of a panel that does not exist
yet — and it edits title, view kind, group-by, filters, sort keys, limit, the visible-field projection
and its order, the stat aggregate, per-panel refresh, the mapping step, and the collection's declared
params.

Its inputs are **selectors**: typed, data-aware controls that each know the schema they draw from —
pick a field of a given type, pick a comparison the field's type can actually answer, pick a value
drawn by the field's semantic type, map these values onto those columns, pick a tone. The promise is
split in two. Selectors make a bad choice unofferable; `normalizePanel` drops the stale choices no
selector can catch, such as a filter over a field that went away when the collection was swapped.

The pure derivations behind the selectors live in `dashboards/editor.ts` and `dashboards/compose.ts`
rather than inside the components, because vitest here runs in node with no Solid plugin — a component
in this repo cannot be tested, so the parts that can be wrong live where they can be.

## Persistence

Panel definitions and placements are one JSON blob in the **owning node's per-user prefs**, as the
`core.dashboards` persisted-state slice, versioned from day one. They are not device state: a panel
describes that node's resources, so it follows the resource
([state.md § Scope rules](./state.md)) and every client paired with that node renders the board its
owner built. The device's query cache stays the offline read fallback, as for every other node-backed
read.

**Placements reference panel definitions by id; they never embed them.** Embedding panel config
inside a "home dashboard" blob works right up until panels need to live in a second place, and then
it is a migration. A placement scope key is `(surface, ownerId?, projectId?)` with segments encoded,
so an owner id that itself contains a separator can never be read as two. `home` is the only surface
drawn today; `pane` and `plugin-region` are named in the key format so a later phase adds a renderer
rather than a key format.

**Unknown ids survive inert.** Parsing answers "is this shaped like a panel?", never "is that
collection registered in this build?" — the pane-layout rule verbatim. The registry lookup happens at
render, and three things degrade rather than disappear: a panel whose collections are not registered
here draws as "source unavailable", a view kind this build cannot draw says so instead of being
coerced to a list, and a placement entry with no definition is skipped without being deleted. A
person's composition is never collateral damage of switching a plugin off, and a definition written by
a newer client round-trips through an older one intact. The codec is hand-written and tolerant, like
every other slice: it must never throw on malformed input.

One key is carried across deliberately unread. `writeValue` on a mapping column is the write-back
seam; nothing in this read-only build sets it or looks at it, and it still round-trips, because a
reserved shape the codec quietly deletes is not reserved.

## On Home

Home is the default and currently only placement, and the dashboard is **additive**. The active-task
list is what people open that screen for, so panels go below it, and a person who has placed none
sees no heading, no empty grid and no invitation — one ghost button, and not even that when no plugin
provides a collection, because an "Add panel" that opens an empty picker is worse than no button.
Panels already placed still render when a plugin goes away.

Reordering is move-up/move-down in the panel's overflow menu, keyboard- and screen-reader-operable by
construction; drag is deliberately absent, and if it lands it lands on top of this rather than instead
of it. Remove deletes the definition rather than unplacing it, because home is the only placement
drawn and an unplaced panel would be unreachable.

## What is deliberately not here

Reasoning and revisit conditions for each are in
[`docs/future/dashboards/refused.md`](./future/dashboards/refused.md).

- **Write-back.** v1 is read-only. Dragging a card between columns is a mutation, and value mappings
  are many-to-one — GitHub's `merged` and `closed` may both land in `Done`, so dropping a card there
  has no unique answer. The eventual answer is a designated write-value per (source, column), which is
  why the persisted shape is a record per column rather than a value→column lookup.
- **Cross-collection joins.** A panel unions collections and maps fields; it does not join them. Joins
  need key relationships the contract does not express, and `contentLinks`/`refResolvers` already
  cover the adjacent need.
- **Charts.** They want a `number` and usually a `datetime`, both of which are in the vocabulary, so
  this is a view kind rather than a contract change whenever someone wants it.
- **Plugin-hosted regions and rail side panels.** Panels are placement-agnostic and the scope-key
  format already has room; when these land, host-rendered panels still never render inside a frame
  document. A plugin's layout *reserves* a region and the host draws it.
- **A dynamic discovery route, and run-once-and-pin.** Collections are manifest-static or
  compiled-registered only. Discovery is the two-route `agentContexts` pattern when the saved-SQL case
  needs it, and static declaration is then the degenerate case.
- **A per-plugin "dashboard" contribution.** A plugin does not ship a prebuilt dashboard. If starter
  panels prove wanted, the shape is a plugin-*suggested* panel definition the user accepts into their
  own composition, so ownership of composed panels stays with the user.

## Related

- [plugins.md](./plugins.md) § Descriptors — the `collections` manifest key beside the other
  descriptor kinds, and the master/detail refusal this sits next to without reversing.
- [extensibility.md](./extensibility.md) — why descriptors exist and why the verb set stays closed.
- [data-layer.md](./data-layer.md) — the mirrors a collection route projects over.
- [state.md](./state.md) — why panel definitions follow the node rather than the device.
- [`docs/future/dashboards/`](./future/dashboards/README.md) — the design record: prior art, the
  refusals, and the phase-4 work that is still unscheduled.
