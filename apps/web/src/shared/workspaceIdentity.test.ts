import { describe, expect, it } from 'vitest'
import type { WorkspaceIcon } from './api'
import {
  defaultWorkspaceColor,
  isValidWorkspaceColor,
  isValidWorkspaceIcon,
  parseWorkspaceIcon,
  resolveWorkspaceColor,
  serializeWorkspaceIcon,
  WORKSPACE_COLORS,
} from './workspaceIdentity'

describe('defaultWorkspaceColor', () => {
  it('is deterministic and always one of the presets', () => {
    expect(defaultWorkspaceColor('Runn')).toBe(defaultWorkspaceColor('Runn'))
    expect(Object.values(WORKSPACE_COLORS)).toContain(defaultWorkspaceColor('Runn'))
    expect(Object.values(WORKSPACE_COLORS)).toContain(defaultWorkspaceColor(''))
  })
  it('varies with the name', () => {
    const names = ['Runn', 'acorn', 'Side Projects', 'Work', '默认']
    expect(new Set(names.map(defaultWorkspaceColor)).size).toBeGreaterThan(1)
  })
})

describe('resolveWorkspaceColor', () => {
  it('resolves preset tokens, hex with/without #, and falls back to the name hash', () => {
    expect(resolveWorkspaceColor('green', 'X')).toBe(WORKSPACE_COLORS.green)
    expect(resolveWorkspaceColor('#8250df', 'X')).toBe('#8250df')
    expect(resolveWorkspaceColor('8250df', 'X')).toBe('#8250df')
    expect(resolveWorkspaceColor(null, 'X')).toBe(defaultWorkspaceColor('X'))
    expect(resolveWorkspaceColor('not-a-colour', 'X')).toBe(defaultWorkspaceColor('X'))
  })
})

describe('icon JSON round-trip', () => {
  it.each<WorkspaceIcon>([{ kind: 'emoji', value: '🌰' }, { kind: 'lucide', value: 'git-branch' }, { kind: 'github' }])(
    'round-trips %j',
    (icon) => {
      expect(parseWorkspaceIcon(serializeWorkspaceIcon(icon))).toEqual(icon)
    },
  )
  it('degrades malformed values to null instead of throwing', () => {
    expect(parseWorkspaceIcon(null)).toBeNull()
    expect(parseWorkspaceIcon('')).toBeNull()
    expect(parseWorkspaceIcon('not json')).toBeNull()
    expect(parseWorkspaceIcon('{"kind":"emoji"}')).toBeNull()
    expect(parseWorkspaceIcon('{"kind":"image","value":"x.png"}')).toBeNull()
  })
})

describe('boundary validators', () => {
  it('isValidWorkspaceIcon accepts the union and rejects junk', () => {
    expect(isValidWorkspaceIcon({ kind: 'emoji', value: '🌰' })).toBe(true)
    expect(isValidWorkspaceIcon({ kind: 'github' })).toBe(true)
    expect(isValidWorkspaceIcon({ kind: 'emoji', value: '' })).toBe(false)
    expect(isValidWorkspaceIcon({ kind: 'nope' })).toBe(false)
    expect(isValidWorkspaceIcon('emoji')).toBe(false)
  })
  it('isValidWorkspaceColor accepts tokens + hex only', () => {
    expect(isValidWorkspaceColor('green')).toBe(true)
    expect(isValidWorkspaceColor('#1a7f37')).toBe(true)
    expect(isValidWorkspaceColor('1a7f37')).toBe(true)
    expect(isValidWorkspaceColor('reddish')).toBe(false)
    expect(isValidWorkspaceColor('#12345')).toBe(false)
  })
})
