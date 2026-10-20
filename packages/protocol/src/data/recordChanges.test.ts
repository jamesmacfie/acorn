import { describe, expect, it } from 'vitest'
import { recordChangeDecision, recordProjection, recordIdentity } from './recordChanges'

const policy = { mode: 'changed' as const, fields: ['/state'] }
const previous = (state: string) => ({
  snapshot: { state },
  fields: ['/state'],
  projection: recordProjection({ state }, ['/state']),
})
describe('record processing decisions', () => {
  it('compares the latest projection for A to B to A, including failed unchanged work', () => {
    expect(recordChangeDecision({ policy, snapshot: { state: 'B' }, previous: previous('A'), active: false })).toBe(
      'admitted',
    )
    expect(recordChangeDecision({ policy, snapshot: { state: 'A' }, previous: previous('B'), active: false })).toBe(
      'admitted',
    )
    expect(recordChangeDecision({ policy, snapshot: { state: 'A' }, previous: previous('A'), active: false })).toBe(
      'unchanged',
    )
    expect(recordChangeDecision({ policy, snapshot: { state: 'B' }, previous: previous('A'), active: true })).toBe(
      'active',
    )
  })
  it('distinguishes absent from null, canonicalizes object order, and preserves array order', () => {
    expect(recordProjection({}, ['/x'])).not.toBe(recordProjection({ x: null }, ['/x']))
    expect(recordProjection({ a: 1, b: 2 }, [''])).toBe(recordProjection({ b: 2, a: 1 }, ['']))
    expect(recordProjection([1, 2], [''])).not.toBe(recordProjection([2, 1], ['']))
  })
  it('reprojects retained fields and requires a decision for unavailable new fields', () => {
    const prior = { snapshot: { state: 'A', name: 'N' }, fields: ['/state'], projection: 'unused' }
    expect(
      recordChangeDecision({
        policy: { mode: 'changed', fields: ['/name'] },
        snapshot: { name: 'N' },
        previous: prior,
        active: false,
      }),
    ).toBe('unchanged')
    expect(() =>
      recordChangeDecision({
        policy: { mode: 'changed', fields: ['/missing'] },
        snapshot: {},
        previous: prior,
        active: false,
      }),
    ).toThrow('fresh baseline')
    expect(
      recordChangeDecision({
        policy: { mode: 'changed', fields: ['/missing'] },
        snapshot: {},
        previous: prior,
        active: false,
        baseline: true,
      }),
    ).toBe('baseline')
  })
  it('uses source, connection, and record ID but never retrieval parameters or titles', () => {
    const record = { ref: { pluginId: 'p', sourceId: 's', connectionId: 'a', recordId: '1' }, data: {} }
    const key = recordIdentity(record)
    expect(
      recordIdentity({
        ...record,
        ref: { ...record.ref, scope: { parameters: { search: 'changed' } } },
        display: { title: 'renamed' },
      }),
    ).toBe(key)
    expect(recordIdentity({ ...record, ref: { ...record.ref, sourceId: 'other' } })).not.toBe(key)
    expect(recordIdentity({ ...record, ref: { ...record.ref, connectionId: 'b' } })).not.toBe(key)
  })
  it('admits a record that starts matching, and again after it stops and starts', () => {
    const enters = { mode: 'enters' as const }
    const kept = (matching: boolean) => ({ fields: [], projection: recordProjection({}, []), matching })
    expect(recordChangeDecision({ policy: enters, snapshot: {}, active: false })).toBe('admitted')
    expect(recordChangeDecision({ policy: enters, snapshot: {}, previous: kept(true), active: false })).toBe('seen')
    expect(recordChangeDecision({ policy: enters, snapshot: {}, previous: kept(false), active: false })).toBe(
      'admitted',
    )
    expect(recordChangeDecision({ policy: enters, snapshot: {}, previous: kept(false), active: true })).toBe('active')
  })
  it('refuses a new tracked field when only the projection was kept', () => {
    expect(() =>
      recordChangeDecision({
        policy: { mode: 'changed', fields: ['/name'] },
        snapshot: { name: 'N' },
        previous: { fields: ['/state'], projection: recordProjection({ state: 'A' }, ['/state']) },
        active: false,
      }),
    ).toThrow('fresh baseline')
  })
})
