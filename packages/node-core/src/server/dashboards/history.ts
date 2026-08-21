import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import type { DashboardHistoryResponse, DashboardMeasureSample } from '@acorn/protocol/api.ts'
import { type AppDatabase, schema } from '../db'

// The measure-history store, node-side with its own table and no write route; see docs/dashboards.md
// § Sampling and retention for why the sampler is the only writer.

/** UTC hour start for an instant. One sample per bucket per panel, so the primary key makes finer
 *  granularity unrepresentable. */
export const HOUR_MS = 60 * 60 * 1000
export const DAY_MS = 24 * HOUR_MS
export const hourBucket = (at: number): number => Math.floor(at / HOUR_MS) * HOUR_MS
export const dayBucket = (at: number): number => Math.floor(at / DAY_MS) * DAY_MS

/** Hourly retention window; see docs/dashboards.md § Sampling and retention for the full policy. */
export const HOURLY_RETENTION_MS = 14 * DAY_MS
/** Daily retention window; see docs/dashboards.md § Sampling and retention for the full policy. */
export const DAILY_RETENTION_MS = 400 * DAY_MS
/** Hard cap per panel after compaction; see docs/dashboards.md § Sampling and retention for why it
 *  exists and how far under it the retention windows land. */
export const MAX_SAMPLES_PER_PANEL = 1000

// Imported from the protocol rather than redeclared, so the client's sparkline and this store
// describe one row instead of two that could drift apart.
export type MeasureSample = DashboardMeasureSample
export type MeasureSeries = DashboardHistoryResponse

/** Record one sample, resetting the series first if the panel's meaning changed.
 *
 *  The signature check lives here rather than in the sampler because it is a property of the store's
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
    // A bucket already written is overwritten rather than kept: within one hour the later look is
    // the better answer, and "run now" from the settings page must not be a no-op for the rest of
    // the hour.
    .onConflictDoUpdate({
      target: [schema.dashboardMeasureSamples.panelId, schema.dashboardMeasureSamples.bucket],
      set: { value: input.value, signature: input.signature, recordedAt: input.recordedAt },
    })
  return { reset }
}

/** The series for one panel, ascending. An empty series is `{ signature: '', samples: [] }`; see
 *  docs/dashboards.md § Trends for why that renders as a cold state rather than an error. */
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

/** Every panel this store holds samples for; see docs/dashboards.md § Sampling and retention for the
 *  orphan sweep this feeds. */
export async function sampledPanelIds(db: AppDatabase): Promise<string[]> {
  const rows = await db
    .selectDistinct({ panelId: schema.dashboardMeasureSamples.panelId })
    .from(schema.dashboardMeasureSamples)
  return rows.map((row) => row.panelId)
}

export type CompactionResult = { collapsed: number; dropped: number; orphaned: number }

/** Retention, as one daily pass (`core:compact-history`); see docs/dashboards.md § Sampling and
 *  retention for the policy and the orphan sweep. */
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

  // Older than the hourly window: keep the last bucket of each UTC day, delete the rest. One read
  // and one delete per panel rather than a SQL window function, because a series is at most a few
  // hundred rows and this job runs once a day.
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
