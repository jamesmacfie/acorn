import { describe, expect, it } from 'vitest'
import { parseConflictNames } from './pullConflicts'

describe('parseConflictNames', () => {
  it('takes the conflicting paths between the tree oid and the blank line', () => {
    const stdout = ['a1b2c3treeoid', 'src/app.ts', 'README.md', '', 'Auto-merging src/app.ts', 'CONFLICT (content): ...'].join('\n')
    expect(parseConflictNames(stdout)).toEqual(['src/app.ts', 'README.md'])
  })

  it('handles paths with spaces and a trailing newline', () => {
    expect(parseConflictNames('treeoid\nmy dir/file a.ts\n\nmessages\n')).toEqual(['my dir/file a.ts'])
  })

  it('returns [] when only the tree oid is present', () => {
    expect(parseConflictNames('treeoid\n')).toEqual([])
  })
})
