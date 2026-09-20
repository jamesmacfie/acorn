import { describe, expect, it } from 'vitest'
import { processingDecision, processingProjection, workflowRecordIdentity } from './workflowProcessingRules'

const policy = { mode: 'changed' as const, fields: ['/state'] }
const previous = (state: string) => ({ snapshot: { state }, fields: ['/state'], projection: processingProjection({ state }, ['/state']) })
describe('record processing decisions', () => {
  it('compares the latest projection for A to B to A, including failed unchanged work', () => {
    expect(processingDecision({ policy, snapshot: { state: 'B' }, previous: previous('A'), active: false })).toBe('admitted')
    expect(processingDecision({ policy, snapshot: { state: 'A' }, previous: previous('B'), active: false })).toBe('admitted')
    expect(processingDecision({ policy, snapshot: { state: 'A' }, previous: previous('A'), active: false })).toBe('unchanged')
    expect(processingDecision({ policy, snapshot: { state: 'B' }, previous: previous('A'), active: true })).toBe('active')
  })
  it('distinguishes absent from null, canonicalizes object order, and preserves array order', () => {
    expect(processingProjection({}, ['/x'])).not.toBe(processingProjection({ x: null }, ['/x']))
    expect(processingProjection({ a: 1, b: 2 }, [''])).toBe(processingProjection({ b: 2, a: 1 }, ['']))
    expect(processingProjection([1, 2], [''])).not.toBe(processingProjection([2, 1], ['']))
  })
  it('reprojects retained fields and requires a decision for unavailable new fields', () => {
    const prior = { snapshot: { state: 'A', name: 'N' }, fields: ['/state'], projection: 'unused' }
    expect(processingDecision({ policy: { mode: 'changed', fields: ['/name'] }, snapshot: { name: 'N' }, previous: prior, active: false })).toBe('unchanged')
    expect(() => processingDecision({ policy: { mode: 'changed', fields: ['/missing'] }, snapshot: {}, previous: prior, active: false })).toThrow('fresh baseline')
    expect(processingDecision({ policy: { mode: 'changed', fields: ['/missing'] }, snapshot: {}, previous: prior, active: false, baseline: true })).toBe('baseline')
  })
  it('uses source, connection, and record ID but never retrieval parameters or titles', () => {
    const record = { ref: { pluginId: 'p', sourceId: 's', connectionId: 'a', recordId: '1' }, data: {} }
    const key = workflowRecordIdentity(record)
    expect(workflowRecordIdentity({ ...record, ref: { ...record.ref, scope: { parameters: { search: 'changed' } } }, display: { title: 'renamed' } })).toBe(key)
    expect(workflowRecordIdentity({ ...record, ref: { ...record.ref, sourceId: 'other' } })).not.toBe(key)
    expect(workflowRecordIdentity({ ...record, ref: { ...record.ref, connectionId: 'b' } })).not.toBe(key)
  })
})
