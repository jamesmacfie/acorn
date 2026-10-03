# Panels

A panel is what you composed: data, how it's mapped and shaped, and how it's drawn. This page covers a
panel's layers, the display vocabulary its fields use, where a row says it came from, and what
clicking a row does. The model is `packages/dashboards-core/src/model.ts`.

## Panels

A panel definition has four layers, each owned by a different party:

| Layer | Owner | Contents |
| --- | --- | --- |
| `sources` | The plugin's meaning, your choice | The projected typed query instances |
| `mapping` | Host, declarative | Per source: field mapping, value mapping, the derived enum, and invented fields |
| `shaping` | Host, declarative | Filters, sort, group-by, limit, and the visible fields |
| `view` | Host | Which view, its measure, and for a chart its shape and axes |

The layers let you flip a table to a board without losing filters, and swap a source without losing
the layout. Shaping is generic and runs over the projected rows (`shaping.ts`). Filters are all-AND
with seven operators, because an OR tree is a query language, and a panel that needs one belongs in
the source's query. Group-by is shaping, not a view option, so it survives a view switch.

Where a panel is placed isn't a layer. A definition is free of any surface, and a placement refers to
it by ID and owns its geometry ([placements](./placements.md)).

A panel's own refresh is held between 30 seconds and a day (`panelRefreshSeconds`). With none set, the
source's declared hint applies, and with neither, the panel doesn't poll.

## The two vocabularies, and the budget

The display projection (`display.ts`) has seven field types and five roles, both closed:

| Type | Drawn as | Enables |
| --- | --- | --- |
| `text` | Plain text | Filter |
| `number` | Formatted, with the field's `unit` | Sort, `sum`, `avg`, `min`, `max` |
| `boolean` | Check or dash | Filter |
| `datetime` | Absolute plus an age, epoch milliseconds in data | Sort, before and after |
| `enum` | A toned chip from the field's declared values, with the value's `icon` in place of its dot | Group-by, filter |
| `person` | A monogram and the name | Filter |
| `link` | An anchor that doesn't trigger the row's action | Click-through |

The roles are `title`, `status`, `assignee`, `url`, and `updated`. A role is the one thing two
separately written sources agree on without being asked, so it's what the mapping layer pre-fills
from. An absent cell draws a dash. A `person` monogram comes from the name itself, because resolving a
real avatar would be a guess drawn as fact.

The budget is the design. Every type is a rendering, sorting, grouping, and filtering rule that every
source inherits, so a new type needs an argument. Display hints hang off the field, not the panel, so
a unit survives a switch from table to list. Tones come from the host's `StatusDot` vocabulary, `ok`,
`warn`, `bad`, `muted`, and `accent`, so an appearance pack owns the color.

## Provenance, and what a row may not claim

A row's `pluginId` and query-instance `sourceId` are the host's stamp, copied from the typed record
reference, never accepted from a plugin's display row (`unionRows` in `mapping.ts`). A row that could
name its own source could put a stranger's items under a stranger's badge. The badge is the plugin's
`brand:<pluginId>` mark, or its ID as text (`views/Provenance.tsx`). Row IDs are qualified by source,
because two providers can both have a row `42`.

Pressing a row in a placed panel runs its declared action through `runChromeAction`, the dispatcher a
rail row uses. A row may name its `taskId`, which lets `openPane` and `openTask` land in the row's own
task. An action whose `risk` is `write` or `execute` asks first, in a host-drawn strip above the rows,
because a plugin that drew its own dialog could draw a reassuring one. Rows in the editor's preview
aren't pressable.

`openUrl` isn't automatically a trip to the browser. The dispatcher first asks the content-link
registry whether acorn has its own surface for the URL (`openInAppUrl` in
`packages/client-core/src/host/registries/panes/contentLinks.ts`). There are three destinations:

| Declared | Destination | Example |
| --- | --- | --- |
| `path` on the recognizer | The plugin's own route | GitHub, `/p/:projectId/pulls/:number` |
| `providerId` and a `refPanel` frame | The reference panel, over the page | Linear |
| `openPane` on a content link | A task pane, when a task is open | Linear |

The clicking surface ranks them through `prefer`, because the target can't know where you are. A
dashboard row asks for `route`, because you're looking at the list in order to leave it. A surface you
work inside asks for `refPanel`, because swapping what you're reading is the worse mistake. A caller
that states nothing gets pane, then panel, then route. Each rung can be unavailable, and a URL nothing
claims opens in the browser.

### Taking a route also selects the rail source that owns it

The shell draws from the rail selection, not the location, so navigating to another source's route
without selecting it would move the address bar and leave the dashboard on screen. So taking a route
also selects the source that owns it (`sourceIdForPath` in
`packages/client-core/src/host/registries/sources/sources.ts`). A path no source claims leaves the rail
alone ([rail and routing](../frontend/rail-and-routing.md)).
