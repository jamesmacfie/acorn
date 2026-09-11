import { describe, expect, it } from 'vitest'
import { defaultBranchForTask } from './defaultBranch'

describe('defaultBranchForTask', () => {
  it('derives a prefixed branch from the task title', () => {
    expect(defaultBranchForTask('Fix Login Crash!', 'james/', [])).toBe('james/fix-login-crash')
  })

  it('de-duplicates the final prefixed name', () => {
    expect(defaultBranchForTask('Fix Login', 'james/', [
      'james/fix-login',
      'james/fix-login-2',
    ])).toBe('james/fix-login-3')
  })
})
