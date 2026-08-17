# Dashboards

The home page, and a pane beside a task, are grids of panels a person composed themselves and
dragged and resized where they wanted them. A panel draws rows that came from a plugin, and it can
draw rows from two plugins at once: a board whose columns are the user's own invention, fed by GitHub
pull requests and Linear issues, with each provider's statuses mapped onto those columns. A panel can
also be a stat, a list, a table or a chart, and which of those it may be is derived from the data
rather than picked from a menu.

The invariant the whole feature rests on: **everything user-composed lives host-side against one
typed contract; plugins are providers of well-described records and get zero say over pixels.**
Cross-source composition, user-invented statuses, layout geometry, view kinds and placements are all
client machinery over the same node↔client contract, so the contract never grows to chase a use case.

This file is what the system does. What is left unbuilt — one deliverable per file — and the
refusals are [`docs/future/dashboards/`](./future/dashboards/README.md).

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
| `person` | a monogram plus the name — see below | filter |
| `link` | anchor that does not trigger the row's own action | click-through |

An absent cell draws an em dash rather than a blank, because "this row has no value here" is a fact
worth showing and it is a different fact from an empty string — which is also why `null` is on the
wire and sorts differently.

A `person` cell's avatar is a **monogram derived from the same display string it labels**, not a
fetched image. `person` is a display string on the wire, not a resolved account: turning "Ada
Lovelace" into a GitHub avatar URL would be a guess rendered as fact, and wrong for every provider
whose people are not GitHub users. A monogram adds scannability without adding a claim, needs no
network, and a name with no letters in it drops the mark and renders as plain text. Resolving a real
account image would need an identity the wire does not carry, and that is a field-vocabulary
argument, not a display one.

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
says so in a notice rather than showing an empty form.

That read is **reactive**, through a subscription to the node's query cache
(`createCollectionCacheRevision`): an answer landing while the editor is open — because the panel was
just placed, or a sibling panel over the same collection fetched — fills the gated sections in place.
What the editor deliberately does not do is **issue a fetch of its own**. Whether an editor may
*run* a collection to learn its shape is the question run-once-and-pin answers properly, with a person
pressing a button, and it must not be answered twice. The saved-SQL case this optionality was designed
for has not shipped; Linear arrived at it first.

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
`createTask` and `navigate` would parse and then do nothing.

An action may declare a **risk tier** — `read`, `write` or `execute`, the `ToolRisk` vocabulary an
agent tool already uses. Anything above `read` is armed: the host draws a confirmation strip naming
the plugin and dispatches nothing until Continue is pressed. The load-bearing part is who draws it.
**The host does, from the declared tier** — never a new verb like `deleteThing`, and never
plugin-drawn confirmation UI, because a plugin that could draw its own dialog could draw a reassuring
one over a destructive call. A plugin declares how dangerous the thing is; the host decides what to
ask and cannot be talked out of asking. The tier is optional and additive, so an action without one
behaves exactly as it always did, which is every action any plugin ships today.

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
| `mapping` | host, declarative | per source: field mapping, value mapping, the derived enum, the fields the user invented |
| `shaping` | host, declarative | filter, sort, group-by, limit, visible-field projection |
| `view` | host | which view, plus its measure and, for a chart, its shape and axes |

The layering is what lets a user flip a panel from table to board without losing their filters, and
swap a source without losing the layout. Shaping runs **client-side over the returned rows as the
baseline**; declared server-side params are an optimisation a collection may offer, never a
requirement, which keeps the plugin obligation at "answer with your rows".

**Where a panel is placed is not one of the four**, and that is the split the whole persistence
section below rests on: a definition is surface-free, and a placement references it by id and owns
its geometry. The same panel can therefore be on Home and in a task pane at two different sizes.

### Views are derived, not chosen from a menu

Kanban is not a component — it is group-by over a field with finite values. That insight gates every
view: `stat`, `list` and `table` ask nothing of the schema, `board` requires an `enum` field, and
`chart` requires an axis to draw against — an `enum` for a bar's categories or a `datetime` for a
line's time axis. The editor offers only what passes, so a collection with no enum is never offered a
board and a misconfigured panel is **unrepresentable rather than validated**.

Group-by lives in `shaping`, not in the view, so flipping a board to a table and back keeps the
grouping the way it keeps the filters. A board's columns are the declared enum values in declaration
order, and **a declared column draws whether or not anything is in it** — a kanban column that
vanishes when its last card leaves is disorienting, and it is also where you want to drop the card
back. An undeclared value gets its own muted column after the declared ones, in first-appearance
order; a row with no value at all goes to one catch-all "Uncategorised" column that exists only when
something is in it. Every row lands somewhere.

**Charts are two shapes and no dependency.** A `bar` takes its categories from an enum — the board's
own bucketing, reused whole, declared values in declaration order — and its height from the same
measure a `stat` draws, so flipping stat ↔ chart keeps what the panel is counting. A `line` takes its
x from a `datetime` **bucketed by day**, with an optional series split from an enum; the bucket is why
`count` and a number aggregate go down one path, since a count at an instant is always one. The axes
are type-inferred on the first click — a line takes the `updated`-role datetime, a bar takes whatever
the panel already groups by and then the `status`-role enum — and adjustable after.

Every mark carries an **attribute, never a colour**, and which one depends on what the mark is
*saying*. A value the plugin **declared** carries `data-tone` — the five-value status vocabulary
`StatusDot` already uses, so a `Ready` bar is the ok colour. Anything else is **identity** — an
undeclared category, a series split — and carries `data-series` instead: an ordinal slot coloured by
`--viz-series-1..3`, theme-axis tokens that are deliberately *not* the status colours. Status colour
on non-status identity is a lie of the same species as a guessed avatar: it makes whichever series was
drawn second permanently "warn-amber", which is a judgement nobody made. **Three slots, hard cap** —
series four onwards folds into `other` in the faint ink, because past three the honest answer is fewer
series or a table, not a fourth colour. The single unsplit line keeps `--accent`: one mark has no
sibling to be told apart from, the same argument that put the sparkline there. Pie, gauge, scatter and area are not there,
and will not be until someone arrives with the panel that needs one. The arithmetic — buckets,
scales, ticks, path data — is pure in `dashboards/chart.ts`; `ChartView.tsx` is SVG over its output
and decides nothing.

### Trends: the stat that earns a sparkline

A `stat` may carry a **trend** — a fortnight-wide sparkline under the number — and the two tiers it
offers are different features wearing one mark. Never blur them in the UI:

| Tier | Answers | Source | Available |
| --- | --- | --- | --- |
| `activity` | "when did these rows change" | the rows already on screen, bucketed by their own `updated`-role datetime | the moment the rows arrive |
| `history` | "what was this number" | the node's measure store, sampled hourly by `core:sample-measures` ([schedules.md](./schedules.md)) | accrues from when the panel first asks |

The consequence for a day with no data is opposite in the two tiers, which is why they share no code
past the geometry: **an activity day with no rows is a zero** (nothing changed, and that is a fact),
**a history day with no sample is a gap** (nobody looked, and interpolating would invent a number the
panel never displayed). Gaps render as breaks in the line. An empty history series is a cold state —
"Collecting — hourly, from now on" — not an error, which is also why the read route answers 200 with
an empty array rather than 404.

The editor gates each tier on what it actually needs: `activity` needs a datetime to bucket by, so a
schema without one is never offered it and a collection swap that loses the last date drops the key
(`retainView`, the `retainShaping` rule applied to a view key). `history` needs only the sampler, so
it is always offered.

`compare` draws a delta beside the number, and **the comparison is a point looked up, never a window
aggregated** — "vs last week" is the recorded sample nearest one week ago, searched back no further
than twice the window, not an average of last week. Window aggregates drag in bucket alignment,
partial windows and timezone edges, which are a metrics product's problems; Datadog's Query Value
change mode and Grafana's stat-plus-`timeShift` both do the same thing. No qualifying sample means
**no delta at all** — absence is a fact and it is not zero.

`good` colours that delta, and it exists because **direction-goodness is not guessable**: open PRs
going up is bad for one person's board and good for another's. Absent, the delta is neutral ink
rather than a guessed green. It is display config on the *panel* — the user's judgement — deliberately
unlike units and tones, which are the plugin's facts and hang off the field.

The arithmetic is pure in `dashboards-core/trend.ts` (points, path data, baseline, tone) and
`StatView.tsx` is SVG over its output, the same split `chart.ts`/`ChartView.tsx` takes. The client
reads the series from `GET /v2/core/dashboards/history`; there is no write route, because the sampler
and the store share a process and one writer needs no convergence.

### The mapping layer, and cross-source panels

A panel over more than one collection, or over one with user-declared columns, goes through
`dashboards/mapping.ts`. Three sub-layers apply in order: **field mapping** (which of a source's
fields feeds each panel-local field), **value mapping** (which of a source's enum values land in each
of the panel's columns), and the **derived enum** (the columns themselves — ids, labels and tones the
user invented, belonging to no plugin).

Five things about it are decisions rather than implementation:

- **A mapped panel's fields are the role vocabulary, plus whatever the user invented.** The roles are
  what the host can align *without asking* — that is the whole argument for them existing — and they
  are also a real ceiling: github's `repo` and linear's `identifier` are both text, both useful on a
  mixed board, and neither carries a role. So a person can declare a panel-local field with a name and
  a type from the wire's own seven, and answer per source which field feeds it: the same matrix, one
  row longer. An invented field renders, sorts, filters and groups through exactly the machinery a
  declared one does, so there is no second class of field anywhere. It has no role to fall back on, so
  a source left unanswered is simply empty for it rather than guessed at, and nothing about the wire
  changed to allow any of it.
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
yet — and it edits title, view kind, group-by, filters, sort keys, limit, the visible-field
projection and its order, the measure a stat or a chart draws, a chart's shape and axes, per-panel
refresh, the mapping step including the fields the user invented, and the collection's declared
params.

Its inputs are **selectors**: typed, data-aware controls that each know the schema they draw from —
pick a field of a given type, pick a comparison the field's type can actually answer, pick a value
drawn by the field's semantic type, map these values onto those columns, pick a tone. The promise is
split in two. Selectors make a bad choice unofferable; `normalizePanel` drops the stale choices no
selector can catch, such as a filter over a field that went away when the collection was swapped.

The pure derivations behind the selectors live in `dashboards/editor.ts`, `dashboards/compose.ts`,
`dashboards/mapping.ts` and `dashboards/chart.ts` rather than inside the components, because vitest
here runs in node with no Solid plugin — a component in this repo cannot be tested, so the parts that
can be wrong live where they can be. The same rule puts every scale, tick and rect in
`dashboards/chart.ts` and `dashboards/layout.ts`.

**Where those modules actually live.** Everything pure in that list moved to
`packages/dashboards-core`, because the node's measure sampler has to compute a panel's number with
the same functions the renderer draws it with (`docs/schedules.md`), and a client package cannot
enter the node's graph. `client-core/src/dashboards/*.ts` are one-line re-exports, so every path
named in this document still resolves and every component here still says `./model`. Only `editor.ts`,
`data.ts`, `persist.ts` and the components stayed: they read registries, signals or the query client,
which is exactly the line the new package draws.

## Persistence

Panel definitions and placements are one JSON blob in the **owning node's per-user prefs**, as the
`core.dashboards` persisted-state slice, versioned from day one. They are not device state: a panel
describes that node's resources, so it follows the resource
([state.md § Scope rules](./state.md)) and every client paired with that node renders the board its
owner built. The device's query cache stays the offline read fallback, as for every other node-backed
read.

**The definition codec is shared with the node**, in `@acorn/dashboards-core/definition.ts`: the
measure sampler reads the same blob the clients write and has to parse it through the same parser
rather than a second one that agrees today. `persist.ts` keeps the store, the slice registration and
the *geometry* codec — a rect is a rendering concern the node has no use for.

`PanelView` also carries three optional stat keys, parsed exactly like the chart keys and dropped when
malformed: `trend` (`'history' | 'activity'`), `compare` (`'day' | 'week'`) and `good`
(`'up' | 'down'`). `trend: 'history'` is what the node's sampler selects a panel on, and § Trends is
what they draw. The honest ceiling is the chart keys' own — an old client that writes the blob drops
them, the panel survives as a plain stat, and the series simply stops accruing until a newer client
writes them back.

**Placements reference panel definitions by id; they never embed them.** Embedding panel config
inside a "home dashboard" blob works right up until panels need to live in a second place, and then
it is a migration. A placement scope key is `(surface, ownerId?, projectId?)` with segments encoded,
so an owner id that itself contains a separator can never be read as two. `home` and `pane` are drawn
today; `plugin-region` is named in the key format so a later phase adds a renderer rather than a key
format. The split does its job: a new surface is a container and a scope constant, and touches
neither the key format nor the panel.

**Geometry is a third top-level key, `layouts`, keyed by the same scope then by panel id** — four
small integers per placed panel. A sibling key rather than turning the placement entries into
objects, and that is a compatibility decision rather than a tidiness one: the placement parser keeps
only *string* entries from the array, so object entries would parse to an empty placement and the
board would vanish on any client older than the change. A sibling key is invisible to an old parser, which renders
the order-only grid it always did. The honest ceiling, on the record: an old client that *writes* the
slice serialises only what it parsed, so a write from one drops `layouts` — geometry resets to
auto-placement while the panels, their definitions and their order all survive. Losing arrangement and
keeping composition is the right way round.

A rect belongs to a `(scope, panel)` pair, never to the definition, so the same panel placed on Home
and in the task pane has two of them. **A placed panel with no rect is auto-placed at render**, which
is one rule serving three cases at once: the migration for every existing blob, the recovery from an
old client's write, and the default for a newly added panel.

**Home tabs are a fourth top-level key, `tabs`** — a list of `{ id, name }` in display order, and
nothing else. A tab *is* the placement scope `{ surface: 'home', ownerId: tabId }`, so its panels are
ordinary placements and its geometry an ordinary `layouts` entry; only names and order are new. The
default tab's id is `''`, which the key encoder collapses back to the bare `home` key — so every blob
written before tabs existed is already a valid one-tab state, with no migration and no bar. Parsed
tolerantly like everything else: duplicates dropped keeping the first, **at most 8 tabs**, names
trimmed to 60 characters rather than dropped.

The renderer derives its tab list as `tabs` **plus any `home/*` scope that has placements and no
name**, shown as "Untitled". That one rule does three jobs: it is the recovery from an old client
that wrote the slice and dropped `tabs`, the defence against a partially written blob, and the reason
losing a name can never be what loses a composition. The ceiling matches `layouts`' — an old client
writing the slice loses names and order, keeps every panel; an old client *rendering* sees only the
bare `home` scope, with the other tabs' panels intact and invisible until a newer client draws them.
**Deleting a tab unplaces; it never deletes definitions**, and the default tab has no delete — it is
the bare scope, and deleting it would only mean emptying it.

**Unknown ids survive inert.** Parsing answers "is this shaped like a panel?", never "is that
collection registered in this build?" — the pane-layout rule verbatim. The registry lookup happens at
render, and three things degrade rather than disappear: a panel whose collections are not registered
here draws as "source unavailable", a view kind this build cannot draw says so instead of being
coerced to a list, and a placement entry with no definition is skipped without being deleted. A
person's composition is never collateral damage of switching a plugin off, and a definition written by
a newer client round-trips through an older one intact. The codec is hand-written and tolerant, like
every other slice: it must never throw on malformed input.

A malformed rect is **dropped, not repaired into place** — the panel it belonged to just becomes
rect-less, which is a case that already has an answer — and a rect naming a panel not placed in that
scope is retained unread, because dropping it would make a partially-written blob destructive.
Geometry did not bump the slice version: it is additive, both directions degrade as described, and
the shape parses under a parser that has never heard of it — which is what the version is a statement
about.

One key is carried across deliberately unread. `writeValue` on a mapping column is the board-drag
write-back seam; nothing sets it or looks at it yet, and it still round-trips, because a reserved
shape the codec quietly deletes is not reserved.

## Placements

**Home** is the default, and the dashboard there is **additive**. The active-task list is what people
open that screen for, so panels go below it, and a person who has placed none sees no heading, no
empty grid and no invitation — one ghost button, and not even that when no plugin provides a
collection, because an "Add panel" that opens an empty picker is worse than no button. Panels already
placed still render when a plugin goes away.

**The task pane** is the second, and it is the same `PanelGrid` at a different scope. It is keyed by
*pane*, not by task: definitions are per-user-per-node and surface-free, so the same board renders in
that pane in every task. A board per task is a non-goal — a task is ephemeral, and composing one is
labour nobody repeats. If per-something boards are ever wanted the answer is the scope's `projectId`
segment, which the key format already carries, not a task segment.

With more than one surface, **Remove and Delete are two different things**. "Remove from here"
unplaces; "Delete panel" destroys the definition and is armed, because the editor makes a definition
genuinely expensive to recompose — filters, a sort, a projection, a whole mapping matrix — and one
misclick should not cost all of it.

### The grid

A placement is **12 columns of square cells**, each panel at an explicit `{x, y, w, h}`. Twelve
because it divides into halves, thirds, quarters and sixths, and because a fixed count is what makes a
rect mean the same thing across window sizes and across the clients that share the blob; square
because that is what makes "3 wide, 2 tall" mean something visually. Rows are unbounded downward — the
page scrolls, and that asymmetry does real work below. The cell size is the one pixel measurement in
the feature, a `ResizeObserver` on the grid; the accepted consequence is that panel heights breathe
with window width.

Three behaviours, taken whole from Grafana and react-grid-layout because a decade of dashboards has
not needed anything richer:

- **A dragged panel pushes what it lands on down.** Never sideways, never a swap. Down is the only
  direction with unlimited room, so a push always succeeds, chains terminate, and the result is
  predictable enough to preview live.
- **A widening resize pushes neighbours right, and the chain stops at the wall.** The resize clamps at
  the widest width for which the chain still fits — the handle simply stops moving. Nothing wraps and
  nothing jumps rows: a neighbour teleporting to the next row because you widened something is the
  disorientation this rule exists to prevent. Growing taller pushes down instead, and never clamps.
- **Vertical compaction is always on.** Removing a panel heals the page and the narrow-window collapse
  is well-defined for free. The cost — you cannot deliberately leave a vertical *gap* — is the trade
  Grafana ships with; a deliberate gap within a row is a layout choice and survives.

**The preview during a gesture is the layout algorithm running on the candidate position**, not a
separate visual effect: release persists exactly what was on screen, so no commit computation can
disagree with the preview, and Escape costs nothing because nothing was written. The panel drags by
its **header** only — the body scrolls, selects and clicks, and leaving it gesture-free is also what
keeps a future board-card drag unambiguous (`docs/future/dashboards/write-back.md`). A **dot lattice**
marking cell intersections appears when a gesture arms and vanishes when it ends, iOS-widget style;
nothing about the layout is discoverable chrome until a gesture makes it relevant. The landing slot is
drawn as the *shape of the panel* — the panel's own radius, a solid edge and a wash of the accent —
rather than as a dashed wireframe of it, and it glides between candidates while the dragged panel
itself is lifted (shadow plus a 1.5% scale) so source and payload never look alike.

Panels are positioned **absolutely from the measured cell**, not by `grid-area`, and that is a
deliberate cost: `grid-area` cannot be transitioned, so push-down and compaction jumped between frames
and a drag read as a reshuffle. The container therefore states its own height from the live layout,
which means a mid-gesture preview resizes it — safe only because the `ResizeObserver` measures width
and never writes back into the layout. The collapsed one-column mode keeps ordinary block flow.

Panel chrome earns its pixels on approach: a six-dot grip, the refresh button and the overflow trigger
all fade in on hover or focus-within, and the resize corner carries a faint always-visible mark so a
panel reads as resizable before it is touched. The **freshness word** does not hide — state is not
decoration.

Every pointer gesture has a keyboard equivalent driven through **the same pure functions**: drag
sits *on top of* the accessible path rather than instead of it, which is the commitment reorder made
when it was menu items only. "Move / resize" in the overflow menu puts the panel in layout mode where
arrows move by a cell and Shift+arrows resize; Enter commits, Escape restores. The position is
announced through a live region *and* drawn as a caption beside the panel — the same computed string
twice, because a sighted keyboard user was otherwise getting strictly less than a screen-reader one.
Move up / move down survive too, reinterpreted onto geometry as a swap toward the neighbour in reading
order.

Below roughly twelve 44px cells the grid **collapses to one column in reading order** and the gestures
disarm. That is purely presentational — nothing in storage changes, so widening the window restores
the arrangement exactly — and it is what makes a pane-sized placement work at all. `placements` is
rewritten to reading order, sorted by `(y, x)`, on every commit, which keeps three things true at
once: a client with no geometry renders a sensible order, the collapse needs no second opinion, and
screen-reader document order matches visual order without a separate bookkeeping pass.

All of the arithmetic is pure functions in `dashboards/layout.ts`, exhaustively unit-tested;
`PanelGrid.tsx` turns pixels into a candidate rect and renders the answer, and contains no layout
arithmetic of its own.

## What is deliberately not here

Reasoning and revisit conditions for each are in
[`docs/future/dashboards/refused.md`](./future/dashboards/refused.md), and the ones that are
planned rather than refused each have a deliverable spec in
[`docs/future/dashboards/`](./future/dashboards/README.md).

- **Board-drag write-back.** Panels are read-only; dragging a card between columns is a mutation, and
  value mappings are many-to-one — GitHub's `merged` and `closed` may both land in `Done`, so dropping a
  card there has no unique answer. The answer is a designated write-value per (source, column), which
  is why the persisted shape is a record per column rather than a value→column lookup. Verb-shaped
  mutations through `runNodeAction` are not refused and work today, with the risk tier above.
- **Cross-collection joins.** A panel unions collections and maps fields; it does not join them. Joins
  need key relationships the contract does not express, and `contentLinks`/`refResolvers` already
  cover the adjacent need.
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
- [`docs/future/dashboards/`](./future/dashboards/README.md) — the backlog: what remains unbuilt,
  one deliverable per file, plus the refusals.
