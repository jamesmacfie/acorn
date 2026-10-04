import { describe, expect, it } from 'vitest'
import type { PanelDefinition } from './model'
import { measureSignature, stableStringify } from './signature'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'

const panel = (overrides: Partial<PanelDefinition> = {}): PanelDefinition => ({
  id: 'p1',
  title: 'Open pull requests',
  sources: [{ pluginId: 'github', sourceId: 'pulls-mine' }],
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

  it('resets on a filter, a source projection, a mapping or the measure itself', () => {
    const base = measureSignature(panel())
    expect(measureSignature(panel({ shaping: { filters: [{ field: 'state', op: 'eq', value: 'open' }] } }))).not.toBe(base)
    expect(measureSignature(panel({ sources: [{ pluginId: 'linear', sourceId: 'pulls-mine' }] }))).not.toBe(base)
    expect(measureSignature(panel({ sources: [{ pluginId: 'github', sourceId: 'pulls-mine@second-query' }] }))).not.toBe(base)
    expect(measureSignature(panel({ mapping: { unmapped: 'hidden' } }))).not.toBe(base)
    expect(measureSignature(panel({ view: { kind: 'stat', aggregate: 'sum', field: 'additions' } }))).not.toBe(base)
  })

  it("resets when a query's content, parameters, or account changes", () => {
    const query = { id: 'q', digest: 'a', parameters: { repo: 'acorn' }, account: 'work' }
    const base = measureSignature(panel(), [query])
    expect(measureSignature(panel(), [{ ...query }])).toBe(base)
    expect(measureSignature(panel(), [{ ...query, digest: 'b' }])).not.toBe(base)
    expect(measureSignature(panel(), [{ ...query, parameters: { repo: 'other' } }])).not.toBe(base)
    expect(measureSignature(panel(), [{ ...query, account: 'personal' }])).not.toBe(base)
    expect(measureSignature(panel())).not.toBe(base)
  })

  it('resets when a version 2 summary changes without changing its source query', () => {
    const plan = panelPlanSchema.parse({ version: 2, title: 'Totals', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
      sources: [{ id: 'a', label: 'A', role: 'primary', reference: { kind: 'inline', content: { name: 'A', parameters: { type: 'object', additionalProperties: false }, sourceParameters: {}, query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { parameters: {} }, sort: [] } }, bindings: {} } }],
      columns: [{ id: 'status', label: 'Status', type: 'text', bind: { a: { field: '/status' } } }],
      stages: [{ op: 'summarize', by: [], measures: [{ id: 'total', label: 'Total', kind: 'count' }] }], view: { kind: 'stat', aggregate: 'sum', field: 'total' } })
    const query = [{ id: 'a', digest: 'same', parameters: {}, account: null }]
    const base = measureSignature(panel(), query, plan)
    expect(measureSignature(panel(), query, { ...plan, stages: [{ op: 'summarize', by: [], measures: [{ id: 'total', label: 'Total', kind: 'count-where', where: { kind: 'comparison', left: { address: { from: 'item', pointer: '/status' } }, operator: 'eq', right: { address: { from: 'literal', value: 'open' } } } }] }] })).not.toBe(base)
    expect(measureSignature(panel(), query, { ...plan, title: 'Renamed' })).toBe(base)
  })

  it('gives two panels with the same meaning the same signature', () => {
    // The series is keyed by panel id, so this is not a correctness requirement. It is the property
    // that says the hash is over meaning and carries nothing incidental.
    expect(measureSignature(panel({ id: 'p1' }))).toBe(measureSignature(panel({ id: 'p2' })))
  })
})
