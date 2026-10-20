import { afterEach, expect, it, vi } from 'vitest'
import { rollbarPlugin } from '@acorn/plugin-rollbar/node/index.ts'
import { occurrenceCountSourceDescription } from '@acorn/plugin-rollbar/testkit'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { clearRegistrations, initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import '@acorn/node-core/server/index.ts'
import { makeTestDb, testEnv, runDashboard, testCoreSeams } from '@acorn/node-core/testkit'

afterEach(() => {
  clearRegistrations('rollbar')
  vi.unstubAllGlobals()
})

it("draws each Rollbar occurrence count starter from one Metrics API query of the starter's window", async () => {
  const world = makeTestDb()
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: identity, SECRETS: world.secrets })
  const now = Date.parse('2026-10-20T12:00:00Z')
  const day = 86_400_000
  try {
    await world.db
      .insert(schema.workspaces)
      .values({ id: 'rollbar-ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await initPlugins([rollbarPlugin()], {
      env,
      dataDir: '',
      capabilities: new CapabilityRegistry(),
      core: createCoreServices({ db: world.db, secrets: world.secrets, activeIdentity: identity, ...testCoreSeams() }),
    })
    await world.db.insert(schema.integrations).values({
      id: 'selected',
      userId: 'owner',
      provider: 'rollbar',
      label: 'Rollbar',
      encryptedCredentials: await world.secrets.seal('selected-token'),
      authKind: 'api-key',
      status: 'connected',
      createdAt: now,
      updatedAt: now,
    })
    const queries: { start_time: number }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        expect(url).toBe('https://api.rollbar.com/api/1/metrics/occurrences')
        expect(init.headers).toMatchObject({ 'X-Rollbar-Access-Token': 'selected-token' })
        const body = JSON.parse(String(init.body)) as { start_time: number }
        queries.push(body)
        // Two groups on each of the last three UTC days, newest first.
        const timepoints = [0, 1, 2].map((ago) => ({
          timestamp: (Date.UTC(2026, 9, 20) - ago * day) / 1000,
          metrics_rows: [
            [
              { field: 'item_id', value: 11 },
              { field: 'item_counter', value: 1 },
              { field: 'item_title', value: 'TypeError: token is null' },
              { field: 'item_level', value: 'error' },
              { field: 'environment', value: 'production' },
              { field: 'occurrence_count', value: 5 + ago },
            ],
            [
              { field: 'item_id', value: 12 },
              { field: 'item_counter', value: 2 },
              { field: 'item_title', value: 'Slow checkout' },
              { field: 'item_level', value: 'warning' },
              { field: 'environment', value: 'staging' },
              { field: 'occurrence_count', value: 1 },
            ],
          ],
        }))
        return Response.json({ err: 0, result: { timepoints } })
      }),
    )
    const results: Record<string, { rows: number; since: string }> = {}
    for (const starter of occurrenceCountSourceDescription.starterPlans ?? []) {
      // The launcher's move: onto the workspace and account the person picked.
      const plan = panelPlanSchema.parse(starter)
      for (const source of plan.sources)
        if (source.reference.kind === 'inline')
          source.reference.content.query.scope = { workspaceId: 'rollbar-ws', connectionId: 'selected', parameters: {} }
      const run = await runDashboard(
        env,
        {
          scope: { workspaceId: 'rollbar-ws' },
          target: { kind: 'draft', content: plan },
          mode: 'execution',
          evaluationTime: now,
        },
        { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, signal: new AbortController().signal },
      )
      expect(
        run.diagnostics.problems.filter((problem) => problem.severity === 'error'),
        plan.title,
      ).toEqual([])
      results[plan.title] = {
        rows: run.rows.length,
        since: new Date(queries.at(-1)!.start_time * 1000).toISOString().slice(0, 10),
      }
    }
    expect(results).toEqual({
      'Errors per day by level, last 30 days': { rows: 6, since: '2026-09-20' },
      'Errors per day by environment, last 30 days': { rows: 6, since: '2026-09-20' },
      'Error spikes, last 14 days': { rows: 6, since: '2026-10-06' },
      'Noisiest errors, last 7 days': { rows: 2, since: '2026-10-13' },
    })
  } finally {
    world.cleanup()
  }
})
