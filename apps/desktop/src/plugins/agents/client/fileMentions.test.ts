import { describe, expect, it } from 'vitest'
import { parseFileMentions } from './fileMentions'

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
})
