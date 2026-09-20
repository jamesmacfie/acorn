import { describe, expect, it } from 'vitest'
import { bindingCandidates, bindingForCandidate } from './fieldPickerModel'

describe('typed binding picker model', () => {
  const origins = [{
    kind: 'item' as const,
    label: 'Current issue',
    schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' as const },
        count: { type: 'number' as const },
        owner: { type: 'object' as const, properties: { name: { type: 'string' as const } }, required: [] },
      },
      required: ['id', 'count'],
    },
    example: { id: 'ISS-1', count: 3, owner: {} },
    fields: [{ pointer: '/owner/name', label: 'Owner name', origin: 'observed' as const }],
  }]

  it('ranks compatible fields, retains nested optionality, and never invents an example', () => {
    const candidates = bindingCandidates(origins, { type: 'string' })
    expect(candidates[0]).toMatchObject({ pointer: '/id', compatibility: { kind: 'exact' }, optional: false, example: 'ISS-1' })
    const missing = candidates.find(candidate => candidate.pointer === '/owner/name')
    expect(missing).toMatchObject({ optional: true, observed: true })
    expect(missing?.example).toBeUndefined()
    expect(candidates.find(candidate => candidate.pointer === '/count')?.compatibility).toEqual({ kind: 'conversion', conversion: 'scalar-to-text', label: 'Convert value to text' })
  })

  it('explains and disables incompatible fields but creates only explicit conversions', () => {
    const objectDestination = bindingCandidates(origins, { type: 'object' })
    expect(objectDestination.find(candidate => candidate.pointer === '/id')?.compatibility).toMatchObject({ kind: 'incompatible' })
    const number = bindingCandidates(origins, { type: 'string' }).find(candidate => candidate.pointer === '/count')!
    expect(bindingForCandidate(number)).toEqual({ address: { from: 'item', pointer: '/count' }, conversion: 'scalar-to-text' })
  })
})
