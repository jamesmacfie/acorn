import { expect, it } from 'vitest'
import { resolveQueryTimeWindow } from './dataQueryTime'

it('resolves half-open absolute and rolling windows at a frozen instant', () => {
  expect(resolveQueryTimeWindow({ pointer: '/updated', window: { kind: 'last-duration', durationMs: 100 } }, 500)).toMatchObject({ predicates: [{ operator: 'gte', right: { address: { value: 400 } } }, { operator: 'lt', right: { address: { value: 500 } } }] })
  expect(() => resolveQueryTimeWindow({ pointer: '/updated', window: { kind: 'absolute', start: 10, end: 5 } }, 500)).toThrow('start')
})
it('uses local midnight across a daylight-saving transition and rejects unknown zones', () => {
  const result = resolveQueryTimeWindow({ pointer: '/firstSeen', window: { kind: 'since-local-midnight', timezone: 'America/New_York' } }, Date.parse('2026-03-08T16:00:00Z'))
  expect(result).toMatchObject({ predicates: [{ right: { address: { value: Date.parse('2026-03-08T05:00:00Z') } } }, {}] })
  expect(() => resolveQueryTimeWindow({ pointer: '/firstSeen', window: { kind: 'since-local-midnight', timezone: 'invalid' } }, 100)).toThrow()
})
