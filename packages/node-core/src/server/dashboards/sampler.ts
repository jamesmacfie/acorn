import { and, eq } from 'drizzle-orm'
import { parsePanels } from '@acorn/dashboards-core/definition.ts'
import type { PanelDefinition } from '@acorn/dashboards-core/model.ts'
import type { PanelSourcePage } from '@acorn/dashboards-core/mapping.ts'
import { panelMeasure } from '@acorn/dashboards-core/measure.ts'
import { measureSignature } from '@acorn/dashboards-core/signature.ts'
import type { Env } from '../bindings'
import { readCollection } from '../collections/registry'
import { type AppDatabase, schema } from '../db'
import { appendSample, hourBucket } from './history'
import { createLogger, describeError } from '../telemetry/logger'

const log = createLogger('dashboards')

// One pass of `core:sample-measures`. See docs/schedules.md for why it is one core schedule rather
// than a row per panel, and docs/dashboards.md § Sampling and retention for what a pass does.

/** The prefs key the dashboards slice writes under (client-core/infra/persistence/prefKeys.ts § dashboards).
 *  An `app`-scoped slice is stored unqualified, so this is the whole key. It duplicates the client's
 *  own constant, because the client is downstream of the node and cannot be imported here. */
const DASHBOARDS_PREF_KEY = 'dashboards'

/** The per-panel timeout budget belongs to the schedule, not each read. This bounds how many
 *  collections one pass dispatches, so a board of hundreds of panels cannot turn an hourly job into a
 *  permanent one. Panels past the cap are reported in the run detail rather than dropped silently. */
const MAX_PANELS_PER_PASS = 200

export type SamplePassResult = {
  sampled: number
  /** Panels skipped this pass, with the reason. See docs/dashboards.md § Sampling and retention for
   *  why one unavailable source skips the whole panel. */
  skipped: { panelId: string; reason: string }[]
  reset: number
  overflow: number
}

/** The dashboards prefs blob as the node sees it. See docs/dashboards.md § Sampling and retention for
 *  why `null`, meaning no identity, no row yet, or an unparseable blob, must not read as "no panels
 *  exist". */
export async function readDashboardPrefs(db: AppDatabase, env: Env): Promise<unknown | null> {
  const userId = env.ACTIVE_IDENTITY.get()
  if (!userId) return null
  const rows = await db
    .select({ value: schema.prefs.value })
    .from(schema.prefs)
    .where(and(eq(schema.prefs.userId, userId), eq(schema.prefs.key, DASHBOARDS_PREF_KEY)))
    .limit(1)
  const raw = rows[0]?.value
  if (raw === undefined) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

/** Which panels a pass samples: every definition asking for a history trend that is placed in at
 *  least one scope. See docs/dashboards.md § Sampling and retention for why an unplaced panel is
 *  skipped and what happens when it is placed again. */
export function panelsToSample(prefs: unknown): PanelDefinition[] {
  const { panels, placements } = parsePanels(prefs)
  const placed = new Set(Object.values(placements).flat())
  return Object.values(panels).filter((panel) => panel.view.trend === 'history' && placed.has(panel.id))
}

/** Every panel id the blob defines, for compaction's orphan sweep. See docs/dashboards.md § Sampling
 *  and retention for why placement is irrelevant here. */
export function definedPanelIds(prefs: unknown): Set<string> {
  return new Set(Object.keys(parsePanels(prefs).panels))
}

export async function runSamplePass(
  db: AppDatabase,
  env: Env,
  signal: AbortSignal,
  now: number = Date.now(),
): Promise<SamplePassResult> {
  const prefs = await readDashboardPrefs(db, env)
  const all = panelsToSample(prefs)
  const panels = all.slice(0, MAX_PANELS_PER_PASS)
  const result: SamplePassResult = { sampled: 0, skipped: [], reset: 0, overflow: all.length - panels.length }
  const bucket = hourBucket(now)

  for (const panel of panels) {
    if (signal.aborted) break
    const pages: PanelSourcePage[] = []
    let unavailable: string | null = null
    for (const query of panel.queries) {
      try {
        const page = await readCollection(env, query.pluginId, query.collectionId, query.params ?? {}, signal)
        pages.push({ query, schema: page.schema, rows: page.rows })
      } catch (error) {
        unavailable = `${query.pluginId} unavailable`
        // One line for the author. The run row gets the short form, because it is a settings list,
        // not a log.
        log.warn(`${panel.id} skipped: ${query.pluginId}:${query.collectionId}: ${describeError(error).message}`)
        break
      }
    }
    if (unavailable) {
      result.skipped.push({ panelId: panel.id, reason: unavailable })
      continue
    }

    const value = panelMeasure(panel, pages)
    if (value === null || !Number.isFinite(value)) {
      // An aggregate over a field that is not there, or over rows with no numbers. The stat draws a
      // dash for this, so the series records nothing rather than a 0 that never happened.
      result.skipped.push({ panelId: panel.id, reason: 'no measure' })
      continue
    }

    const { reset } = await appendSample(db, {
      panelId: panel.id,
      signature: measureSignature(panel),
      bucket,
      value,
      recordedAt: now,
    })
    if (reset) result.reset += 1
    result.sampled += 1
  }
  return result
}

/** The one line a run row carries. Skips are named, for example "12 sampled, 2 skipped: github
 *  unavailable", because a pass that quietly recorded fewer panels than asked leaves a chart full of
 *  holes with no explanation. */
export function describeSamplePass(result: SamplePassResult): string {
  const parts = [`${result.sampled} sampled`]
  if (result.skipped.length) {
    const reasons = [...new Set(result.skipped.map((entry) => entry.reason))].slice(0, 3)
    parts.push(`${result.skipped.length} skipped: ${reasons.join(', ')}`)
  }
  if (result.reset) parts.push(`${result.reset} series reset (definition changed)`)
  if (result.overflow) parts.push(`${result.overflow} beyond this pass's panel cap`)
  return parts.join('; ')
}
