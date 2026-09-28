import { describe, expect, it } from 'vitest'
import { isValidProjectColor, PROJECT_COLORS, resolveProjectColor } from './projectColor'

describe('project colour', () => {
  it('resolves preset and hex values for CSS', () => {
    expect(resolveProjectColor('green')).toBe(PROJECT_COLORS.green)
    expect(resolveProjectColor('#8250df')).toBe('#8250df')
    expect(resolveProjectColor('8250df')).toBe('#8250df')
  })

  it('leaves projects without a valid colour unaccented', () => {
    expect(resolveProjectColor(null)).toBeNull()
    expect(resolveProjectColor(undefined)).toBeNull()
    expect(resolveProjectColor('reddish')).toBeNull()
  })

  it('accepts only preset keys and six-digit hex values', () => {
    expect(isValidProjectColor('purple')).toBe(true)
    expect(isValidProjectColor('#8250df')).toBe(true)
    expect(isValidProjectColor('8250df')).toBe(true)
    expect(isValidProjectColor('reddish')).toBe(false)
    expect(isValidProjectColor('#fff')).toBe(false)
  })
})
