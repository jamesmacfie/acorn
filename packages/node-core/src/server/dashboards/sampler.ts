import { and, eq } from 'drizzle-orm'
import { parsePanels } from '@acorn/dashboards-core/definition.ts'
import type { PanelDefinition } from '@acorn/dashboards-core/model.ts'
import type { PanelSourcePage } from '@acorn/dashboards-core/mapping.ts'
import { panelMeasure } from '@acorn/dashboards-core/measure.ts'
import { measureSignature } from '@acorn/dashboards-core/signature.ts'
import type { Env } from '../../main/bindings'
import { readCollection } from '../collections/registry'
import { type AppDatabase, schema } from '../db'
import { appendSample, hourBucket } from './history'

// One pass of `core:sample-measures`; see docs/schedules.md for why it is one core schedule rather
// than a row per panel, and docs/dashboards.md § Sampling and retention for what a pass does and the
// prefs blob it shares with the client.

/** The prefs key the dashboards slice writes under (client-core/persistence/prefKeys.ts § dashboards).
 *  An `app`-scoped slice is stored unqualified, so this is the whole key. It is one edit apart from
 *  the client's own constant: the client is downstream of the node and cannot be imported here. */
const DASHBOARDS_PREF_KEY = 'dashboards'

/** Per-panel timeout budget belongs to the schedule, not each read; this only bounds how many
 *  collections one pass will dispatch, so a board that has grown to hundreds of panels cannot turn
 *  an hourly job into a permanent one. Panels past the cap are reported in the run detail rather
 *  than dropped silently. */
const MAX_PANELS_PER_PASS = 200

export type SamplePassResult = {
  sampled: number
  /** Panels skipped this pass, with the reason; see docs/dashboards.md § Sampling and retention for
   *  why one unavailable source skips the whole panel. */
  skipped: { panelId: string; reason: string }[]
  reset: number
  overflow: number
}

/** The dashboards prefs blob as the node sees it; see docs/dashboards.md § Sampling and retention for
 *  why `null` (no identity, no row yet, or an unparseable blob) must not be read as "no panels
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
 *  least one scope; see docs/dashboards.md § Sampling and retention for why an unplaced panel is
 *  skipped and what happens when it is placed again. */
export function panelsToSample(prefs: unknown): PanelDefinition[] {
  const { panels, placements } = parsePanels(prefs)
  const placed = new Set(Object.values(placements).flat())
  return Object.values(panels).filter((panel) => panel.view.trend === 'history' && placed.has(panel.id))
}

/** Every panel id the blob defines, for compaction's orphan sweep; see docs/dashboards.md § Sampling
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
        // The reason is worth one line for the author; the run row gets the short form, because it
        // is a settings list, not a log.
        console.warn(`[dashboards] ${panel.id} skipped: ${query.pluginId}:${query.collectionId}:`, error)
        break
      }
    }
    if (unavailable) {
      result.skipped.push({ panelId: panel.id, reason: unavailable })
      continue
    }

    const value = panelMeasure(panel, pages)
    if (value === null || !Number.isFinite(value)) {
      // An aggregate over a field that is not there, or over rows with no numbers. The stat draws an
      // em dash for this, so the series records nothing rather than a 0 that never happened.
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
 *  unavailable", because a pass that quietly recorded fewer panels than asked is how a chart full of
 *  holes gets explained away. */
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
