import { describe, expect, it } from 'vitest'
import gitdiffParser from 'gitdiff-parser'
import { synth } from './diff'

describe('synth', () => {
  it('prepends a git diff header so a hunks-only patch parses', () => {
    expect(synth('src/x.ts', '@@ -1 +1 @@')).toBe(
      ['diff --git a/src/x.ts b/src/x.ts', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -1 +1 @@'].join('\n'),
    )
  })
})

describe('synth + gitdiff-parser pipeline', () => {
  const patch = [
    '@@ -1,3 +1,4 @@',
    ' const a = 1',
    '-const b = 2',
    '+const b = 20',
    '+const c = 3',
    ' const d = 4',
  ].join('\n')

  const file = () => gitdiffParser.parse(synth('src/x.ts', patch))[0]!

  it('yields one file keyed on the synthesized path', () => {
    expect(file().oldPath).toBe('src/x.ts')
    expect(file().newPath).toBe('src/x.ts')
    expect(file().type).toBe('modify')
  })

  it('parses the hunk header into line ranges', () => {
    const h = file().hunks[0]!
    expect(file().hunks).toHaveLength(1)
    expect(h.content).toBe('@@ -1,3 +1,4 @@')
    expect(h.oldStart).toBe(1)
    expect(h.newStart).toBe(1)
    expect(h.oldLines).toBe(3)
    expect(h.newLines).toBe(4)
  })

  it('classifies changes and strips the leading marker from content', () => {
    const changes = file().hunks[0]!.changes
    expect(changes.map((c) => c.type)).toEqual(['normal', 'delete', 'insert', 'insert', 'normal'])

    const [ctx, del, ins1, ins2, tail] = changes
    // context line keeps both old/new numbers
    expect(ctx).toMatchObject({ type: 'normal', content: 'const a = 1', oldLineNumber: 1, newLineNumber: 1 })
    // delete carries an old-side line number only
    expect(del).toMatchObject({ type: 'delete', content: 'const b = 2', lineNumber: 2 })
    // inserts carry new-side line numbers
    expect(ins1).toMatchObject({ type: 'insert', content: 'const b = 20', lineNumber: 2 })
    expect(ins2).toMatchObject({ type: 'insert', content: 'const c = 3', lineNumber: 3 })
    // trailing context line numbers advance past the +1 insertion
    expect(tail).toMatchObject({ type: 'normal', content: 'const d = 4', oldLineNumber: 3, newLineNumber: 4 })
  })

  it('handles multiple hunks', () => {
    const multi = [
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -10,2 +10,3 @@',
      ' x',
      '+y',
      ' z',
    ].join('\n')
    const hunks = gitdiffParser.parse(synth('f.txt', multi))[0]!.hunks
    expect(hunks).toHaveLength(2)
    expect(hunks[0]!.oldStart).toBe(1)
    expect(hunks[1]!.oldStart).toBe(10)
    expect(hunks[1]!.changes.map((c) => c.type)).toEqual(['normal', 'insert', 'normal'])
  })
})
