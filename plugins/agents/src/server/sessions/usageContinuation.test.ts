import { describe, expect, it } from 'vitest'
import { mayBeUsageLimit } from './usageContinuation.ts'

const failure = (message: string) => ({ type: 'error', code: 'claude_turn_failed', message, retryable: false }) as const

describe('mayBeUsageLimit', () => {
  it.each([
    "Internal error: You've hit your session limit · resets 1:10pm (Pacific/Auckland)",
    "Internal error: You've hit your 5-hour limit · resets 1:40pm (Pacific/Auckland)",
    "You've hit your weekly limit · resets Mon 9am",
  ])('recognises Claude wording: %s', (message) => {
    expect(mayBeUsageLimit(failure(message))).toBe(true)
  })

  it('ignores an unrelated failure', () => {
    expect(mayBeUsageLimit(failure('Internal error: No model selected.'))).toBe(false)
  })
})
