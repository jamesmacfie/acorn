import { describe, expect, it } from 'vitest'
import { nodeFetchRequestSchema } from './broker'

describe('node fetch target', () => {
  it('accepts only paths on the paired node authority', () => {
    for (const path of ['/v1/core/tasks', '/v1/p/github/issues?search=foo']) {
      expect(nodeFetchRequestSchema.safeParse({ requestId: 'r', path }).success).toBe(true)
    }
    for (const path of ['//attacker.test/steal', '/\\attacker.test/steal', 'https://attacker.test/steal', '/path#fragment']) {
      expect(nodeFetchRequestSchema.safeParse({ requestId: 'r', path }).success).toBe(false)
    }
    expect(nodeFetchRequestSchema.safeParse({ requestId: 'r', path: '/image', maxResponseBytes: 8 * 1024 * 1024 }).success).toBe(true)
    expect(nodeFetchRequestSchema.safeParse({ requestId: 'r', path: '/image', maxResponseBytes: 65 * 1024 * 1024 }).success).toBe(false)
  })
})
