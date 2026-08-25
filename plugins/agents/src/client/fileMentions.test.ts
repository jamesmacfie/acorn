import { describe, expect, it } from 'vitest'
import {
  activeFileMention,
  activeMention,
  completeFileMention,
  completeMention,
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

  it('reads the sigil at the caret, so one dropdown serves files, commands and skills', () => {
    expect(activeMention('run /rev', 'run /rev'.length))
      .toEqual({ sigil: '/', start: 4, end: 8, query: 'rev' })
    expect(activeMention('then $read', 'then $read'.length))
      .toEqual({ sigil: '$', start: 5, end: 10, query: 'read' })
    expect(activeMention('a@b.com', 'a@b.com'.length)).toBeNull()
    // Mid-word, not a mention: 9/11 and and/or are the everyday false positives.
    expect(activeMention('shipped 9/11', 'shipped 9/11'.length)).toBeNull()
  })

  it('completes a command without the quoting a path would need', () => {
    const text = 'run /rev now'
    const mention = activeMention(text, 'run /rev'.length)
    expect(completeMention(text, mention!, '/review')).toEqual({
      text: 'run /review now',
      cursor: 'run /review '.length,
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
