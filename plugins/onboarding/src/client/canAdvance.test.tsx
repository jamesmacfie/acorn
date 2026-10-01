import { describe, expect, it } from 'vitest'
import { canAdvanceOn } from './OnboardingWizard'

describe('canAdvanceOn', () => {
  it('holds the add step and the GitHub detour until a project is added', () => {
    expect(canAdvanceOn('add', 0)).toBe(false)
    expect(canAdvanceOn('github', 0)).toBe(false)
    expect(canAdvanceOn('add', 1)).toBe(true)
  })

  it('holds the naming step while a name is blank, because saving would keep the old name', () => {
    expect(canAdvanceOn('organize', 2, 1)).toBe(false)
    expect(canAdvanceOn('organize', 2, 0)).toBe(true)
  })

  it('never holds the AI step', () => {
    expect(canAdvanceOn('ai', 0)).toBe(true)
  })
})
