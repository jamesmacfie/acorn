import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import { measureSignature, stableStringify } from './signature'

const panel = (overrides: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id: 'p1',
  title: 'Open pull requests',
  queries: [{ pluginId: 'github', collectionId: 'pulls-mine' }],
  shaping: {},
  view: { kind: 'stat', trend: 'history' },
  ...overrides,
})

describe('stableStringify', () => {
  it('is insensitive to key order', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }))
  })

  it('is sensitive to array order, which is meaning here', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
  })

  it('drops undefined members rather than emitting them', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }))
  })
})

describe('what resets a series and what does not', () => {
  it('survives a retitle, a resize and a view swap', () => {
    const base = measureSignature(panel())
    expect(measureSignature(panel({ title: 'Something else' }))).toBe(base)
    expect(measureSignature(panel({ view: { kind: 'list', trend: 'history' } }))).toBe(base)
    // The display keys are presentation: turning the delta window from a day to a week must not
    // throw away the fortnight of samples the delta is drawn from.
    expect(measureSignature(panel({ view: { kind: 'stat', trend: 'history', compare: 'week', good: 'down' } }))).toBe(base)
    expect(measureSignature(panel({ shaping: { sort: [{ field: 'updated', direction: 'desc' }], limit: 5 } }))).toBe(base)
  })

  it('resets on a filter, a query, a param, a mapping or the measure itself', () => {
    const base = measureSignature(panel())
    expect(measureSignature(panel({ shaping: { filters: [{ field: 'state', op: 'eq', value: 'open' }] } }))).not.toBe(base)
    expect(measureSignature(panel({ queries: [{ pluginId: 'linear', collectionId: 'pulls-mine' }] }))).not.toBe(base)
    expect(measureSignature(panel({ queries: [{ pluginId: 'github', collectionId: 'pulls-mine', params: { repo: 'acorn' } }] }))).not.toBe(base)
    expect(measureSignature(panel({ mapping: { unmapped: 'hidden' } }))).not.toBe(base)
    expect(measureSignature(panel({ view: { kind: 'stat', aggregate: 'sum', field: 'additions' } }))).not.toBe(base)
  })

  it('gives two panels with the same meaning the same signature', () => {
    // The series is keyed by panel id, so this is not a correctness requirement — it is the property
    // that says the hash is over MEANING and carries nothing incidental.
    expect(measureSignature(panel({ id: 'p1' }))).toBe(measureSignature(panel({ id: 'p2' })))
  })
})
