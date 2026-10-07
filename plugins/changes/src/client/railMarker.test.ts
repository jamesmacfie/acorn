import { describe, expect, it } from 'vitest'
import type { LocalChange } from '@acorn/protocol/localGit.ts'
import { changesDot } from './railMarker'

const change = (over: Partial<LocalChange>): LocalChange =>
  ({ path: 'a.ts', status: 'modified', staged: false, additions: 0, deletions: 0, ...over })

describe('changesDot', () => {
  it('says nothing about a clean tree', () => {
    expect(changesDot([])).toBeNull()
  })

  it('is green when the changes only add lines, counting files git gives no line counts for', () => {
    expect(changesDot([change({ additions: 3 })])).toBe('ok')
    expect(changesDot([change({ status: 'untracked', additions: null, deletions: null })])).toBe('ok')
  })

  it('is red when the changes only remove lines, including a deleted file', () => {
    expect(changesDot([change({ deletions: 2 })])).toBe('bad')
    expect(changesDot([change({ status: 'deleted', additions: null, deletions: null })])).toBe('bad')
  })

  it('is split when lines go both ways, in one file or across two', () => {
    expect(changesDot([change({ additions: 1, deletions: 1 })])).toBe('diff')
    expect(changesDot([change({ additions: 1 }), change({ path: 'b.ts', deletions: 4 })])).toBe('diff')
  })
})
