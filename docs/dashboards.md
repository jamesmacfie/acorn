# Dashboards

The home page is a grid of panels a person composed themselves and dragged and resized where they
wanted them. A panel draws rows that came from a plugin, and it can draw rows from two plugins at
once: a board whose columns are the user's own invention, fed by GitHub pull requests and Linear
issues, with each provider's statuses mapped onto those columns. A panel can also be a stat, a list,
a table, or a chart, and which of those it may be is derived from the data rather than picked from a
menu.

The invariant the feature rests on: **everything user-composed lives host-side against one typed
contract, and plugins are providers of well-described records with no say over pixels.**
Cross-source composition, user-invented statuses, layout geometry, view kinds, and placements are all
client machinery over the same node-to-client contract, so the contract never grows to chase a use
case.

This file is what the system does. For what is left unbuilt, one deliverable per file, and the
refusals, see [the dashboards backlog](./future/dashboards/README.md).

## Collections

A **collection** is a plugin-declared, typed, queryable set of records: "my open pull requests",
"issues assigned to me". It is the descriptor tier grown one size, from a node stat's one integer
with a label to a table of them. It is data, not code: the host fetches it, parses it, and draws it
with its own components.

`(pluginId, collectionId)` is the universal reference. Panels, placements, and the mapping layer
address a collection that way and no other way, which lets a composition outlive the plugin being
disabled and reinstalled. The registry mints a `<pluginId>:<collectionId>` key for its own lookups,
and nothing else spells one.

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
values, 8 params, 2048 characters in a cell. A row is a row, not a document. A body belongs behind
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
| `enum` | toned chip, from the field's declared values | group-by (kanban), filter |
| `person` | a monogram plus the name | filter |
| `link` | anchor that does not trigger the row's own action | click-through |

An absent cell draws a dash rather than a blank, because "this row has no value here" is a fact worth
showing and a different fact from an empty string. That is also why `null` is on the wire and sorts
differently.

A `person` cell's avatar is a monogram derived from the same display string it labels, not a fetched
image. `person` is a display string on the wire, not a resolved account. Turning "Ada Lovelace" into
a GitHub avatar URL would be a guess rendered as fact, and wrong for every provider whose people are
not GitHub users. A monogram adds scannability without adding a claim, needs no network, and a name
with no letters in it drops the mark and renders as plain text. Resolving a real account image would
need an identity the wire does not carry, which is a field-vocabulary argument rather than a display
one.

Roles are `title`, `status`, `assignee`, `url`, and `updated`, optional everywhere. They exist for
one reason: a role is the only thing two independently written collections agree about, so it is the
only thing the host can align without asking. That makes the cross-source field mapping pre-fillable
("both of these have a status-role enum") instead of a column-by-column chore.

Types are semantic rather than primitive, and that is the load-bearing choice. A semantic type is
what lets the host render a person as an avatar and a datetime as an age, and what lets it derive
which views a collection supports. Only an `enum` can become columns, and only a `number` can be
averaged.

**The budget is the design.** Every type added here is a rendering, sorting, grouping, and filtering
rule that every provider's answer inherits forever, and a table is much further down the
descriptor-tier slope than a state chip. Grafana ended a decade with eight field types and Notion
with about a dozen properties, and that is the ceiling this aims at. `duration` and `badge` were
candidates and were cut, because neither of the two providers that proved the contract needed them
and an unused type is a rendering rule nobody has checked. Both are additive later, at the cost of
arguing for them. When a plugin needs something the vocabulary cannot express, the answer is a frame
pane rather than a wider wire format.

Display hints hang off the field, never off a panel: a `number`'s unit, an `enum`'s values with their
labels and tones. That is Grafana's `FieldConfig` lesson. A unit written on a table's column config
is gone the moment the panel becomes a list, and written on the field it survives every view switch,
every placement, and every cross-source mapping. Tones come from the host's own `StatusDot`
vocabulary (`ok`, `warn`, `bad`, `muted`, `accent`), so an appearance pack owns the colour and a
plugin never names one.

### Declaring one

A loaded plugin declares `collections` in its manifest, up to eight. Linear's, verbatim:

```jsonc
"collections": [{
  "id": "issues-mine",
  "name": "My Linear issues",
  "items": "/v2/p/linear/collections/issues-mine",
  "refresh": 600
}]
```

`items` is confined to the plugin's own `/v2/p/<id>/` route space at manifest parse and re-checked on
the device, like every other descriptor route, and the contribution id shares the manifest's one
duplicate-id namespace with every other kind. The host appends the declared params as query
parameters and nothing else, so a caller cannot smuggle a second `nodeId` or a scope the plugin never
agreed to answer for.

A compiled plugin registers through `ctx.collections` and supplies its own fetch, because it has no
manifest for the host to synthesise one from. GitHub's:

```ts
ctx.collections.register({
  collectionId: PULLS_COLLECTION_ID,
  name: 'My pull requests',
  schema: pullsCollectionSchema,
  params: [
    { id: 'repo', name: 'Repository', type: 'enum' },
    { id: 'involves', name: 'Involving me', type: 'enum', multiple: true, values: ['review-requested', 'assigned', 'authored'] },
  ],
  paramOptions: async (paramId, nodeId) => /* the repositories this device has mirrored */,
  refresh: 60,
  fetch: async (nodeId, params, signal) => { /* … */ },
})
```

`pluginId` and the registry id are bound by the host from the registering plugin, so a collection
cannot be filed under a stranger's name. Both feeders land in one registry
(`client-core/src/registries/collections.ts`) and nothing downstream can tell them apart. That is the
point: a third-party plugin's panels ship no client bundle, trigger no trust prompt, and are
pixel-identical to a first-party one's under every appearance pack.

**Core registers one of its own, `core:tasks`, "Workspace tasks"** — this node's active tasks, one row
each, with the project and the workspace as id-valued enums so a board can be grouped by either, and a
`workspace` param whose options are the node's own workspaces. It reads the three routes the rail
already reads and adds no endpoint. It is filed under `core` from the shell's activation, beside the
plugin-failure attention source, for the same reason that one is: there is no plugin whose data this is.
It is also the replacement for the task list Home used to draw above its panels — see § Placements.

Two honest limits on it. The `changes` cell is the worktree status poller's answer, which polls the
active node and only on desktop, so a panel pointed anywhere else gets `null`, which reads as "no value
here" rather than "clean". And a node with more than 32 projects or workspaces declares the first 32 by
name, the wire cap on enum values; the surplus renders as its raw id, which is what any undeclared enum
value does.

`params` are up to eight declared inputs, each `text` or `enum`. The host renders one control per
param in the panel editor and hands the value back opaquely. The plugin owns what `repo` means, and
the day it means something else the host does not change. Params deliberately do not use the field
vocabulary above, because a param is an input rather than a rendered cell.

Opaque is load-bearing rather than fastidious, and github's second param is the demonstration. Unset,
`involves` serves a select over the PR mirror. Set, the same route answers the same columns from a
GitHub search, because "assigned to me" has no answer in the mirror at all. See
[collections in the data layer](./data-layer.md#collections-a-projection-never-a-second-store). The
host renders the control either way and knows about neither. An enum param's values are ids, shown as
typed, so they are worth writing as words a person would recognise in a select.

Two shapes past a plain select, each because a param had a question the other could not put:

- **`multiple: true`** on an enum renders checkboxes and hands the ticked ids back as one
  comma-joined string. "Assigned to me or waiting on my review" is one question a person asks, and
  github answers it by running one search per tick and unioning them, because GitHub's own qualifiers
  only AND. A second param type would have been the other spelling and is worse: every reader would
  then have two enum shapes to branch on, where this way a plugin ignoring the flag still gets a
  string it can read.
- **`paramOptions`** resolves a param's choices on the device, for the case no static declaration can
  cover. Github's `repo` is the repositories this user mirrored. Compiled plugins only, and
  deliberately so, because the loaded-plugin equivalent is a second descriptor route to define,
  parse, and cache, for a case no manifest plugin has. The function's shape is what that route would
  answer with, so the day one exists the synthesiser fills the same field and nothing downstream
  changes.

### Self-describing responses, and the cold case

Every response carries its schema beside its rows. The manifest `schema` is therefore the static
case, a promise about what the route returns so a panel editor can offer views before any data
exists, and it is optional. A collection whose columns cannot be known at build time omits it.

Linear omits it, and the reason generalises. A Linear workflow state is `{ name, type, color }` where
only `type` means the same thing in every workspace and `name` is whatever that workspace called it.
A schema written at build time would render every board in vocabulary nobody there uses, so the rows
carry the stable `type` and the response labels each declared value with the workspace's real name.

The consequence, found in build rather than in design: a response-only collection cannot be
configured until it has been fetched once. The editor reads the answered schema out of the node's own
QueryClient (`schemaOf` in `dashboards/editor.ts`, over `cachedCollectionPage` in `dashboards/data.ts`)
and issues no fetch of its own. Cold, there is nothing to gate a view on, so the editor offers the
three views that ask nothing of the fields and no filter, sort, or grouping, and says so in a notice
rather than showing an empty form.

That read is reactive, through a subscription to the node's query cache
(`createCollectionCacheRevision`). An answer landing while the editor is open, because the panel was
just placed or a sibling panel over the same collection fetched, fills the gated sections in place.
What the editor deliberately does not do is issue a fetch of its own. Whether an editor may run a
collection to learn its shape is the question run-once-and-pin answers properly, with a person
pressing a button, and it must not be answered twice. The saved-SQL case this optionality was
designed for has not shipped. Linear arrived at it first.

### Provenance, and what a row may not claim

`pluginId` and `collectionId` are absent from the wire on purpose. The host stamps both from the
contribution whose route answered, the same rule that stops a ref resolver naming another plugin's
provider. A row that could name its own source could put a stranger's items on a board under a
stranger's badge, and a mixed board renders source badges and routes row clicks on that stamp. The
response schema does not carry the two fields at all, so a body that states them has them stripped
before anything reads it. The badge is the rail's own `brand:<pluginId>` mark, registered by the
descriptor pass from the manifest `icon` or by core for its own, falling back to the plugin's id as
text. A plugin that ships a logo gets one here for free, and one that does not gets its name rather
than a generic placeholder.

Row identity is required and has no fallback. `id` must be stable across refreshes, because that is
what a mixed board dedupes and keys its rendering by.

A row's optional `action` takes the manifest's context-free verb set, `openPane`, `openTask`,
`runNodeAction`, `openUrl`, `openOverlay`, and `surfaceAction`, and runs through the host's ordinary
chrome dispatcher, so a click can do what a command can do and nothing more. Not the full
chrome-action union: a panel row has no rail row to promote and no routed project to substitute, so
`createTask` and `navigate` would parse and then do nothing.

A row may also name the task its thing lives in, as `taskId`. That is what makes `openPane` usable
from a dashboard at all, because a panel is drawn outside every task and the verb used to have only
the task that happened to be on screen, never the one the row is about. With a task named, the
dispatcher activates it, navigates there, and opens the pane on arrival with the row's id as the
retained selection intent. A task this node does not have is refused at the click rather than opening
the pane somewhere else. The agents plugin's session rows are the proving case: clicking one lands in
that session's own task with that session selected, and the pane learns which session from the same
`plugin:select` intent a rail row's click carries.

`openTask` is the same trip without the pane, and `taskId` is the whole of what it needs. Core's own
task rows are why it exists: a row whose thing is a task has nowhere else to send a click, and naming
a pane would be choosing one on the reader's behalf. A row that declares it and names no task is
refused out loud, the same as one naming a task this node does not have.

Naming a task is not the same as naming a source. Provenance is stamped by the host precisely so a
row cannot wear a stranger's badge. A task is a core object the host resolves itself, and
`PluginAttentionWireItem.taskId` is the same field one tier up.

An action may declare a risk tier, `read`, `write`, or `execute`, the `ToolRisk` vocabulary an agent
tool already uses. Anything above `read` is armed: the host draws a confirmation strip naming the
plugin and dispatches nothing until Continue is pressed. The load-bearing part is who draws it. The
host does, from the declared tier, never a new verb like `deleteThing` and never plugin-drawn
confirmation UI, because a plugin that could draw its own dialog could draw a reassuring one over a
destructive call. A plugin declares how dangerous the thing is; the host decides what to ask and
cannot be talked out of asking. The tier is optional and additive, so an action without one behaves
as every action any plugin ships does.

`openUrl` is not automatically a trip to the browser. Before opening one, the dispatcher asks the
content-link registry whether the URL names something acorn has its own surface for (`openInAppUrl`
in `registries/contentLinks.ts`). The URL stays the row's identity and the plugin still declares the
same verb. Only the destination is resolved late, by whoever owns the pattern.

There are three destinations and a provider gets whichever it declared, in this order:

| Declared | Destination | Who has it |
| --- | --- | --- |
| `path` on the recogniser | the plugin's own route | github, `/p/:projectId/pulls/:number` |
| `providerId` plus a `refPanel` frame | the reference panel, over the page | linear, `linear-ref` |
| `openPane` on a manifest content link | a task pane, when a task is open | linear, `linear` |

A pull request row opens acorn's PR view and a Linear ticket row opens the ticket panel over the
dashboard, and neither plugin has any dashboard-specific code. Both had already declared these for
content links in rendered prose, and the row click asks the same registry. A plugin that ships any
one of the three gets panel rows resolving for free.

The clicking surface ranks them, not the target. A dashboard row asks for `route`, because a panel
row is a jumping-off point and you are looking at the list precisely in order to leave it. A surface
you are working inside asks for `refPanel`, whether a PR conversation, a reference panel, or a plugin
frame, because swapping what a reader is part-way through is the worse mistake. A caller that states
nothing gets the historical order, pane then panel then route, so nobody is moved who did not ask to
be.

That ranking is why `prefer` exists. When it first shipped, a route was tried first and
unconditionally, which is two wrong answers in one line. A dashboard row for a Linear ticket got a
glance panel when the reader was asking to go there, and a GitHub link clicked inside a Linear issue
would have torn the surface away from someone mid-sentence. The target cannot know where the reader
is, and it was deciding anyway. Every rung stays a preference, because any of them can be
unavailable. No task means no pane, no installed plugin means no panel, and no navigator or no
declared `path` means no route, so a surface never has to know which of the three a provider shipped.

Taking a route also selects the rail source that owns it (`sourceIdForPath` in
`registries/sources.ts`). The shell draws from the rail selection rather than from the location:
every contributed route mounts as a `noop` and the surface comes off the rail, so navigating from a
dashboard to another source's route without that step moves the address bar and leaves the dashboard
on screen. A path no source claims leaves the rail alone, and core's own routes are not rail sources.

A URL nothing claims, or one for a repo this install does not track, opens externally. That
fall-through is deliberate and is the same one a content link in a PR body takes. The `link`-typed
cell follows the same rule for a plain left click and keeps the real `href`, so copy-link and
modified clicks still give the browser.

A loaded plugin's answer is parsed with `pluginCollectionResponseSchema` and dropped whole if it
fails, logged against the offending plugin, with the panel rendering an empty page. Not per-row
sanitising: a half-parsed collection renders some rows and silently drops the rest, so a person reads
a complete-looking list that is missing the thing they were looking for. This is a deliberate
exception to the house rule that reads are not validated, covered by wire validation in
[the architecture overview](./architecture-overview.md), and it sits at the same boundary as the
other exceptions: untrusted wire drawn under the host's own chrome.

### Freshness

Two knobs, two owners.

Node-side TTL is plugin-owned, through the sync engine or whatever the plugin already uses. The two
providers answered it differently and both are right. Linear declares `refresh: 600` on the
descriptor because its reads fan out across connections with per-item freshness, so there is no
single resource for `serveThenRevalidate` to hold. GitHub's route deliberately declares no TTL and
never drives the mirror. Freshness there stays owned by the repo-scoped list route a person is
waiting on, because a panel polls unattended across every repository at once and a revalidate here
would multiply one dashboard by the user's repo count against a shared rate limit. The honest ceiling
is a panel showing rows as old as the last time that repo's PR list was opened.

Client-side refresh is per panel and user-set, clamped to the same 30s to 86400s bound the manifest
holds a declared `refresh` to. A panel polls at its own setting, else the collection's declared hint,
else not at all. A hidden window skips the tick and a manual refresh is exempt. This is the first
contribution where per-contribution freshness was worth having. Chrome keeps its single shared
revision and its one min-refresh timer, because a handful of tiny descriptor reads is not worth
splitting, and a panel is a page of rows a person chose to keep on screen.

Panel reads go through the fleet fan-out pinned to one node, like a descriptor rail list, so they
inherit the per-node deadline, the cache fallback, and the live, stale, and offline vocabulary. A
panel on an offline node shows what it last had, badged stale, rather than a spinner with no end.

## Panels

A **panel** is a definition with four layers, each owned by a different party.

| Layer | Owner | Contents |
| --- | --- | --- |
| `queries[]` | plugin (meaning), user (choice) | collection references plus declared params |
| `mapping` | host, declarative | per source: field mapping, value mapping, the derived enum, the fields the user invented |
| `shaping` | host, declarative | filter, sort, group-by, limit, visible-field projection |
| `view` | host | which view, plus its measure and, for a chart, its shape and axes |

The layering lets a user flip a panel from table to board without losing their filters, and swap a
source without losing the layout. Shaping runs client-side over the returned rows as the baseline.
Declared server-side params are an optimisation a collection may offer, never a requirement, which
keeps the plugin obligation at "answer with your rows".

Where a panel is placed is not one of the four, and that is the split the persistence section rests
on. A definition is surface-free, and a placement references it by id and owns its geometry. The same
panel can therefore be on Home and in a plugin region at two different sizes.

### Views are derived, not chosen from a menu

Kanban is not a component. It is group-by over a field with finite values. That insight gates every
view: `stat`, `list`, and `table` ask nothing of the schema, `board` requires an `enum` field, and
`chart` requires an axis to draw against, an `enum` for a bar's categories or a `datetime` for a
line's time axis. The editor offers only what passes, so a collection with no enum is never offered a
board and a misconfigured panel is unrepresentable rather than validated.

Group-by lives in `shaping` rather than in the view, so flipping a board to a table and back keeps
the grouping the way it keeps the filters. A board's columns are the declared enum values in
declaration order, and a declared column draws whether or not anything is in it. A kanban column that
vanishes when its last card leaves is disorienting, and it is also where you want to drop the card
back. An undeclared value gets its own muted column after the declared ones, in first-appearance
order. A row with no value at all goes to one catch-all "Uncategorised" column that exists only when
something is in it. Every row lands somewhere.

**Charts are two shapes and no dependency.** A `bar` takes its categories from an enum, the board's
own bucketing reused whole with declared values in declaration order, and its height from the same
measure a `stat` draws, so flipping between stat and chart keeps what the panel is counting. A `line`
takes its x from a `datetime` bucketed by day. The bucket is why `count` and a number aggregate go
down one path, since a count at an instant is always one. The axes are type-inferred on the first
click, where a line takes the `updated`-role datetime and a bar takes whatever the panel already
groups by and then the `status`-role enum, and both are adjustable after.

Either shape may be split into series by an enum, and it is the same `view.series` key on both. On a
line that is one line per value. On a bar it is the grouped bar: a cluster per category, one bar per
series inside it, on the shared measure scale. That is a third shape by arithmetic but not by config,
which is why it needed no codec change and why a client that does not draw it renders the ungrouped
bar rather than nothing. The split is offered only where it is representable: any enum for a line,
and any enum but the category axis for a bar, so a single-enum collection is never offered one.

Every mark carries an attribute rather than a colour, and which one depends on what the mark is
saying. A value the plugin gave a tone carries `data-tone`, the five-value status vocabulary
`StatusDot` already uses, so a `Ready` bar is the ok colour. Anything else is identity, whether an
undeclared category, a value declared without a tone, or a series split, and carries `data-series`
instead: an ordinal slot coloured by `--viz-series-1..3`, theme-axis tokens that are deliberately not
the status colours. Status colour on non-status identity is a lie of the same species as a guessed
avatar. It makes whichever series was drawn second permanently "warn-amber", which is a judgement
nobody made. A declared value with no tone counts as identity rather than as muted: declaring that a
value exists is not declaring what it means, and toning them all faint would draw every series of an
untoned enum the same. Three slots, hard cap. Series four onwards folds into `other` in the faint
ink, because past three the honest answer is fewer series or a table, not a fourth colour. What the
colour answers moves with the split: an ungrouped bar colours by category, and a grouped one colours
by series and leaves the category to the axis. The single unsplit line keeps `--accent`, because one
mark has no sibling to be told apart from, the same argument that put the sparkline there.

A legend draws exactly when two or more series do, never for one, because the panel title already
names a single series and a one-swatch legend is furniture. It is a wrapping row above the plot, each
key a swatch in the mark's own shape wearing the mark's own `data-tone` or `data-series`, with the
label in ordinary ink. Identity lives in the swatch and never in coloured text. The fold is disclosed
rather than hidden: the slots past the third collapse into one "Other (3)" key that says how many
went in, so nothing is visible in the render that is unnameable in text. It is not polish. The
identity ramp's slot-2 and slot-3 pair sits in the colour-vision-deficiency warn band, which is legal
only with a secondary encoding, and this is it. An ungrouped bar needs none because its categories
are named on the x axis.

Pie, gauge, scatter, and area are not there, and will not be until someone arrives with the panel
that needs one. The arithmetic, covering buckets, scales, ticks, cluster offsets, path data, and the
legend keys, is pure in `dashboards/chart.ts`. `ChartView.tsx` is SVG over its output and decides
nothing.

### Trends: the stat that earns a sparkline

A `stat` may carry a trend, a fortnight-wide sparkline under the number, and the two tiers it offers
are different features wearing one mark. Never blur them in the UI:

| Tier | Answers | Source | Available |
| --- | --- | --- | --- |
| `activity` | "when did these rows change" | the rows already on screen, bucketed by their own `updated`-role datetime | the moment the rows arrive |
| `history` | "what was this number" | the node's measure store, sampled hourly by `core:sample-measures`. See [schedules](./schedules.md) | accrues from when the panel first asks |

The consequence for a day with no data is opposite in the two tiers, which is why they share no code
past the geometry. An activity day with no rows is a zero, because nothing changed and that is a
fact. A history day with no sample is a gap, because nobody looked and interpolating would invent a
number the panel never displayed. Gaps render as breaks in the line. An empty history series is a
cold state, "Collecting, hourly, from now on", rather than an error, which is also why the read route
answers 200 with an empty array rather than 404.

The editor gates each tier on what it needs. `activity` needs a datetime to bucket by, so a schema
without one is never offered it and a collection swap that loses the last date drops the key
(`retainView`, the `retainShaping` rule applied to a view key). `history` needs only the sampler, so
it is always offered.

`compare` draws a delta beside the number, and the comparison is a point looked up rather than a
window aggregated. "vs last week" is the recorded sample nearest one week ago, searched back no
further than twice the window, not an average of last week. Window aggregates drag in bucket
alignment, partial windows, and timezone edges, which are a metrics product's problems. Datadog's
Query Value change mode and Grafana's stat-plus-`timeShift` both do the same thing. No qualifying
sample means no delta at all, because absence is a fact and it is not zero.

`good` colours that delta, and it exists because direction-goodness is not guessable: open PRs going
up is bad for one person's board and good for another's. Absent, the delta is neutral ink rather than
a guessed green. It is display config on the panel, the user's judgement, deliberately unlike units
and tones, which are the plugin's facts and hang off the field.

The arithmetic is pure in `dashboards-core/trend.ts` (points, path data, baseline, tone) and
`StatView.tsx` is SVG over its output, the same split `chart.ts` and `ChartView.tsx` take. The client
reads the series from `GET /v2/core/dashboards/history`. There is no write route, because the sampler
and the store share a process and one writer needs no convergence.

### Sampling and retention

`core:sample-measures` samples every placed panel that asked for a history trend, once an hour. See
[the schedules doc](./schedules.md). It reads the prefs blob through the same parser the clients use
and computes each panel's number with the same pipeline the stat renders with, so a stored sample
means what the number on screen means. An unplaced panel is skipped, because nothing renders it and
sampling it would be cost with no reader. Placing it again resumes sampling from the next pass, and
the gap in between renders honestly as a gap.

A panel over more than one collection is skipped whole when any of them fails to resolve, unlike
rendering's partial union. A stat that recorded a dip because one provider was briefly unavailable
would be a number that never happened. Skips are named in the run's own detail line, for example "12
sampled, 2 skipped: github unavailable", so a chart with holes in it can be explained rather than
mistaken for a quiet failure.

The store keeps hourly samples for 14 days, then compacts them to one value per UTC day, the day's
last value rather than an average, for up to 400 days total. That is just over a year, so a "vs last
year" comparison has an answer for as long as anyone is likely to ask one. A hard cap of 1000 samples
per panel exists only to bound a bug in compaction, and the retention windows above land well under
it. The daily `core:compact-history` pass also drops the history of any panel whose definition has
been deleted, using the set of panel ids the prefs blob defines rather than what is placed, since
unplacing a panel must not delete its history. When the prefs blob cannot be read, compaction skips
this sweep entirely: treating "could not read" as "no panels exist" would delete every series over a
transient error.

Changing a panel's meaning, such as adding a filter, resets its series. The old samples would
describe a different measure and sitting them beside the new ones would be a lie, so the store
discards them and the trend visibly restarts.

The reset is driven by a signature (`dashboards-core/signature.ts`) over the parts of the definition
that change what the measure means: `queries` (ids and params), `mapping`, `shaping.filters`,
`view.aggregate`, and `view.field`. Everything else is left out on purpose. The view kind, sort,
limit, the field projection, the title, the geometry, and the trend, compare, and good display keys
change how the number is presented rather than what it is, so retitling a panel or dragging it to a
new column does not invalidate a fortnight of history. `sort` and `limit` are a judgment call rather
than an oversight: a limit does bound the row set an aggregate runs over, but a stat with a limit is
rare enough that resetting everyone's history for it costs more than it buys. Move a field onto the
"in" side the day a real panel needs it, and the signature changing is the honest reset.

### The mapping layer, and cross-source panels

A panel over more than one collection, or over one with user-declared columns, goes through
`dashboards/mapping.ts`. Three sub-layers apply in order: **field mapping** (which of a source's
fields feeds each panel-local field), **value mapping** (which of a source's enum values land in each
of the panel's columns), and the **derived enum** (the columns themselves, with ids, labels, and
tones the user invented, belonging to no plugin).

Six things about it are decisions rather than implementation:

- **A mapped panel's fields are the role vocabulary, plus whatever the user invented.** The roles are
  what the host can align without asking, which is the argument for them existing, and they are also
  a real ceiling: github's `repo` and linear's `identifier` are both text, both useful on a mixed
  board, and neither carries a role. So a person can declare a panel-local field with a name and a
  type from the wire's own seven, and answer per source which field feeds it. It is the same matrix,
  one row longer. An invented field renders, sorts, filters, and groups through the machinery a
  declared one does, so there is no second class of field anywhere. It has no role to fall back on,
  so a source left unanswered is empty for it rather than guessed at, and nothing about the wire
  changed to allow any of it.
- **A row's source is a field too.** A panel over more than one collection grows one built-in
  panel-local field, `source`: an enum whose values are the panel's own source keys, labelled with
  the providing plugin. It is fed by the host's provenance stamp rather than by any mapping row, so
  the matrix has no row for it because there is nothing to answer, and it carries no tone, because
  provenance is identity and github is not "ok". Because it is an ordinary enum, everything
  downstream works uninvented: `series` can name it to split a line by github against linear,
  `groupBy` can make a by-source board, filters can hide one source without unmapping it, and the
  projection can too, which is why the table's Source column is an ordinary column rather than a
  hardcoded one. A single-source panel does not grow it, because a split over one source is a no-op
  nobody should be offered. The list and the board still draw the badge in its own slot, so they
  leave the field out of the meta strip rather than printing it twice.
- **The derived enum is the panel's `status` field**, so the board draws the user's columns without
  knowing a mapping exists. The unmapped-value rule above is inherited rather than re-derived, and
  the mapping's `unmapped` key chooses between the catch-all column and hiding the row, never
  silently dropping it.
- **`bySource` is keyed by `(pluginId, collectionId)`**, never by the query's array index, so
  removing a source cannot silently rebind another source's mapping onto a different provider's
  values.
- **The role is the runtime default, not a one-time copy** into the config, so a panel that never
  opened the mapping step still unions correctly and a plugin that moves a role to another field is
  followed. An explicit `''` is the user saying "this source has nothing here", which is a different
  answer from an absent key.
- **Fetching is per collection and the union is client-side**, so two panels over one collection
  share the read, a slow source does not hold up a fast one, and partial availability is data: a
  source that failed is a banner naming that source with the rest of the panel still rendering. A
  panel goes inert only when none of its collections resolve.

Nothing in that layer is reachable from a manifest, and none of it grew the wire format. Neither
plugin knows the other exists. If a change here wants a new protocol field, that is the design
failing rather than the protocol being short.

### The generated editor

No panel settings UI is hand-written, because a hand-written editor drifts from its schema. The
controls cover title, view kind, group-by, filters, sort keys, limit, the visible-field projection
and its order, the measure a stat or a chart draws, a chart's shape and axes, per-panel refresh, the
mapping step including the fields the user invented, and the collection's declared params.

**Two presentations, one truth.** Creating a panel and editing one are different problems, so they
are asked differently, and neither implements a rule of its own:

- **Creation is a wizard** (`dashboards/PanelWizard.tsx`), four steps with a live preview beside
  every one of them. *Data* is a gallery of collection cards showing the field vocabulary, the
  refresh cadence, and what this device has cached, plus the declared params, because a param changes
  what the rows are. *View* is five cards, always all five, each with a schematic, where a card the
  data cannot support says why. *Shape* is the shaping and mapping controls. *Place* is the title, an
  S/M/L starting footprint, the destination surface, and the panel's own refresh. Nothing is written
  until the last step commits, and Escape at any step writes nothing.
- **Editing is one sheet** (`dashboards/PanelEditor.tsx`), every decision at once, for a panel that
  is already on screen. It remains able to do everything the wizard can. The wizard is a staging of
  creation rather than a capability tier, and its footer hands the draft straight to the sheet.

Both render the same sections (`dashboards/PanelForm.tsx`) over the same in-memory draft
(`dashboards/draft.ts`), which holds the form state and calls the pure rules. The preview is the real
panel: the same view components (`views/PanelBody.tsx`) over the same compose, mapping, and shaping
pipeline a placed panel runs, so what a commit writes cannot differ from what was on screen.

Neither surface fetches. The preview and the gated sections read only what this device has already
cached, reactive to the query cache so an answer landing mid-compose fills them in place. Whether an
editor may run a collection to learn its shape is a separate question with a person behind the
button. See [dynamic collections](./future/dashboards/dynamic-collections.md).

The inputs on both are selectors: typed, data-aware controls that each know the schema they draw
from. Pick a field of a given type, pick a comparison the field's type can answer, pick a value drawn
by the field's semantic type, map these values onto those columns, pick a tone. The promise is split
in two. Selectors make a bad choice unofferable, and `normalizePanel` drops the stale choices no
selector can catch, such as a filter over a field that went away when the collection was swapped.

The pure derivations behind the selectors live in `dashboards/editor.ts`, `dashboards/compose.ts`,
`dashboards/mapping.ts`, and `dashboards/chart.ts` rather than inside the components, because vitest
here runs in node with no Solid plugin. A component in this repo cannot be tested, so the parts that
can be wrong live where they can be. The same rule puts every scale, tick, and rect in
`dashboards/chart.ts` and `dashboards/layout.ts`.

Everything pure in that list moved to `packages/dashboards-core`, because the node's measure sampler
has to compute a panel's number with the same functions the renderer draws it with (see
[schedules](./schedules.md)) and a client package cannot enter the node's graph.
`client-core/src/dashboards/*.ts` are one-line re-exports, so every path named in this document still
resolves and every component here still says `./model`. Only `editor.ts`, `data.ts`, `draft.ts`,
`persist.ts`, and the components stayed, because they read registries, signals, or the query client,
which is the line the new package draws.

## Persistence

Panel definitions and placements are one JSON blob in the owning node's per-user prefs, as the
`core.dashboards` persisted-state slice, versioned from day one. They are not device state. A panel
describes that node's resources, so it follows the resource (see
[scope rules in the state doc](./state.md)) and every client paired with that node renders the board
its owner built. The device's query cache stays the offline read fallback, as for every other
node-backed read.

The definition codec is shared with the node, in `@acorn/dashboards-core/definition.ts`. The measure
sampler reads the same blob the clients write and has to parse it through the same parser rather than
a second one that agrees today. `persist.ts` keeps the store, the slice registration, and the
geometry codec, because a rect is a rendering concern the node has no use for.

The chart keys, `shape` and the axis fields that go with it, are parsed the same tolerant way: any
value outside the literal set is dropped rather than coerced. An old client that writes the blob
loses them and the chart falls back to its inferred defaults, so the panel survives. An old client
rendering a `chart` panel already shows "view unavailable" rather than drawing something it cannot.

`PanelView` also carries three optional stat keys, parsed exactly like the chart keys and dropped
when malformed: `trend` (`'history' | 'activity'`), `compare` (`'day' | 'week'`), and `good`
(`'up' | 'down'`). `trend: 'history'` is what the node's sampler selects a panel on, and the trends
section is what they draw. The honest ceiling is the chart keys' own: an old client that writes the
blob drops them, the panel survives as a plain stat, and the series stops accruing until a newer
client writes them back.

**Placements reference panel definitions by id; they never embed them.** Embedding panel config
inside a "home dashboard" blob works right up until panels need to live in a second place, and then
it is a migration. A placement scope key is `(surface, ownerId?, workspaceId?)` with segments encoded,
so an owner id that itself contains a separator can never be read as two. Two surfaces are drawn:
`home` (a tab per `ownerId`, per workspace) and `plugin-region` (a rail source's side panel or a
pane's aside, `<pluginId>:<somethingId>`). `pane` stays in the key grammar although its one owner,
the per-task dashboard pane, is retired. Stored `pane/dashboard` entries keep parsing, they just have
no container to render in. The split did its job: every surface arrived as a container and a scope
constant, and none of them touched the key format or the panel.

**Geometry is a third top-level key, `layouts`, keyed by the same scope then by panel id**, four
small integers per placed panel. It is a sibling key rather than turning the placement entries into
objects, and that is a compatibility decision rather than a tidiness one. The placement parser keeps
only string entries from the array, so object entries would parse to an empty placement and the board
would vanish on any client older than the change. A sibling key is invisible to an old parser, which
renders the order-only grid it always did. The honest ceiling, on the record: an old client that
writes the slice serialises only what it parsed, so a write from one drops `layouts`, and geometry
resets to auto-placement while the panels, their definitions, and their order all survive. Losing
arrangement and keeping composition is the right way round.

A rect belongs to a `(scope, panel)` pair, never to the definition, so the same panel placed on Home
and in a plugin region has two of them. A placed panel with no rect is auto-placed at render, which
is one rule serving three cases at once: the migration for every existing blob, the recovery from an
old client's write, and the default for a newly added panel.

**Home tabs are a fourth top-level key, `tabs`**, a list of `{ id, name, workspaceId? }` in display
order and nothing else. A tab is the placement scope `{ surface: 'home', ownerId: tabId, workspaceId }`,
so its panels are ordinary placements and its geometry an ordinary `layouts` entry. Only names, order,
and the owning workspace are new. The default tab's id is `''` in every workspace, so identity is the
pair, and the cap is per workspace too: one workspace at eight dashboards costs another nothing. With
no workspace known the key encoder drops both trailing segments and the key is the bare `home`, so
every blob written before tabs or workspaces existed is already a valid one-tab state. For which
workspace adopts it, see the Placements section. It is parsed tolerantly like everything else:
duplicates dropped keeping the first, at most 8 tabs per workspace, names trimmed to 60 characters
rather than dropped.

The renderer derives its tab list as the current workspace's entries in `tabs` plus any of its
`home/*` scopes that has placements and no name, shown as "Untitled". That one rule does three jobs:
it is the recovery from an old client that wrote the slice and dropped `tabs`, the defence against a
partially written blob, and the reason losing a name can never be what loses a composition. The
ceiling matches the one on `layouts`. An old client writing the slice loses names and order and keeps
every panel, and an old client rendering sees only the bare `home` scope, with the other tabs' panels
intact and invisible until a newer client draws them. Deleting a tab unplaces and never deletes
definitions, and the default tab has no delete, because it is the bare scope and deleting it would
only mean emptying it.

**Unknown ids survive inert.** Parsing answers "is this shaped like a panel?", never "is that
collection registered in this build?", which is the pane-layout rule verbatim. The registry lookup
happens at render, and three things degrade rather than disappear: a panel whose collections are not
registered here draws as "source unavailable", a view kind this build cannot draw says so instead of
being coerced to a list, and a placement entry with no definition is skipped without being deleted. A
person's composition is never collateral damage of switching a plugin off, and a definition written
by a newer client round-trips through an older one intact. The codec is hand-written and tolerant,
like every other slice: it must never throw on malformed input.

A malformed rect is dropped rather than repaired into place, so the panel it belonged to becomes
rect-less, which is a case that already has an answer. A rect naming a panel not placed in that scope
is retained unread, because dropping it would make a partially written blob destructive. Geometry did
not bump the slice version: it is additive, both directions degrade as described, and the shape
parses under a parser that has never heard of it, which is what the version is a statement about.

One key is carried across deliberately unread. `writeValue` on a mapping column is the board-drag
write-back seam. Nothing sets it or looks at it, and it still round-trips, because a reserved shape
the codec quietly deletes is not reserved.

## Placements

**Home** is the default, and it is a dashboard and nothing else. A person who has placed no panel
sees no heading, no empty grid, and no invitation, just one ghost button. Panels already placed still
render when a plugin goes away.

Home used to open with the workspace's active tasks above the panels. That list was on the screen
whether or not it was being read, and it was the one thing a person could not take off their own home
page. The same rows are a collection now (§ Declaring one, `core:tasks`), so anyone who wants them
places them, sorts them, filters them, and sizes them. A row still opens its task through the
`openTask` verb, which exists because a row whose thing is a task has nowhere else to send a click.

**A Home board belongs to one workspace, and switching workspace switches the board.** The panels,
their arrangement, and the whole tab bar are the current workspace's. Another workspace's are not
merged in, not greyed out, and not reachable from here.

The reason is what a row does when you click it. A panel's rows are work, a pull request, an issue, a
task, and a row's in-app action resolves against the workspace you are in. On one shared board the
same panel could offer you a row whose project lives somewhere else entirely, and following it meant
a workspace switch the board never mentioned, or nothing at all. Scoping the board makes "the rows
here are about the work here" true by construction rather than by whoever composed it being careful.

The workspace is the scope key's third segment, so nothing about a panel changed: definitions stay in
one library and the same panel can be placed on a board in every workspace, each with its own rect.
Which workspace that is comes from the routed project, the same derivation the rail and the topbar
already make (`workspaces/activeWorkspace.ts`). Before the mapping loads there is no workspace, and
Home draws the board that has none.

**A board written before this is adopted by the first workspace to open Home**, once, keys and names
together (`adoptLegacyHome`). The old board named no workspace, so there is no better guess than the
one the person is looking at, and every other choice leaves the panels invisible until they go
hunting. Adoption never overwrites: a workspace that already has a board of its own keeps it, and the
old one stays where it is. The ceiling is the one every key here has. A client that does not know
about workspaces sees the bare `home` scope, which after adoption is empty, and writes back a `tabs`
list with the workspace stamps stripped.

**Plugin regions are not scoped this way.** A region hangs off a surface that is already pinned to a
project or a plugin pane, so a second scope on it would be a key with no question behind it.

**Home can hold several dashboards, as tabs**, and the bar exists only past one of them. With a
single dashboard Home is what it always was, with no bar and no "1 of 1" chrome, and the feature
costs nothing until it is used. Past one, the bar takes the "Panels" section-header seat, because
tabs are the heading when there are several. The Add-panel button keeps its right-aligned place on
the same row. It is a standard ARIA tablist: arrows move selection with activation on focus, Home and
End jump, roving tabindex, and the grid below is the
`tabpanel` the active tab labels.

A tab is created by the ghost `+` at the end of the bar, which drops straight into an inline rename,
because a dashboard called "New dashboard" forever is what happens when naming it is a second trip.
The per-tab verbs (rename, move left, move right, armed delete) live in a small overflow on the
active tab and on the context menu of any tab. Deleting is armed and says what survives: panels stay
in the library and on other tabs. The first extra dashboard is created from the wizard's Place step,
whose Dashboard picker always offers "New dashboard…", because the bar's `+` cannot be the only door
when the bar is what one dashboard does not have. Picking it reveals a name field under the picker,
for the same reason the bar's `+` drops into a rename. Empty falls back to the unique default, so it
stays an option rather than a step, and nothing is written until the last step commits either way.

Creating that first extra dashboard is also what first writes the `tabs` key. The original tab has no
entry of its own until then, so it is named `Home` at the same moment, and a bar whose first tab has
no name is never seen. Every name from then on, typed or defaulted, is deduplicated against the
existing ones as `New dashboard`, `New dashboard 2`, and so on up to the tab cap, so two tabs can
never read the same. A panel moves between tabs through **Move to…** in its own overflow menu,
keeping its definition and taking a fresh rect at the destination.

**Which tab you are reading is device view-state**, the `core.home-tab` slice beside
`core.last-source` in the device-pref list. The composition belongs to the node and is shared by
every client paired with it. Which of its dashboards this screen happens to be showing is a property
of this screen, and syncing it would move somebody else's view under them. A remembered tab that has
since been deleted falls back to the default rather than drawing an empty grid. A tab another
workspace owns is the same case: switching workspace lands on that workspace's default board, and
switching back returns to the tab you left, because the remembered id was never overwritten.

**The task pane placement is retired.** It was keyed by pane rather than by task, so the same board
rendered beside every task, which turned out to be noise beside the work rather than context for it,
and the pane was removed from the switcher. The `pane` surface stays in the scope-key grammar so
stored `pane/dashboard` placements parse instead of corrupting the slice, and nothing draws them. If
a per-task or per-project board is ever wanted, the answer is a narrower id in the scope's third
segment, which is where the workspace already goes, not a fourth segment and not a task one.

**Plugin regions** are the remaining placements, and they are the same `PanelGrid` again: a rectangle
a plugin reserved in one of its own surfaces for panels the user composes. Two surfaces reserve one:
a rail source's side panel, beside its list, and a `pane.aside` extension point, beside a plugin
pane's frame. Both are stored under `plugin-region/<pluginId>:<somethingId>`, which is why the scope
key percent-encodes its segments.

**The host draws the region; the plugin's manifest only reserves it.** Panels are host Solid
components and a sandboxed frame is a separate realm, so "a rectangle for dashboard items" can never
mean "inside my iframe". The precedent is the document surface's frame `layout` templates, where the
manifest reserves part of the rectangle and the host draws that part, and no bridge API may pretend
otherwise.

What the owner may say about its rectangle is one small vocabulary, shared by both surfaces: which
collections (its own by default, or an explicit list of `<pluginId>:<collectionId>` references, or
"any collection with a status-role field"), which views, and how many panels. Those constraints are
enforced twice, the pattern the repo uses everywhere. The editor's selectors do not offer a
disallowed option, and the host re-checks at render, because a manifest arrives inside a roster row
and a plugin can narrow its own region in an update long after somebody composed against the wider
one. A panel refused at render is not drawn here and nothing is deleted: it survives in the library
and on every other surface it is placed in. A panel whose collection is merely unresolved is admitted
and draws inert, so a disabled plugin never looks like a policy refusal.

A region also declares no rectangle of its own beyond its location. A source that declares nothing is
pixel-identical to what it was before the key existed, and a source cannot both reserve a region and
navigate to a project-scoped surface, because the detail half of a master/detail browse is already
drawn in that seat. The manifest refuses the pair at parse.

With more than one surface, Remove and Delete are two different things. "Remove from here" unplaces.
"Delete panel" destroys the definition and is armed, because the editor makes a definition genuinely
expensive to recompose, with filters, a sort, a projection, and a whole mapping matrix, and one
misclick should not cost all of it.

**Every placement survives its plugin.** A region whose owning plugin is disabled or uninstalled
disappears from view and its persisted definitions survive inert, returning with the plugin. The
user's hand-built compositions are never collateral damage of a plugin lifecycle event, on any
surface.

### The grid

A placement is 12 columns of square cells, each panel at an explicit `{x, y, w, h}`. Twelve because
it divides into halves, thirds, quarters, and sixths, and because a fixed count is what makes a rect
mean the same thing across window sizes and across the clients that share the blob. Square because
that is what makes "3 wide, 2 tall" mean something visually. Rows are unbounded downward, because the
page scrolls, and that asymmetry does real work below. The cell size is the one pixel measurement in
the feature, a `ResizeObserver` on the grid, and the accepted consequence is that panel heights
breathe with window width.

Three behaviours, taken whole from Grafana and react-grid-layout because a decade of dashboards has
not needed anything richer:

- **A dragged panel pushes what it lands on down.** Never sideways, never a swap. Down is the only
  direction with unlimited room, so a push always succeeds, chains terminate, and the result is
  predictable enough to preview live.
- **A widening resize pushes neighbours right, and the chain stops at the wall.** The resize clamps
  at the widest width for which the chain still fits, and the handle stops moving. Nothing wraps and
  nothing jumps rows: a neighbour teleporting to the next row because you widened something is the
  disorientation this rule prevents. Growing taller pushes down instead, and never clamps.
- **Vertical compaction is always on.** Removing a panel heals the page and the narrow-window
  collapse is well-defined for free. The cost, that you cannot deliberately leave a vertical gap, is
  the trade Grafana ships with. A deliberate gap within a row is a layout choice and survives.

The preview during a gesture is the layout algorithm running on the candidate position rather than a
separate visual effect. Release persists exactly what was on screen, so no commit computation can
disagree with the preview, and Escape costs nothing because nothing was written. The panel drags by
its header only. The body scrolls, selects, and clicks, and leaving it gesture-free is also what
keeps a future board-card drag unambiguous. See [write-back](./future/dashboards/write-back.md). A
dot lattice marking cell intersections appears when a gesture arms and vanishes when it ends,
iOS-widget style, so nothing about the layout is discoverable chrome until a gesture makes it
relevant. The landing slot is drawn as the shape of the panel, with the panel's own radius, a solid
edge, and a wash of the accent, rather than as a dashed wireframe of it, and it glides between
candidates while the dragged panel itself is lifted (shadow plus a 1.5% scale) so source and payload
never look alike.

Panels are positioned absolutely from the measured cell rather than by `grid-area`, and that is a
deliberate cost: `grid-area` cannot be transitioned, so push-down and compaction jumped between
frames and a drag read as a reshuffle. The container therefore states its own height from the live
layout, which means a mid-gesture preview resizes it. That is safe only because the `ResizeObserver`
measures width and never writes back into the layout. The collapsed one-column mode keeps ordinary
block flow.

Panel chrome earns its pixels on approach. A six-dot grip, the refresh button, and the overflow
trigger all fade in on hover or focus-within, and the resize corner carries a faint always-visible
mark so a panel reads as resizable before it is touched. The freshness word does not hide, because
state is not decoration.

Every pointer gesture has a keyboard equivalent driven through the same pure functions. Drag sits on
top of the accessible path rather than instead of it, which is the commitment reorder made when it
was menu items only. "Move / resize" in the overflow menu puts the panel in layout mode where arrows
move by a cell and Shift+arrows resize. Enter commits, Escape restores. The position is announced
through a live region and drawn as a caption beside the panel, the same computed string twice,
because a sighted keyboard user was otherwise getting strictly less than a screen-reader one. Move up
and move down survive too, reinterpreted onto geometry as a swap toward the neighbour in reading
order.

Below roughly twelve 44px cells the grid collapses to one column in reading order and the gestures
disarm. That is purely presentational, so nothing in storage changes and widening the window restores
the arrangement exactly, and it is what makes a pane-sized placement work at all. `placements` is
rewritten to reading order, sorted by `(y, x)`, on every commit, which keeps three things true at
once: a client with no geometry renders a sensible order, the collapse needs no second opinion, and
screen-reader document order matches visual order without a separate bookkeeping pass.

All of the arithmetic is pure functions in `dashboards/layout.ts`, exhaustively unit-tested.
`PanelGrid.tsx` turns pixels into a candidate rect and renders the answer, and contains no layout
arithmetic of its own.

**A rect is client machinery, and no plugin can influence one.** Nothing about the grid crosses the
node and client contract, so a collection provider cannot know or set where its panel sits. A
"preferred size" hint from a plugin was considered and refused: the view kind already implies a
sensible default, and a plugin with opinions about the user's grid is a plugin with a say over
pixels. The per-kind minimums and arrival sizes are a tuning table in `layout.ts`, enforced in
`normalize` and in the resize clamp rather than in the codec, so lowering one needs no migration. A
persisted rect below the minimum renders at the minimum without being rewritten.

## What is deliberately not here

Reasoning and revisit conditions for each are in
[the refusals list](./future/dashboards/refused.md), and the ones that are planned rather than
refused each have a deliverable spec in [the dashboards backlog](./future/dashboards/README.md).

- **Board-drag write-back.** Panels are read-only, dragging a card between columns is a mutation, and
  value mappings are many-to-one. GitHub's `merged` and `closed` may both land in `Done`, so dropping
  a card there has no unique answer. The answer is a designated write-value per (source, column),
  which is why the persisted shape is a record per column rather than a value-to-column lookup.
  Verb-shaped mutations through `runNodeAction` are not refused and work today, with the risk tier
  above.
- **Cross-collection joins.** A panel unions collections and maps fields. It does not join them.
  Joins need key relationships the contract does not express, and `contentLinks` and `refResolvers`
  already cover the adjacent need.
- **A dynamic discovery route, and run-once-and-pin.** Collections are manifest-static or
  compiled-registered only. Discovery is the two-route `agentContexts` pattern when the saved-SQL
  case needs it, and static declaration is then the degenerate case. Both also wait on the taskless
  database connection, described in [project database](./future/dashboards/project-database.md),
  which the saved-SQL case turned out to require first.
- **A per-plugin "dashboard" contribution.** A plugin does not ship a prebuilt dashboard. If starter
  panels prove wanted, the shape is a plugin-suggested panel definition the user accepts into their
  own composition, so ownership of composed panels stays with the user.

## Related

- The `collections` manifest key beside the other descriptor kinds, and the master/detail refusal
  this sits next to without reversing: descriptors in [the plugins doc](./plugins.md).
- Why descriptors exist and why the verb set stays closed: [extensibility](./extensibility.md).
- The mirrors a collection route projects over: [data layer](./data-layer.md).
- Why panel definitions follow the node rather than the device: [state](./state.md).
- The backlog, one deliverable per file, plus the refusals:
  [dashboards backlog](./future/dashboards/README.md).
