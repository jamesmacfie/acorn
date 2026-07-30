import { describe, expect, it } from 'vitest'
import {
  activeFileMention,
  completeFileMention,
  fileMentionSuggestions,
  parseFileMentions,
} from './fileMentions'

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

  it('finds and completes the mention at the caret', () => {
    const text = 'Check @src/comp before sending'
    const mention = activeFileMention(text, 'Check @src/comp'.length)
    expect(mention).toEqual({
      start: 6,
      end: 'Check @src/comp'.length,
      query: 'src/comp',
    })
    expect(completeFileMention(text, mention!, 'src/components/AgentPane.tsx')).toEqual({
      text: 'Check @src/components/AgentPane.tsx before sending',
      cursor: 'Check @src/components/AgentPane.tsx '.length,
    })
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
