import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { TelemetryMetric, TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import type { Env } from '../bindings'
import { registerRoute, removePluginRoutes } from '../routeRegistry'
import { openSqlite } from '../storage/sqlite'
import { flushTelemetry, onTelemetryBatch, resetTelemetryForTest, startTelemetry } from '../telemetry/collector'
import { dispatchPluginRoute } from './dispatch'

// The in-process dispatch is the second door a plugin's node code runs behind, and the one with no
// HTTP request in front of it: a manifest-declared schedule firing, or the dashboard sampler
// reading a collection. What matters here is that it enters the same ambient context the request
// middleware does, so the SQL a plugin runs on a schedule is that plugin's SQL
// (docs/telemetry.md § Ambient attribution).

const ENV = { ACTIVE_IDENTITY: { get: () => 'james' } } as unknown as Env

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('a dispatched plugin route', () => {
  let seen: TelemetryRecord[]

  beforeEach(async () => {
    resetTelemetryForTest()
    seen = []
    startTelemetry({ node: 'node-1', version: '9', readPref: async () => '1' })
    onTelemetryBatch((batch) => seen.push(...batch.records))
    await settle()
  })

  afterEach(() => {
    removePluginRoutes('rollbar')
    resetTelemetryForTest()
  })

  const dispatch = (run: () => void) => {
    registerRoute({
      plugin: 'rollbar',
      prefix: '',
      fetch: async () => {
        run()
        return Response.json({ ok: true })
      },
    })
    return dispatchPluginRoute(ENV, 'rollbar', '/v2/p/rollbar/refresh', { method: 'GET' }, AbortSignal.timeout(5_000))
  }

  it('names the plugin on the SQL its handler runs', async () => {
    const db = openSqlite(':memory:')
    try {
      db.exec('CREATE TABLE issues (id TEXT)')
      // The table is created outside the dispatch, so the only statement inside it is the select.
      await dispatch(() => void db.prepare('SELECT id FROM issues').all())
    } finally {
      db.close()
    }
    flushTelemetry()
    const histogram = seen.find((record): record is TelemetryMetric => record.kind === 'metric' && record.name === 'sql.select')!
    expect(histogram.attrs.owner).toBe('rollbar')
  })

  it('puts the dispatch span and what the handler raised in one trace', async () => {
    await dispatch(() => undefined)
    flushTelemetry()
    const span = seen.find((record): record is TelemetrySpan => record.kind === 'span' && record.name === 'plugin.dispatch')!
    expect(span.attrs).toMatchObject({ owner: 'rollbar', method: 'GET', path: '/v2/p/rollbar/refresh', status: 200 })
  })

  it('refuses a path outside the plugin namespace before it dispatches anything', async () => {
    registerRoute({ plugin: 'rollbar', prefix: '', fetch: async () => Response.json({}) })
    await expect(dispatchPluginRoute(ENV, 'rollbar', '/v2/core/tasks', { method: 'GET' }, AbortSignal.timeout(5_000)))
      .rejects.toThrow('route must be inside /v2/p/rollbar/')
  })
})
