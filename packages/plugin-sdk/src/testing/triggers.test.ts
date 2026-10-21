import { describe, expect, it, vi } from 'vitest'
import { defineEventFeed, field } from '../data/index.ts'
import type * as PublishedData from '../data/public.ts'
import * as data from '../data/index.ts'
import * as testing from './index.ts'
import type * as Published from './public.ts'
import { checkStarterTriggers, testTrigger } from './index.ts'

// The drift lock for the hand-written declarations, as ./testing.test.ts holds the others.
type Mutual<A, B> = [A extends B ? true : never, B extends A ? true : never]
const _check: Mutual<typeof testing.checkStarterTriggers, typeof Published.checkStarterTriggers> = [true, true]
const _test: Mutual<typeof testing.testTrigger, typeof Published.testTrigger> = [true, true]
const _feed: Mutual<typeof data.defineEventFeed, typeof PublishedData.defineEventFeed> = [true, true]
void [_check, _test, _feed]

const alerts = defineEventFeed({
  id: 'alerts',
  name: 'Load alerts',
  singular: 'Alert',
  plural: 'Alerts',
  fields: {
    host: field.text({ label: 'Host', role: 'title' }),
    load: field.number({ label: 'Load' }),
  },
  starterTriggers: [
    {
      id: 'high-load',
      label: 'A host runs hot',
      description: 'Starts when a host’s load goes above 4.',
      predicate: {
        kind: 'comparison',
        left: { address: { from: 'item', pointer: '/load' } },
        operator: 'gt',
        right: { address: { from: 'literal', value: 4 } },
      },
      change: { on: 'enters' },
    },
  ],
})
const alert = (host: string, load: number) => ({ id: host, data: { host, load, time: 1 } })
const starts = (result: ReturnType<typeof testTrigger>) => result.map((read) => read.starts.length)

describe('defineEventFeed', () => {
  it('builds the manifest entry and the description acorn serves, time included', () => {
    expect(alerts.manifest).toMatchObject({
      sourceId: 'alerts',
      titlePointer: '/host',
      feed: { fields: expect.any(Array) },
    })
    expect(alerts.description.fields.map((item) => item.pointer)).toEqual(['/host', '/load', '/time'])
    expect(alerts.description.fields[1]!.query?.operators).toContain('gt')
  })

  it('appends through the context it is given', async () => {
    const append = vi.fn(async () => 1)
    const event = { id: 'web-1:1', time: 1, data: { host: 'web-1', load: 6.2 } }
    expect(await alerts.append({ dataSources: { append } }, [event])).toBe(1)
    expect(append).toHaveBeenCalledWith('alerts', [event])
  })
})

describe('testTrigger', () => {
  it('starts a record again after it stopped matching, with starts matching', () => {
    const result = testTrigger(alerts.description, { on: 'enters' }, [
      [alert('web-1', 6.2)],
      [alert('web-1', 6.4)],
      [],
      [alert('web-1', 5.1)],
    ])
    expect(starts(result)).toEqual([1, 0, 0, 1])
    expect(result[0]!.starts).toEqual([{ id: 'web-1', reason: 'enters' }])
  })

  it('starts a record once ever with new, and on each change of a watched field with changes', () => {
    const reads = [[alert('web-1', 6.2)], [alert('web-1', 6.4)], [], [alert('web-1', 5.1)]]
    expect(starts(testTrigger(alerts.description, { on: 'new' }, reads))).toEqual([1, 0, 0, 0])
    expect(starts(testTrigger(alerts.description, { on: 'changes', fields: ['/load'] }, reads))).toEqual([1, 1, 0, 1])
  })

  it("doesn't count a record as stopped on an incomplete read", () => {
    const result = testTrigger(alerts.description, { on: 'enters' }, [
      [alert('web-1', 6.2)],
      { records: [], completeness: { kind: 'incomplete', cause: 'provider-failure' } },
      [alert('web-1', 6.2)],
    ])
    expect(starts(result)).toEqual([1, 0, 0])
  })

  it("filters each read with a starter's predicate", () => {
    const [starter] = alerts.description.starterTriggers!
    const result = testTrigger(alerts.description, starter!.change, [[alert('web-1', 3)], [alert('web-1', 6)]], {
      predicate: starter!.predicate!,
    })
    expect(starts(result)).toEqual([0, 1])
  })

  it('refuses a record that does not fit the source, and a field the source does not describe', () => {
    expect(() => testTrigger(alerts.description, { on: 'new' }, [[{ id: 'x', data: { host: 'x' } }]])).toThrow(
      /Read 1, record x/,
    )
    expect(() => testTrigger(alerts.description, { on: 'changes', fields: ['/cpu'] }, [])).toThrow(/\/cpu/)
  })
})

describe('checkStarterTriggers', () => {
  it('passes the starters the Node keeps and names the problem with one it drops', () => {
    expect(() => checkStarterTriggers(alerts.description)).not.toThrow()
    const broken = {
      ...alerts.description,
      starterTriggers: [
        { id: 'cpu', label: 'CPU', description: 'CPU', change: { on: 'changes' as const, fields: ['/cpu'] } },
      ],
    }
    expect(() => checkStarterTriggers(broken)).toThrow(
      "Suggested trigger cpu: The watched field /cpu isn't one the source describes.",
    )
  })
})
