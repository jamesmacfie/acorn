import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DataFeedRegistration } from '@acorn/protocol/dataSources.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { registerDataFeed } from './feeds'
import { appendToFeed, pruneFeedEvents } from './feedStore'
import { clearDataSources } from './registry'
import { invokeDataSource } from './runtime'

const worlds: TestDb[] = []
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup()
  clearDataSources('acme-alerts')
  clearDataSources('other')
})

const alerts = (feed: Partial<DataFeedRegistration['feed']> = {}): DataFeedRegistration => ({
  sourceId: 'alerts',
  name: 'Load alerts',
  singular: 'Alert',
  plural: 'Alerts',
  identityScope: 'An alert ID is unique for this plugin.',
  feed: {
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: { host: { type: 'string' }, load: { type: 'number' } },
      required: ['host', 'load'],
    },
    fields: [
      { pointer: '/host', label: 'Host', origin: 'declared', display: { kind: 'text', role: 'title' } },
      { pointer: '/load', label: 'Load', origin: 'declared', display: { kind: 'number' } },
    ],
    ...feed,
  },
})
const alert = (host: string, load: number, time: number) => ({ id: `${host}:${time}`, time, data: { host, load } })

function world() {
  const db = makeTestDb()
  worlds.push(db)
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
  const invocation = {
    principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
    signal: new AbortController().signal,
  }
  const query = (extra: object = {}, mode: 'execution' | 'preview' = 'execution') =>
    invokeDataSource(
      env,
      {
        operation: 'query',
        query: {
          source: { pluginId: 'acme-alerts', sourceId: 'alerts' },
          scope: { parameters: {} },
          sort: [],
          ...extra,
        },
        mode,
        evaluationTime: 1_000,
        pageSize: 100,
      },
      invocation,
    )
  return { db, env, invocation, query }
}

describe('event feeds', () => {
  it('describes the declared fields, the time acorn adds, and the operators the host can run', async () => {
    registerDataFeed('acme-alerts', alerts())
    const { env, invocation } = world()
    const description = await invokeDataSource(
      env,
      { operation: 'describe', source: { pluginId: 'acme-alerts', sourceId: 'alerts' }, scope: { parameters: {} } },
      invocation,
    )
    expect(description.fields.map((field) => [field.pointer, field.query?.operators])).toEqual([
      ['/host', ['eq', 'ne', 'in', 'contains']],
      ['/load', ['eq', 'ne', 'in', 'lt', 'lte', 'gt', 'gte']],
      ['/time', ['gt', 'gte', 'lt', 'lte']],
    ])
    expect(description.operations.incremental).toBe(true)
    expect(description.coverage).toEqual({
      kind: 'events',
      retention: 'The last 14 days, up to 10,000 events',
      complete: true,
    })
  })

  it('refuses a schema that declares time, which acorn adds', () => {
    const feed = alerts()
    expect(() =>
      registerDataFeed('acme-alerts', {
        ...feed,
        feed: { ...feed.feed, schema: { type: 'object', properties: { time: { type: 'number' } } } },
      }),
    ).toThrow(/can't declare time/)
  })

  it('stores each event once, checks it against the schema, and serves newest first', async () => {
    registerDataFeed('acme-alerts', alerts())
    const { env, query } = world()
    expect(appendToFeed(env, 'acme-alerts', 'alerts', [alert('web-1', 6.2, 100), alert('web-2', 3, 200)])).toBe(2)
    // The same event raised twice is stored once.
    expect(appendToFeed(env, 'acme-alerts', 'alerts', [alert('web-1', 6.2, 100)])).toBe(0)
    expect(() => appendToFeed(env, 'acme-alerts', 'alerts', [{ id: 'bad', time: 1, data: { host: 'web-3' } }])).toThrow(
      /doesn't fit the alerts feed/,
    )

    const all = await query()
    expect(all.records.map((record) => [record.ref.recordId, record.data])).toEqual([
      ['web-2:200', { host: 'web-2', load: 3, time: 200 }],
      ['web-1:100', { host: 'web-1', load: 6.2, time: 100 }],
    ])
    const high = await query({
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/load' } },
        operator: 'gt',
        right: { address: { from: 'literal', value: 4 } },
      },
    })
    expect(high.records.map((record) => record.ref.recordId)).toEqual(['web-1:100'])
  })

  it("won't let a plugin append to a feed that isn't its own, or past the per-call cap", () => {
    registerDataFeed('acme-alerts', alerts())
    const { env } = world()
    expect(() => appendToFeed(env, 'other', 'alerts', [alert('web-1', 1, 1)])).toThrow(/no event feed/)
    const many = Array.from({ length: 101 }, (_, index) => alert('web', 1, index))
    expect(() => appendToFeed(env, 'acme-alerts', 'alerts', many)).toThrow(/at most 100/)
  })

  it('keeps at most maxEvents, dropping the oldest', async () => {
    registerDataFeed('acme-alerts', alerts({ maxEvents: 2 }))
    const { env, query } = world()
    appendToFeed(env, 'acme-alerts', 'alerts', [alert('a', 1, 1), alert('b', 1, 2), alert('c', 1, 3)])
    expect((await query()).records.map((record) => record.ref.recordId)).toEqual(['c:3', 'b:2'])
  })

  it('continues an incremental read from the newest sequence number it saw', async () => {
    registerDataFeed('acme-alerts', alerts())
    const { env, query } = world()
    appendToFeed(env, 'acme-alerts', 'alerts', [alert('a', 1, 1)])
    const baseline = await query({ incremental: { kind: 'baseline' } })
    expect(baseline.records).toHaveLength(1)
    appendToFeed(env, 'acme-alerts', 'alerts', [alert('b', 1, 2)])
    const next = await query({ incremental: { kind: 'continue', boundary: baseline.incrementalBoundary } })
    expect(next.records.map((record) => record.ref.recordId)).toEqual(['b:2'])
    // A preview never carries a boundary.
    expect((await query({ incremental: { kind: 'baseline' } }, 'preview')).incrementalBoundary).toBeUndefined()
  })

  it('drops events past their retention on the daily pass', async () => {
    registerDataFeed('acme-alerts', alerts({ retentionDays: 1 }))
    const { db, env, query } = world()
    const now = 10 * 86_400_000
    appendToFeed(env, 'acme-alerts', 'alerts', [alert('old', 1, now - 2 * 86_400_000), alert('new', 1, now)])
    expect(pruneFeedEvents(db.db, now)).toBe(1)
    expect((await query()).records.map((record) => record.ref.recordId)).toEqual([`new:${now}`])
  })

  it('drops a suggested trigger that names a field the source does not describe, once, with a log line', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    registerDataFeed(
      'acme-alerts',
      alerts({
        starterTriggers: [
          { id: 'high', label: 'Load runs high', description: 'Load above 4', change: { on: 'enters' } },
          { id: 'cpu', label: 'CPU', description: 'Watches cpu', change: { on: 'changes', fields: ['/cpu'] } },
        ],
      }),
    )
    const { env, invocation } = world()
    const describe = () =>
      invokeDataSource(
        env,
        { operation: 'describe', source: { pluginId: 'acme-alerts', sourceId: 'alerts' }, scope: { parameters: {} } },
        invocation,
      )
    expect((await describe()).starterTriggers?.map((starter) => starter.id)).toEqual(['high'])
    await describe()
    const lines = warn.mock.calls.map((call) => call.join(' ')).filter((line) => line.includes("trigger 'cpu'"))
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('acme-alerts:alerts')
    warn.mockRestore()
  })
})
