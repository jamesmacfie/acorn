import { afterEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { PanelDefinition } from '@acorn/dashboards-core/model.ts'
import { memoryIdentityStore } from '../../main/activeIdentity'
import { createCoreServices, SecretService } from '../../main/core'
import { makeTestDb, testEnv } from '../../testkit/db'
import { schema } from '../db'
import { CapabilityRegistry } from '../plugin/capabilities'
import { clearRegistrations, initPlugins } from '../plugin/host'
import type { NodePlugin } from '../plugin/types'
import { readSeries } from './history'
import { definedPanelIds, panelsToSample, runSamplePass } from './sampler'

// `core:sample-measures`, end to end and with no client anywhere: prefs blob in, samples out.
//
// The point of doing it this way rather than against a stubbed reader is that the two seams are the
// risky part. The pass reads through the real node-side collection registry, over a real in-process
// plugin route, and computes the measure with the same shared pipeline the stat renders with.

const PLUGIN = 'acme'
const OWNER = 'owner-1'

const panel = (overrides: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id: 'p1',
  title: 'Open issues',
  queries: [{ pluginId: PLUGIN, collectionId: 'issues' }],
  shaping: {},
  view: { kind: 'stat', trend: 'history' },
  ...overrides,
})

const blob = (panels: PanelDefinition[], placed = panels.map((p) => p.id)) => ({
  panels: Object.fromEntries(panels.map((p) => [p.id, p])),
  placements: { home: placed },
  layouts: {},
})

const rows = (points: number[]) => ({
  schema: { fields: [{ id: 'points', name: 'Points', type: 'number' as const }, { id: 'state', name: 'State', type: 'enum' as const, values: [{ id: 'open', label: 'Open' }, { id: 'done', label: 'Done' }] }] },
  rows: points.map((value, index) => ({ id: `r${index}`, values: { points: value, state: index % 2 ? 'done' : 'open' } })),
})

afterEach(() => clearRegistrations(PLUGIN))

async function world(prefs: unknown, answer: () => Response) {
  const core = makeTestDb()
  const capabilities = new CapabilityRegistry()
  const env = testEnv({ DB: core.db, ACTIVE_IDENTITY: memoryIdentityStore(OWNER) })
  if (prefs !== undefined) {
    await core.db.insert(schema.prefs).values({ userId: OWNER, key: 'dashboards', value: JSON.stringify(prefs) })
  }
  const plugin: NodePlugin = {
    name: PLUGIN,
    init: (ctx) => {
      ctx.routes.fetch(() => answer(), { prefix: '/collections' })
      ctx.collections.register({ collectionId: 'issues', items: `/v2/p/${PLUGIN}/collections/issues` })
    },
  }
  await initPlugins([plugin], {
    capabilities,
    core: createCoreServices({ secrets: new SecretService('c'.repeat(64)), db: core.db, activeIdentity: memoryIdentityStore(OWNER) }),
    env,
    dataDir: '',
  })
  return { core, env }
}

describe('which panels a pass looks at', () => {
  it('takes history-trend panels that are placed, and nothing else', () => {
    const wanted = panel({ id: 'wanted' })
    const activity = panel({ id: 'activity', view: { kind: 'stat', trend: 'activity' } })
    const plain = panel({ id: 'plain', view: { kind: 'stat' } })
    const unplaced = panel({ id: 'unplaced' })
    const prefs = blob([wanted, activity, plain, unplaced], ['wanted', 'activity', 'plain'])
    // `activity` needs no store at all and `plain` asked for no trend. `unplaced` is defined but
    // nothing renders it, and a trend nobody can see is cost without a reader.
    expect(panelsToSample(prefs).map((p) => p.id)).toEqual(['wanted'])
    // Compaction's live set is different on purpose: UNPLACING must not delete history.
    expect([...definedPanelIds(prefs)].sort()).toEqual(['activity', 'plain', 'unplaced', 'wanted'])
  })

  it('finds nothing in a blob it could not read, rather than throwing', () => {
    expect(panelsToSample(null)).toEqual([])
    expect(panelsToSample('not a blob')).toEqual([])
  })
})

describe('a sampling pass', () => {
  it('records the panel’s measure with no client attached', async () => {
    const { core, env } = await world(blob([panel()]), () => Response.json(rows([3, 4, 5])))
    try {
      const result = await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)
      expect(result).toMatchObject({ sampled: 1, skipped: [] })
      // Default aggregate is `count`, which is why a stat over a collection with no number field
      // still draws — and still samples.
      expect((await readSeries(core.db, 'p1')).samples.map((s) => s.value)).toEqual([3])
    } finally {
      core.cleanup()
    }
  })

  it('computes the SAME number the panel renders — filters, then the aggregate', async () => {
    const definition = panel({
      shaping: { filters: [{ field: 'state', op: 'eq', value: 'open' }] },
      view: { kind: 'stat', trend: 'history', aggregate: 'sum', field: 'points' },
    })
    const { core, env } = await world(blob([definition]), () => Response.json(rows([10, 99, 5])))
    try {
      await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)
      // Rows 0 and 2 are `open`; row 1 is `done` and is filtered out before the sum.
      expect((await readSeries(core.db, 'p1')).samples.map((s) => s.value)).toEqual([15])
    } finally {
      core.cleanup()
    }
  })

  it('skips a panel whose source could not answer, and says which', async () => {
    const { core, env } = await world(blob([panel()]), () => new Response('rate limited', { status: 429 }))
    try {
      const result = await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)
      // A partial union measures availability, not data: a mixed board missing one provider would
      // record a dip that never happened.
      expect(result.sampled).toBe(0)
      expect(result.skipped).toEqual([{ panelId: 'p1', reason: 'acme unavailable' }])
      expect((await readSeries(core.db, 'p1')).samples).toEqual([])
    } finally {
      core.cleanup()
    }
  })

  it('records nothing rather than a zero when there is no measure', async () => {
    const definition = panel({ view: { kind: 'stat', trend: 'history', aggregate: 'avg', field: 'nonexistent' } })
    const { core, env } = await world(blob([definition]), () => Response.json(rows([1, 2])))
    try {
      const result = await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)
      expect(result.skipped).toEqual([{ panelId: 'p1', reason: 'no measure' }])
      expect((await readSeries(core.db, 'p1')).samples).toEqual([])
    } finally {
      core.cleanup()
    }
  })

  it('resets the series when the panel’s meaning changed between passes', async () => {
    const before = panel()
    const { core, env } = await world(blob([before]), () => Response.json(rows([1, 2, 3])))
    try {
      await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)

      // Same panel id, a filter added: last week's samples are now a lie.
      const after = panel({ shaping: { filters: [{ field: 'state', op: 'eq', value: 'open' }] } })
      await core.db
        .update(schema.prefs)
        .set({ value: JSON.stringify(blob([after])) })
        .where(and(eq(schema.prefs.userId, OWNER), eq(schema.prefs.key, 'dashboards')))

      const result = await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000 + 3_600_000)
      expect(result.reset).toBe(1)
      const series = await readSeries(core.db, 'p1')
      // Two rows of three are `open`, and the old bucket is gone rather than sitting beside the new one.
      expect(series.samples.map((s) => s.value)).toEqual([2])
    } finally {
      core.cleanup()
    }
  })

  it('does nothing at all when the node has no dashboards blob', async () => {
    const { core, env } = await world(undefined, () => Response.json(rows([1])))
    try {
      expect(await runSamplePass(core.db, env, AbortSignal.timeout(5_000), 1_800_000_000_000)).toMatchObject({ sampled: 0, skipped: [] })
    } finally {
      core.cleanup()
    }
  })
})
