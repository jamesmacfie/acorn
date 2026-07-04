import { describe, expect, it } from 'vitest'
import { humanizeBranch, prefillFromCompare } from './model'

describe('humanizeBranch', () => {
  it('takes the last segment and humanizes separators', () => {
    expect(humanizeBranch('feature/add-foo')).toBe('Add foo')
    expect(humanizeBranch('fix_bug_123')).toBe('Fix bug 123')
    expect(humanizeBranch('main')).toBe('Main')
  })
})

describe('prefillFromCompare', () => {
  it('uses a single commit subject + body', () => {
    expect(prefillFromCompare([{ sha: 'a', message: 'Add thing\n\nmore detail' }], 'x')).toEqual({
      title: 'Add thing',
      body: 'more detail',
    })
  })
  it('falls back to the humanized branch for multiple commits', () => {
    const commits = [
      { sha: 'a', message: 'one' },
      { sha: 'b', message: 'two' },
    ]
    expect(prefillFromCompare(commits, 'feature/my-thing')).toEqual({ title: 'My thing', body: '' })
  })
  it('humanizes the branch when there are no commits', () => {
    expect(prefillFromCompare([], 'release/v2')).toEqual({ title: 'V2', body: '' })
  })
})
