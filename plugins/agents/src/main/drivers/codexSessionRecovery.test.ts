import { describe, expect, it } from 'vitest'
import { canReplaceMissingCodexSession } from './codexSessionRecovery'

describe('Codex missing-rollout recovery', () => {
  it('replaces only a missing empty provider thread', () => {
    const missing = new Error('no rollout found for thread id 019fb0b4')
    expect(canReplaceMissingCodexSession(missing, true)).toBe(true)
    expect(canReplaceMissingCodexSession(missing, false)).toBe(false)
  })

  it('does not reinterpret unrelated resume failures', () => {
    expect(canReplaceMissingCodexSession(new Error('permission denied'), true)).toBe(false)
    expect(canReplaceMissingCodexSession('no rollout found for thread id 019fb0b4', true)).toBe(false)
  })
})
