import { describe, expect, it } from 'vitest'
import type { LocalChange } from '../../../core/shared/terminal'
import { changeKey, groupChanges, pickSelected, toPullFile } from './model'

const c = (path: string, staged: boolean, status: LocalChange['status'] = 'modified'): LocalChange => ({
  path,
  status,
  staged,
  additions: null,
  deletions: null,
})

describe('groupChanges', () => {
  it('splits staged/unstaged and sorts each by path', () => {
    const groups = groupChanges([c('z.ts', false), c('a.ts', true), c('m.ts', false), c('b.ts', true)])
    expect(groups.staged.map((x) => x.path)).toEqual(['a.ts', 'b.ts'])
    expect(groups.unstaged.map((x) => x.path)).toEqual(['m.ts', 'z.ts'])
  })
})

describe('pickSelected', () => {
  const groups = groupChanges([c('a.ts', true), c('b.ts', false)])
  it('keeps a still-present selection, else falls back to the first (staged first)', () => {
    expect(pickSelected(groups, changeKey(c('b.ts', false)))?.path).toBe('b.ts')
    expect(pickSelected(groups, 'unstaged:gone.ts')?.path).toBe('a.ts')
    expect(pickSelected(groups, null)?.path).toBe('a.ts')
    expect(pickSelected(groupChanges([]), null)).toBeNull()
  })
})

describe('toPullFile', () => {
  it('maps untracked → added and carries the patch', () => {
    expect(toPullFile(c('n.md', false, 'untracked'), '@@ -0,0 +1 @@\n+x')).toEqual({
      path: 'n.md',
      status: 'added',
      additions: null,
      deletions: null,
      sha: null,
      viewed: false,
      patch: '@@ -0,0 +1 @@\n+x',
    })
  })
})
