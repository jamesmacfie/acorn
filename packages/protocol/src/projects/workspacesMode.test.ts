import { describe, expect, it } from 'vitest'
import { workspacesMode } from './workspacesMode'

describe('workspacesMode', () => {
  it('keeps existing projects grouped and starts an empty Node project-first', () => {
    expect(workspacesMode(null, 2)).toBe('on')
    expect(workspacesMode(null, 0)).toBe('off')
    expect(workspacesMode('on', 0)).toBe('on')
    expect(workspacesMode('off', 2)).toBe('off')
  })
})
