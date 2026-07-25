import { describe, expect, it } from 'vitest'
import { branchSlug, isContainedPath, isDirty, isValidRepoIdent, worktreeBranchDirName, worktreeDirName } from './pathGuards'

describe('worktrees', () => {
  it('builds the per-PR dir name', () => {
    expect(worktreeDirName('acme', 'widget', 42)).toBe('acme-widget-pr-42')
  })
  it('builds the per-branch dir name through the slug', () => {
    expect(worktreeBranchDirName('acme', 'widget', 'feat/login')).toBe('acme-widget-feat-login')
  })
  it('slugs anything not filesystem-safe', () => {
    expect(branchSlug('feat/login')).toBe('feat-login')
    expect(branchSlug('fix:@bug!')).toBe('fix--bug-')
    expect(branchSlug('keep.this_one-2')).toBe('keep.this_one-2')
  })
  it('treats any porcelain output as dirty', () => {
    expect(isDirty('')).toBe(false)
    expect(isDirty('\n  \n')).toBe(false)
    expect(isDirty(' M src/a.ts\n?? b.ts')).toBe(true)
  })
})

describe('path-traversal guards', () => {
  it('isValidRepoIdent rejects traversal and separators', () => {
    expect(isValidRepoIdent('acme')).toBe(true)
    expect(isValidRepoIdent('my.repo_2-x')).toBe(true)
    expect(isValidRepoIdent('..')).toBe(false)
    expect(isValidRepoIdent('.hidden')).toBe(false)
    expect(isValidRepoIdent('a/b')).toBe(false)
    expect(isValidRepoIdent('../../etc')).toBe(false)
    expect(isValidRepoIdent('')).toBe(false)
  })
  it('isContainedPath rejects escapes from the root', () => {
    expect(isContainedPath('/data/worktrees', '/data/worktrees/acme-w-pr-1')).toBe(true)
    expect(isContainedPath('/data/worktrees', '/data/worktrees')).toBe(true)
    expect(isContainedPath('/data/worktrees', '/data/worktrees/../../etc/passwd')).toBe(false)
    expect(isContainedPath('/data/worktrees', '/data/worktrees-evil')).toBe(false)
    expect(isContainedPath('/data/worktrees', '/etc/passwd')).toBe(false)
  })
})
