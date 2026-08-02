import { describe, expect, it } from 'vitest'
import { dedupeBranch, normalizeBranchPrefix, slugifyBranch, withBranchPrefix } from './branch'

describe('slugifyBranch', () => {
  it('lowercases and strips illegal chars to [a-z0-9/-]', () => {
    expect(slugifyBranch('Fix Login Crash!')).toBe('fix-login-crash')
    expect(slugifyBranch('ENG-42: SSO fails')).toBe('eng-42-sso-fails')
    expect(slugifyBranch('feat/Login #2')).toBe('feat/login-2')
  })
  it('collapses runs and trims edge separators', () => {
    expect(slugifyBranch('--a---b--')).toBe('a-b')
    expect(slugifyBranch('/feat//x/')).toBe('feat/x')
    expect(slugifyBranch('  spaced   out  ')).toBe('spaced-out')
  })
  it('caps at 60 chars without leaving a dangling separator', () => {
    const long = 'a'.repeat(59) + '-tail'
    const out = slugifyBranch(long)
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out.endsWith('-')).toBe(false)
  })
  it('returns empty for all-illegal input', () => {
    expect(slugifyBranch('!!!')).toBe('')
  })
})

describe('dedupeBranch', () => {
  it('returns the name when free and suffixes -2, -3, … when taken', () => {
    expect(dedupeBranch('fix-login', [])).toBe('fix-login')
    expect(dedupeBranch('fix-login', ['fix-login'])).toBe('fix-login-2')
    expect(dedupeBranch('fix-login', ['fix-login', 'fix-login-2'])).toBe('fix-login-3')
  })
})

describe('normalizeBranchPrefix', () => {
  it('keeps a trailing - and otherwise adds /', () => {
    expect(normalizeBranchPrefix('jamesmacfie/')).toBe('jamesmacfie/')
    expect(normalizeBranchPrefix('jamesmacfie')).toBe('jamesmacfie/')
    expect(normalizeBranchPrefix('wip-')).toBe('wip-')
    expect(normalizeBranchPrefix('Feature ')).toBe('feature/')
  })
  it('clears when nothing slugifiable survives', () => {
    expect(normalizeBranchPrefix('')).toBe('')
    expect(normalizeBranchPrefix('///')).toBe('')
  })
})

describe('withBranchPrefix', () => {
  it('prepends the prefix and is idempotent', () => {
    expect(withBranchPrefix('me/', 'fix-login')).toBe('me/fix-login')
    expect(withBranchPrefix('me/', 'me/fix-login')).toBe('me/fix-login')
  })
  it('is a no-op without a prefix or without a branch', () => {
    expect(withBranchPrefix(null, 'fix-login')).toBe('fix-login')
    expect(withBranchPrefix('me/', '')).toBe('')
  })
})
