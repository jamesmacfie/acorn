import { describe, expect, it } from 'vitest'
import { humanizeBranch, parsePullDraft, prefillFromCompare } from './model'

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

describe('parsePullDraft', () => {
  it('round-trips a stored draft', () => {
    const d = { base: 'main', head: 'feat', title: 'T', body: 'B', draft: true, touched: true }
    expect(parsePullDraft(JSON.stringify(d))).toEqual(d)
  })
  it('fills missing fields and drops unusable values', () => {
    expect(parsePullDraft('{"head":"feat","draft":"yes"}')).toEqual({
      base: '',
      head: 'feat',
      title: '',
      body: '',
      draft: false,
      touched: false,
    })
  })
  it('returns null for nothing stored or malformed JSON', () => {
    expect(parsePullDraft(null)).toBeNull()
    expect(parsePullDraft('{oops')).toBeNull()
  })
})
