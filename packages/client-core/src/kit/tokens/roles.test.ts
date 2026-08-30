import { describe, expect, it } from 'vitest'
import { INVARIANT_TOKENS, STYLE_TOKENS, THEME_TOKENS } from './tokenAxes'
import { ROLE_MAP } from './roles'
import { ROLE_ENUMS, type RoleName } from './tokens'

// A role with no answer on a host is a value pretending to be a meaning, so both columns are
// checked for presence. The DOM column is checked harder: it must name a token the appearance
// contract already declares, or a pack could never move it. See docs/ui-design.md § Token axes.

const DECLARED = new Set<string>([...THEME_TOKENS, ...STYLE_TOKENS, ...INVARIANT_TOKENS])
const roles = Object.keys(ROLE_ENUMS) as RoleName[]

describe('role tokens resolve on every host', () => {
  it('covers every enum', () => {
    expect(roles.length).toBeGreaterThan(0)
    expect(roles.filter((role) => !(role in ROLE_MAP))).toEqual([])
  })

  it.each(roles)('%s: every role has a DOM value and a terminal value', (role) => {
    const mapping = ROLE_MAP[role]
    for (const value of ROLE_ENUMS[role]) {
      expect(mapping.dom, `${role}.${value} on the DOM`).toHaveProperty(value)
      expect(mapping.tui, `${role}.${value} on a terminal`).toHaveProperty(value)
      expect((mapping.tui as Record<string, string>)[value]).not.toBe('')
    }
  })

  it.each(roles)('%s: every DOM value is a declared custom property', (role) => {
    const undeclared = Object.entries(ROLE_MAP[role].dom as Record<string, string>)
      .filter(([, token]) => !DECLARED.has(token))
      .map(([value, token]) => `${role}.${value} → ${token}`)
    expect(undeclared).toEqual([])
  })
})
