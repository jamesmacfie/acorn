# Event feeds

An event feed is a data source the host stores and serves for a plugin. The plugin declares it and
appends events, and the Node answers `describe` and `query` from its own table. It's part of the
[typed data sources](../data-sources.md) contract. [Plugin triggers](../plugin-authoring/triggers.md)
covers when to use one.

## Declare a feed

A loaded manifest puts a feed in `contributions.dataSources`, as an entry with `feed` and no handler or
provider. A compiled plugin calls `ctx.dataSources.registerFeed` with the same shape.

```json
{
  "sourceId": "alerts",
  "name": "Load alerts",
  "singular": "Alert",
  "plural": "Alerts",
  "identityScope": "An alert ID is unique for this plugin.",
  "feed": { "schema": { "...": "..." }, "fields": [], "retentionDays": 14, "maxEvents": 10000 }
}
```

- `schema` is an object schema for an event's `data`, and `fields` describes its fields. The host
  adds a `time` field to every record, so the schema can't declare one.
- `starterTriggers` holds up to 10 suggested triggers, checked the way any source's are.
- `retentionDays` and `maxEvents` default to 14 and 10,000, which are also the most a feed may keep.

`defineEventFeed` in `acorn-plugin-sdk/data` builds the entry from `field` builders. Its `description`
comes from `feedDescription` in `packages/protocol/src/data/eventFeeds.ts`, the function the Node
serves the feed with. The Node's registration is `packages/node-core/src/server/dataSources/feeds.ts`.

## Append

```ts
const stored = await ctx.dataSources.append('alerts', [
  { id: 'web-1:1729400000', time: Date.now(), data: { host: 'web-1', load: 6.2 }, title: 'web-1 load 6.2' },
])
```

`append` takes at most 100 events. It checks each one against the feed's schema and the shared value
limits, and refuses the whole call if one fails. It skips an ID the feed already holds, stores the
rest, and drops the oldest past `maxEvents`. When it stored any, it calls `changed()` for the feed, so
a trigger checks within seconds. It resolves to the count stored. The host binds the caller's plugin
ID, so a plugin appends only to its own feeds.

## What the host serves

- `describe` returns the declared fields and `time`, with `incremental` and event coverage. The host
  picks each field's operators: a required top-level field takes every operator its type allows, and
  any other takes none, because a comparison with a missing value fails. `time` is sortable.
- `query` returns events newest first, filtered and sorted by the shared evaluator,
  `selectDataRecords` in `packages/node-core/src/server/dataSources/selection.ts`. An incremental
  read's boundary is the newest stored sequence number it saw, and a later read continues after it.
- An event stored under an older version of the feed's schema is skipped, and the read is
  `incomplete` with `invalid-records`.

A feed is an ordinary source after that: a panel can chart it and a **Find records** step can read it.

## Storage, retention, and purge

Events live in the core table `data_feed_events`, keyed by plugin and source, in
`packages/node-core/src/server/dataSources/feedStore.ts`. The daily `core:prune-feeds` job removes
each registered feed's events older than its `retentionDays` ([schedules](../schedules.md)). A feed
whose plugin isn't loaded keeps its events until the plugin returns or is purged. Uninstalling with
purge removes the plugin's events through `cascadeDeletePluginData`
([data ownership](../plugins/data-ownership.md#uninstalling)).

The trust prompt adds one line per feed beside its **A data source** line: "Store up to 10,000 events
from this plugin", with the retention under it. The cap is in the line's key, so a version that keeps
more reads as newly requested.
