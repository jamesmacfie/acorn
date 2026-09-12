import { describe, expect, it } from 'vitest'
import { notifyMode } from './bell'

describe('ACORN_TUI_NOTIFY', () => {
  it('defaults to both, and reads the three other words', () => {
    expect(notifyMode({})).toBe('both')
    expect(notifyMode({ ACORN_TUI_NOTIFY: 'nonsense' })).toBe('both')
    expect(notifyMode({ ACORN_TUI_NOTIFY: 'off' })).toBe('off')
    expect(notifyMode({ ACORN_TUI_NOTIFY: 'bell' })).toBe('bell')
    expect(notifyMode({ ACORN_TUI_NOTIFY: 'terminal' })).toBe('terminal')
  })
})
