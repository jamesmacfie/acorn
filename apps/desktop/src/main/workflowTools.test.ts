import { describe, expect, it } from 'vitest'
import { decodeToolCeiling, encodeToolCeiling, intersectToolCeilings, isToolWithinCeiling, narrowsToolCeiling } from './workflowTools'

describe('workflow tool ceilings', () => {
  it('intersects allowlists and risk tiers without permitting a child to widen its parent', () => {
    expect(intersectToolCeilings({ allow: ['read', 'write'], maxRisk: 'write' }, { allow: ['write', 'exec'], maxRisk: 'read' })).toEqual({
      allow: ['write'],
      maxRisk: 'read',
    })
    expect(narrowsToolCeiling({ allow: ['read'], maxRisk: 'read' }, { allow: ['read'], maxRisk: 'read' })).toBe(true)
    expect(narrowsToolCeiling({ allow: ['read'], maxRisk: 'read' }, { allow: ['write'], maxRisk: 'write' })).toBe(false)
  })

  it('filters by both dimensions and round-trips the transport encoding', () => {
    const ceiling = { allow: ['notes_list'], maxRisk: 'read' as const }
    expect(decodeToolCeiling(encodeToolCeiling(ceiling))).toEqual(ceiling)
    expect(isToolWithinCeiling({ name: 'notes_list', risk: 'read' }, ceiling)).toBe(true)
    expect(isToolWithinCeiling({ name: 'notes_write', risk: 'write' }, ceiling)).toBe(false)
    expect(decodeToolCeiling('not-base64')).toBeUndefined()
  })
})

