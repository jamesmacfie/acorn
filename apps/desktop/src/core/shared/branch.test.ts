import { describe, expect, it } from 'vitest'
import { dedupeBranch, slugifyBranch } from './branch'

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
