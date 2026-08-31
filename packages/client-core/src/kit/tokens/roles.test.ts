import { describe, expect, it } from 'vitest'
import { INVARIANT_TOKENS, STYLE_TOKENS, THEME_TOKENS } from './tokenAxes'
import { ROLE_MAP, roleCell, type TuiValue } from './roles'
import { ROLE_ENUMS, type RoleName } from './tokens'

// A role with no answer on a host is a value pretending to be a meaning, so both columns are
// checked. The DOM column must name a token the appearance contract already declares, or a pack
// could never move it. See docs/ui-design.md § Token axes.
//
// The terminal column is checked twice over, because it says two things now: a sentence, which is
// the documentation, and the cells a component is handed. `ignored` is an answer in both — the
// sentence says so and `roleCell` hands back nothing — and the pair has to agree, or a role would
// read as ignored in the docs and paint something on screen.

const DECLARED = new Set<string>([...THEME_TOKENS, ...STYLE_TOKENS, ...INVARIANT_TOKENS])
const roles = Object.keys(ROLE_ENUMS) as RoleName[]
const tuiValues = (role: RoleName): [string, TuiValue][] =>
  Object.entries(ROLE_MAP[role].tui as Record<string, TuiValue>)

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
      expect((mapping.tui as Record<string, TuiValue>)[value].said).not.toBe('')
    }
  })

  it.each(roles)('%s: every DOM value is a declared custom property', (role) => {
    const undeclared = Object.entries(ROLE_MAP[role].dom as Record<string, string>)
      .filter(([, token]) => !DECLARED.has(token))
      .map(([value, token]) => `${role}.${value} → ${token}`)
    expect(undeclared).toEqual([])
  })

  it.each(roles)('%s: roleCell hands back cells and never the sentence', (role) => {
    for (const [value] of tuiValues(role)) {
      expect(roleCell(role, value as never), `${role}.${value}`).not.toHaveProperty('said')
    }
  })

  it('the role values that draw nothing are the ones that say they draw nothing', () => {
    // Three sentences mean "spend no cells on this": `ignored` for a role a terminal has no answer
    // for, `nothing` for the border that is no border, and `plain` for text with nothing on it. The
    // list is written out rather than derived, because a role quietly becoming empty is exactly the
    // regression this file exists to catch — a kit that draws nothing passes every other assertion
    // here.
    const empty = roles.flatMap((role) =>
      tuiValues(role).filter(([value]) => Object.keys(roleCell(role, value as never)).length === 0).map(([value]) => `${role}.${value}`))
    expect(empty.sort()).toEqual([
      'border.none', 'radius.chip', 'radius.control', 'radius.pill', 'radius.surface', 'text.body', 'text.mono',
    ])
    for (const entry of empty) {
      const [role, value] = entry.split('.') as [RoleName, string]
      const said = (ROLE_MAP[role].tui as Record<string, TuiValue>)[value].said
      expect(['ignored', 'nothing', 'plain'], entry).toContain(said)
    }
  })

  it('a terminal value that draws a colour names a slot rather than a colour', () => {
    // The whole reason `Slot` exists: a role says "the accent", the appearance layer says which
    // sixteenth or which hex that is (apps/tui/src/appearance.ts). A hex here would be a theme
    // decision taken in the wrong file.
    const named = roles.flatMap((role) => tuiValues(role).map(([value, tui]) => `${role}.${value}: ${tui.slot ?? ''}`))
      .filter((entry) => /#|rgb|oklch/.test(entry))
    expect(named).toEqual([])
  })

  it('only radius and mono are ignored outright', () => {
    // A terminal is monospaced and has no corners, so those five have nothing to say. A sixth
    // arriving is a decision somebody should have to make on purpose.
    const ignored = roles.flatMap((role) => tuiValues(role).filter(([, tui]) => tui.said === 'ignored').map(([value]) => `${role}.${value}`))
    expect(ignored.sort()).toEqual(['radius.chip', 'radius.control', 'radius.pill', 'radius.surface', 'text.mono'])
  })
})
