import { describe, expect, it } from 'vitest'
import { themeColorTokens } from './themeColorTokens'

describe('built-in theme colours for non-CSS hosts', () => {
  it('uses the desktop palette for light, dark, and named themes', () => {
    expect(themeColorTokens('light')?.['--text']).toBe('#242424')
    expect(themeColorTokens('dark')?.['--text']).toBe('#dddddd')
    expect(themeColorTokens('nord')?.['--accent']).toBe('#88c0d0')
    expect(themeColorTokens('nord')?.['--state-ok']).toBe(themeColorTokens('nord')?.['--add-marker'])
    expect(themeColorTokens('unknown')).toBeNull()
  })
})
