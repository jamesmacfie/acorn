// The event feed store: what `ctx.dataSources.append` writes, what a feed's source reads, and the daily
// retention pass (docs/data-sources/event-feeds.md). Loaded on first use.
import { z } from 'zod'
import { DATA_FEED_LIMITS, type DataSourceRequest } from '@acorn/protocol/dataSources.ts'
import { validateDataValue } from '@acorn/protocol/dataSchemas.ts'
import { DATA_LIMITS, type DataValue } from '@acorn/protocol/dataValues.ts'
import type { Env } from '../bindings'
import { getDb, type AppDatabase } from '../db'
import { dataSourceChanged } from './changes'
import { registeredDataSource, registeredDataSources, type DataFeedSettings } from './registry'
import { createDataSelectionPager, selectDataRecords } from './selection'
import { DataSourceError } from './validation'

const DAY_MS = 86_400_000

/** One event as `append` takes it. `data` is checked against the feed's schema after this. */
const eventSchema = z
  .object({
    id: z.string().min(1).max(200),
    time: z.number().int().min(0),
    data: z.record(z.string(), z.unknown()),
    title: z.string().max(2048).optional(),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((url) => /^https?:/i.test(url), 'Expected an http or https address')
      .optional(),
  })
  .strict()

type EventRow = {
  seq: number
  event_id: string
  time: number
  data_json: string
  title: string | null
  url: string | null
}

/** Checks and stores a plugin's events in one of its own feeds, then says the feed changed. An event
 *  whose id the feed holds is skipped, and past the feed's cap the oldest events go. */
export function appendToFeed(env: Env, pluginId: string, sourceId: string, input: unknown): number {
  const feed = registeredDataSource({ pluginId, sourceId })?.feed
  if (!feed) throw new Error(`'${pluginId}' has no event feed named '${sourceId}'`)
  if (!Array.isArray(input) || input.length > DATA_FEED_LIMITS.appendEvents)
    throw new Error(`append takes a list of at most ${DATA_FEED_LIMITS.appendEvents} events`)
  const events = input.map((raw, index) => {
    const parsed = eventSchema.safeParse(raw)
    if (!parsed.success) throw new Error(`Event ${index} isn't a feed event: ${parsed.error.issues[0]?.message}`)
    const { data } = parsed.data
    try {
      validateDataValue({ ...data, time: parsed.data.time }, feed.description.schema)
    } catch (error) {
      throw new Error(`Event ${parsed.data.id} doesn't fit the ${sourceId} feed: ${(error as Error).message}`)
    }
    return parsed.data
  })
  const db = getDb(env).$client
  const insert = db.prepare(
    `INSERT OR IGNORE INTO data_feed_events (plugin_id, source_id, event_id, time, data_json, title, url)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const stored = db.transaction(() => {
    let count = 0
    for (const event of events)
      count += Number(
        insert.run(
          pluginId,
          sourceId,
          event.id,
          event.time,
          JSON.stringify(event.data),
          event.title ?? null,
          event.url ?? null,
        ).changes,
      )
    db.prepare(
      `DELETE FROM data_feed_events WHERE plugin_id = ? AND source_id = ? AND seq < (
         SELECT seq FROM data_feed_events WHERE plugin_id = ? AND source_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)`,
    ).run(pluginId, sourceId, pluginId, sourceId, feed.maxEvents - 1)
    return count
  })()
  if (stored) dataSourceChanged(pluginId, sourceId)
  return stored
}

const page = createDataSelectionPager()

/** Answers a feed's `describe` and `query`, newest first. An incremental read's boundary is the newest
 *  stored sequence number it saw. */
export async function serveFeed(
  env: Env,
  pluginId: string,
  feed: DataFeedSettings,
  request: DataSourceRequest,
): Promise<unknown> {
  if (request.operation === 'describe') return feed.description
  if (request.operation !== 'query') throw new DataSourceError('unsupported-query')
  const { sourceId } = request.query.source
  const incremental = request.query.incremental
  const after = incremental?.kind === 'continue' ? incremental.boundary : 0
  if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < 0)
    throw new DataSourceError('invalid-request', { reason: 'A feed continues from a sequence number' })
  const result = await page(`${pluginId}:${sourceId}`, request, async () => {
    const rows = getDb(env)
      .$client.prepare(
        `SELECT seq, event_id, time, data_json, title, url FROM data_feed_events
         WHERE plugin_id = ? AND source_id = ? AND seq > ? ORDER BY seq DESC`,
      )
      .all(pluginId, sourceId, after) as EventRow[]
    let invalid = 0
    const records = rows.flatMap((row) => {
      const data = { ...(JSON.parse(row.data_json) as Record<string, DataValue>), time: row.time }
      // An event stored under an older version of the feed's schema is skipped and counted.
      try {
        validateDataValue(data, feed.description.schema)
      } catch {
        invalid++
        return []
      }
      const display = { ...(row.title ? { title: row.title } : {}), ...(row.url ? { url: row.url } : {}) }
      return [{ recordId: row.event_id, data, ...(row.title || row.url ? { display } : {}) }]
    })
    const selected = selectDataRecords(records, request.query, { readOrder: true })
    const cut = selected.records.length > DATA_LIMITS.selectionRecords
    return {
      records: selected.records.slice(0, DATA_LIMITS.selectionRecords),
      revision: feed.description.revision,
      readTime: request.evaluationTime,
      completeness: cut
        ? { kind: 'incomplete' as const, cause: 'host-budget' as const }
        : invalid
          ? { kind: 'incomplete' as const, cause: 'invalid-records' as const, count: invalid }
          : selected.completeness,
      ...(incremental && request.mode === 'execution' ? { incrementalBoundary: rows[0]?.seq ?? after } : {}),
    }
  })
  // The pager copies the read onto every page, and only the last, complete page may carry a boundary.
  if (result.completeness.kind !== 'complete') delete result.incrementalBoundary
  return result
}

/** The daily pass: each registered feed drops events older than it keeps. */
export function pruneFeedEvents(db: AppDatabase, now = Date.now()): number {
  const remove = db.$client.prepare('DELETE FROM data_feed_events WHERE plugin_id = ? AND source_id = ? AND time < ?')
  let removed = 0
  for (const source of registeredDataSources())
    if (source.feed)
      removed += Number(remove.run(source.pluginId, source.sourceId, now - source.feed.retentionDays * DAY_MS).changes)
  return removed
}
