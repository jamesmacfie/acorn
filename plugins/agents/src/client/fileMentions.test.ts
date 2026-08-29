import { describe, expect, it } from 'vitest'
import { fileMentionSuggestions, formatFileMention, parseFileMentions } from './fileMentions'

describe('managed composer file mentions', () => {
  it('extracts relative paths and line ranges', () => {
    expect(parseFileMentions('Review @src/app.ts:4-9 and @README.md.')).toEqual([
      { type: 'file', path: 'src/app.ts', lineStart: 4, lineEnd: 9 },
      { type: 'file', path: 'README.md' },
    ])
  })

  it('does not promote emails, absolute paths, traversal, or duplicates', () => {
    expect(parseFileMentions('a@b.com @/etc/passwd @../secret @src/a.ts @src/a.ts')).toEqual([
      { type: 'file', path: 'src/a.ts' },
    ])
  })

  it('supports quoted paths selected by autocomplete', () => {
    expect(parseFileMentions('Review @"docs/product brief.md":7-11 next.')).toEqual([
      { type: 'file', path: 'docs/product brief.md', lineStart: 7, lineEnd: 11 },
    ])
  })

  it('quotes a path with a space in it, so the mention it writes reads back as one token', () => {
    expect(formatFileMention('src/app.ts')).toBe('@src/app.ts')
    expect(formatFileMention('docs/product brief.md')).toBe('@"docs/product brief.md"')
    expect(parseFileMentions(`Review ${formatFileMention('docs/product brief.md')} next.`))
      .toEqual([{ type: 'file', path: 'docs/product brief.md' }])
  })

  it('fuzzy-ranks file suggestions and caps the list', () => {
    const files = [
      'src/components/AgentPane.tsx',
      'src/agent/state.ts',
      'README.md',
    ]
    expect(fileMentionSuggestions(files, 'state', 2)[0]).toBe('src/agent/state.ts')
    expect(fileMentionSuggestions(files, '', 2)).toEqual(files.slice(0, 2))
  })
})
