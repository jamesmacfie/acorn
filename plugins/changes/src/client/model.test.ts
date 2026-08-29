import { describe, expect, it } from 'vitest'
import type { LocalChange } from '@acorn/protocol/terminal.ts'
import { changeKey, groupChanges, pickSelected, stackFor, toPullFile } from './model'
import { DIFF_LINE_KEY, DIFF_LINE_POINT } from './extensionPoints'

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
  it('keeps a still-present selection, else falls back to the first unstaged change', () => {
    expect(pickSelected(groups, changeKey(c('a.ts', true)))?.path).toBe('a.ts')
    expect(pickSelected(groups, 'unstaged:gone.ts')?.path).toBe('b.ts')
    expect(pickSelected(groups, null)?.path).toBe('b.ts')
    expect(pickSelected(groupChanges([c('a.ts', true)]), null)?.path).toBe('a.ts')
    expect(pickSelected(groupChanges([]), null)).toBeNull()
  })
})

describe('stackFor', () => {
  it('stacks one staging area, so no path appears twice', () => {
    // src/both.ts is staged and then edited again, so it is in both groups.
    const groups = groupChanges([c('src/both.ts', true), c('src/both.ts', false), c('src/only-dirty.ts', false)])
    const staged = stackFor(groups, groups.staged[0])
    const unstaged = stackFor(groups, groups.unstaged[0])

    expect(staged.map((x) => x.path)).toEqual(['src/both.ts'])
    expect(unstaged.map((x) => x.path)).toEqual(['src/both.ts', 'src/only-dirty.ts'])
    for (const stack of [staged, unstaged]) {
      expect(new Set(stack.map((x) => x.path)).size).toBe(stack.length)
    }
    expect(stackFor(groups, null)).toEqual([])
  })
})

describe('toPullFile', () => {
  it('leaves a deleted file no new side, so its gaps stay inert', () => {
    expect(toPullFile(c('src/gone.ts', false, 'deleted'), '@@ -1 +0,0 @@\n-x').sha).toBeNull()
    expect(toPullFile(c('src/kept.ts', true), '').sha).toBe('staged')
  })

  it('maps untracked → added and carries the patch', () => {
    expect(toPullFile(c('n.md', false, 'untracked'), '@@ -0,0 +1 @@\n+x')).toEqual({
      path: 'n.md',
      status: 'added',
      additions: null,
      deletions: null,
      sha: 'unstaged',
      viewed: false,
      patch: '@@ -0,0 +1 @@\n+x',
    })
  })
})

// The annotation point this pane opens on its diff lines (docs/plugins.md § Cooperative extension
// points). The fields have to be the ones the shared viewer mints per row, in that order, or a
// contributor's marks look up under a string nothing ever wrote and draw nothing — silently, because
// an unmatched contribution is silent by design.
//
// Written out rather than compared against `DIFF_ANNOTATION_FIELDS`: that constant lives beside the
// viewer in client-core, and importing across the plugin boundary to check a three-string list would be
// the coupling this seam exists to avoid. The pairing is held from the other end too, in client-core's
// annotationKey.test.ts.
describe('the diff-line annotation point', () => {
  it('is keyed by the three fields the viewer mints, in the viewer\'s order', () => {
    expect(DIFF_LINE_KEY).toEqual(['file', 'line', 'side'])
  })

  it('is addressed under this plugin\'s own name, which the host mints', () => {
    expect(DIFF_LINE_POINT).toBe('changes:diff-line')
  })
})
