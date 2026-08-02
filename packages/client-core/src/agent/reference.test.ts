import { describe, expect, it } from 'vitest'
import { formatFileReference } from './reference'

describe('formatFileReference', () => {
  it('formats path, path:line and path:start-end', () => {
    expect(formatFileReference('src/foo.ts')).toBe('src/foo.ts')
    expect(formatFileReference('src/foo.ts', 42)).toBe('src/foo.ts:42')
    expect(formatFileReference('src/foo.ts', 42, 42)).toBe('src/foo.ts:42')
    expect(formatFileReference('src/foo.ts', 42, 48)).toBe('src/foo.ts:42-48')
  })
  it('normalises a reversed range', () => {
    expect(formatFileReference('a.ts', 48, 42)).toBe('a.ts:42-48')
  })
})
