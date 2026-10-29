import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDiff } from './diff'

// Real `git diff --no-color --no-ext-diff -U3` output covering every kind of file change.
const CHANGE = readFileSync(new URL('./__fixtures__/change.diff', import.meta.url), 'utf8')

describe('parseDiff', () => {
  const items = parseDiff(CHANGE)
  const byId = (id: string) => items.find((item) => item.id === id)

  it('gives every hunk and every textless file change one item, in file order', () => {
    expect(items.map((item) => item.id)).toEqual([
      'added.txt#1',
      'after.txt#1',
      'café.txt#1',
      'empty.txt#1',
      'img.png#1',
      'nonl.txt#1',
      'old.txt#1',
      'renamed.txt#1',
      'script.sh#1',
      'src.txt#1',
      'src.txt#2',
      'with space.txt#1',
    ])
  })

  it('splits a file into its hunks', () => {
    expect(byId('src.txt#1')?.patch).toBe('@@ -1,5 +1,5 @@\n 1\n-2\n+two\n 3\n 4\n 5')
    expect(byId('src.txt#2')?.patch.startsWith('@@ -25,6 +25,6 @@')).toBe(true)
  })

  it('reads added, deleted, and renamed files', () => {
    expect(byId('added.txt#1')).toMatchObject({ oldPath: null, patch: '@@ -0,0 +1 @@\n+new' })
    expect(byId('old.txt#1')).toMatchObject({ path: 'old.txt', oldPath: null, patch: '@@ -1 +0,0 @@\n-gone' })
    expect(byId('after.txt#1')).toMatchObject({ oldPath: 'before.txt', note: '' })
  })

  it('gives a change with no hunk text one item and a note', () => {
    expect(byId('img.png#1')).toMatchObject({ patch: '', note: 'Binary file added' })
    expect(byId('renamed.txt#1')).toMatchObject({ oldPath: 'moved.txt', patch: '', note: 'Renamed from moved.txt' })
    expect(byId('script.sh#1')).toMatchObject({ patch: '', note: 'Mode changed from 100644 to 100755' })
    expect(byId('empty.txt#1')).toMatchObject({ patch: '', note: 'Empty file added' })
  })

  it('reads quoted paths and paths with spaces', () => {
    expect(byId('café.txt#1')?.patch).toBe('@@ -0,0 +1 @@\n+hi')
    expect(byId('with space.txt#1')?.path).toBe('with space.txt')
    const quotedModeChange = 'diff --git "a/caf\\303\\251.sh" "b/caf\\303\\251.sh"\nold mode 100644\nnew mode 100755\n'
    expect(parseDiff(quotedModeChange)).toEqual([
      { id: 'café.sh#1', path: 'café.sh', oldPath: null, patch: '', note: 'Mode changed from 100644 to 100755' },
    ])
  })

  it('keeps "No newline at end of file" in the hunk', () => {
    expect(byId('nonl.txt#1')?.patch).toBe(
      '@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+y\n\\ No newline at end of file',
    )
  })

  it('answers nothing for an empty diff', () => {
    expect(parseDiff('')).toEqual([])
  })
})
