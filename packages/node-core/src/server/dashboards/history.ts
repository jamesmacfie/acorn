import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import type { DashboardHistoryResponse, DashboardMeasureSample } from '@acorn/protocol/api.ts'
import { type AppDatabase, schema } from '../db'

// The measure-history store (docs/dashboards.md § Trends).
//
// Node-side, its own table, and NO WRITE ROUTE: the sampler and the store share a process, so the
// only writer is the schedule. That is the whole reason this feature stopped being a client concern —
// an earlier design had clients PUT samples while panels rendered, with last-write-wins buckets to
// make several clients converge, and every part of that was compensating for the wrong writer.
// One writer needs no convergence.

/** UTC hour start for an instant. One sample per bucket per panel; the primary key makes finer
 *  granularity unrepresentable, so nothing downstream has to defend against it. */
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const hourBucket = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS
export const dayBucket = (at: number): number => Math.floor(at / DAY_MS) * DAY_MS

/** Hourly samples are kept this long; older buckets collapse to one per UTC day. */
export const HOURLY_RETENTION_MS = 14 * DAY_MS
/** Daily samples past this are dropped. Just over a year, so a "vs last year" question has an answer
 *  for as long as anyone is likely to ask one. */
export const DAILY_RETENTION_MS = 400 * DAY_MS
/** Hard cap per panel AFTER compaction; a series at the cap drops oldest first. It exists so nothing
 *  downstream has to trust the arithmetic above — 14 hourly days plus 400 daily days is ~736 rows, so
 *  a series that reaches this has found a bug in compaction and is bounded anyway. */
export const MAX_SAMPLES_PER_PANEL = 1000

// The wire shapes, from the protocol rather than spelled again here: the client draws the sparkline
// from exactly what this stores, and two declarations of one row is how the two come to disagree.
export type MeasureSample = DashboardMeasureSample
export type MeasureSeries = DashboardHistoryResponse

/** Record one sample, resetting the series first if the panel's meaning changed.
 *
 *  The signature check is here rather than in the sampler because it is a property of the STORE's
 *  contract: a row whose signature disagrees with the one being written describes a different
 *  measure, and keeping the two side by side would make every read ambiguous. */
export async function appendSample(
  db: AppDatabase,
  input: { panelId: string; signature: string; bucket: number; value: number; recordedAt: number },
): Promise<{ reset: boolean }> {
  const existing = await db
    .select({ signature: schema.dashboardMeasureSamples.signature })
    .from(schema.dashboardMeasureSamples)
    .where(eq(schema.dashboardMeasureSamples.panelId, input.panelId))
    .limit(1)
  const reset = existing.length > 0 && existing[0]!.signature !== input.signature
  if (reset) await deleteSeries(db, [input.panelId])
  await db
    .insert(schema.dashboardMeasureSamples)
    .values(input)
    // A bucket already written is OVERWRITTEN rather than kept: within one hour the later look is the
    // better answer, and `run now` from the settings page must not be a no-op for the rest of the hour.
    .onConflictDoUpdate({
      target: [schema.dashboardMeasureSamples.panelId, schema.dashboardMeasureSamples.bucket],
      set: { value: input.value, signature: input.signature, recordedAt: input.recordedAt },
    })
  return { reset }
}

/** The series for one panel, ascending. An empty series is `{ signature: '', samples: [] }` and never
 *  an error: absence is data, and a panel that has just been given a trend has to render its cold
 *  state rather than a failure. */
export async function readSeries(db: AppDatabase, panelId: string, since?: number): Promise<MeasureSeries> {
  const rows = await db
    .select({
      signature: schema.dashboardMeasureSamples.signature,
      bucket: schema.dashboardMeasureSamples.bucket,
      value: schema.dashboardMeasureSamples.value,
    })
    .from(schema.dashboardMeasureSamples)
    .where(
      since === undefined
        ? eq(schema.dashboardMeasureSamples.panelId, panelId)
        : and(eq(schema.dashboardMeasureSamples.panelId, panelId), sql`${schema.dashboardMeasureSamples.bucket} >= ${since}`),
    )
    .orderBy(asc(schema.dashboardMeasureSamples.bucket))
  return {
    signature: rows[0]?.signature ?? '',
    samples: rows.map((row) => ({ bucket: row.bucket, value: row.value })),
  }
}

export async function deleteSeries(db: AppDatabase, panelIds: readonly string[]): Promise<number> {
  if (panelIds.length === 0) return 0
  const result = await db
    .delete(schema.dashboardMeasureSamples)
    .where(inArray(schema.dashboardMeasureSamples.panelId, [...panelIds]))
  return Number(result.changes ?? 0)
}

/** Every panel this store holds samples for. The compaction pass uses it to find series whose panel
 *  has been deleted, which is how a removed definition's history goes without needing a route. */
export async function sampledPanelIds(db: AppDatabase): Promise<string[]> {
  const rows = await db
    .selectDistinct({ panelId: schema.dashboardMeasureSamples.panelId })
    .from(schema.dashboardMeasureSamples)
  return rows.map((row) => row.panelId)
}

export type CompactionResult = { collapsed: number; dropped: number; orphaned: number }

/** Retention, as one pass (`core:compact-history`, daily).
 *
 *  Hourly samples older than 14 days collapse to ONE PER UTC DAY, keeping THE DAY'S LAST VALUE — a
 *  stat shows point-in-time state, so last-known beats averaging, which would invent a number the
 *  panel never displayed. Daily samples past 400 days go. A series over the hard cap drops oldest
 *  first, and a series whose panel no longer exists goes whole.
 *
 *  `livePanelIds` is what the prefs blob currently defines. Passing `null` skips the orphan sweep,
 *  which is what a caller that could not read the blob must do: deleting every series because a
 *  preference read failed would be the worst possible response to a transient error. */
export async function compactHistory(
  db: AppDatabase,
  now: number,
  livePanelIds: ReadonlySet<string> | null,
): Promise<CompactionResult> {
  let collapsed = 0
  let dropped = 0
  let orphaned = 0

  if (livePanelIds) {
    const stale = (await sampledPanelIds(db)).filter((id) => !livePanelIds.has(id))
    orphaned = await deleteSeries(db, stale)
  }

  // Older than the hourly window: keep the LAST bucket of each UTC day, delete the rest. Done in one
  // read and one delete per panel rather than a clever SQL window, because a series is at most a few
  // hundred rows and this job runs once a day — the arithmetic being obvious is worth more here than
  // it being in the query planner.
  const hourlyFloor = hourBucket(now) - HOURLY_RETENTION_MS
  const oldRows = await db
    .select({ panelId: schema.dashboardMeasureSamples.panelId, bucket: schema.dashboardMeasureSamples.bucket })
    .from(schema.dashboardMeasureSamples)
    .where(lt(schema.dashboardMeasureSamples.bucket, hourlyFloor))
    .orderBy(asc(schema.dashboardMeasureSamples.bucket))

  const keepPerPanel = new Map<string, Map<number, number>>()
  for (const row of oldRows) {
    const days = keepPerPanel.get(row.panelId) ?? new Map<number, number>()
    // Ascending order means the last write for a day wins, which is the day's last value.
    days.set(dayBucket(row.bucket), row.bucket)
    keepPerPanel.set(row.panelId, days)
  }
  for (const [panelId, days] of keepPerPanel) {
    const keep = [...days.values()]
    const result = await db.delete(schema.dashboardMeasureSamples).where(
      and(
        eq(schema.dashboardMeasureSamples.panelId, panelId),
        lt(schema.dashboardMeasureSamples.bucket, hourlyFloor),
        notInArray(schema.dashboardMeasureSamples.bucket, keep),
      ),
    )
    collapsed += Number(result.changes ?? 0)
  }

  const dailyFloor = dayBucket(now) - DAILY_RETENTION_MS
  const expired = await db
    .delete(schema.dashboardMeasureSamples)
    .where(lt(schema.dashboardMeasureSamples.bucket, dailyFloor))
  dropped += Number(expired.changes ?? 0)

  // The cap, last, so it measures what compaction actually left behind.
  for (const panelId of await sampledPanelIds(db)) {
    const rows = await db
      .select({ bucket: schema.dashboardMeasureSamples.bucket })
      .from(schema.dashboardMeasureSamples)
      .where(eq(schema.dashboardMeasureSamples.panelId, panelId))
      .orderBy(desc(schema.dashboardMeasureSamples.bucket))
      .limit(MAX_SAMPLES_PER_PANEL)
    if (rows.length < MAX_SAMPLES_PER_PANEL) continue
    const over = await db.delete(schema.dashboardMeasureSamples).where(
      and(
        eq(schema.dashboardMeasureSamples.panelId, panelId),
        notInArray(schema.dashboardMeasureSamples.bucket, rows.map((row) => row.bucket)),
      ),
    )
    dropped += Number(over.changes ?? 0)
  }

  return { collapsed, dropped, orphaned }
}
