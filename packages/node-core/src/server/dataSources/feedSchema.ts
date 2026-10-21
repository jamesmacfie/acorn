import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// Every plugin's event feeds, in one core table keyed by plugin and source (docs/data-sources/event-feeds.md).
// `seq` is AUTOINCREMENT so it never goes back after a prune: it's a feed's continuation boundary.
export const dataFeedEvents = sqliteTable(
  'data_feed_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    pluginId: text('plugin_id').notNull(),
    sourceId: text('source_id').notNull(),
    eventId: text('event_id').notNull(),
    time: integer('time').notNull(),
    dataJson: text('data_json').notNull(),
    title: text('title'),
    url: text('url'),
  },
  (t) => [
    uniqueIndex('data_feed_events_identity').on(t.pluginId, t.sourceId, t.eventId),
    index('data_feed_events_feed_seq').on(t.pluginId, t.sourceId, t.seq),
  ],
)
