import { describe, expect, it } from 'vitest'
import { sameInlineLine, type InlineDiffOrigin } from '../contract/inlineDiff.ts'
import { createAgentSessionSchema } from './schemas.ts'

const origin: InlineDiffOrigin = {
  kind: 'inline-diff', source: 'changes', taskId: '5e35dc7d-9dca-40d7-ab0e-20ec749404ba',
  path: 'src/a.ts', side: 'new', line: 42, patchKey: 'patch-a', quote: '+answer', scope: 'unstaged',
}

describe('inline diff session origin', () => {
  it('treats a new patch or staging area as a different line conversation', () => {
    expect(sameInlineLine(origin, { ...origin })).toBe(true)
    expect(sameInlineLine(origin, { ...origin, patchKey: 'patch-b' })).toBe(false)
    expect(sameInlineLine(origin, { ...origin, scope: 'staged' })).toBe(false)
  })

  it('rejects an origin for another task or a mismatched source', () => {
    const input = {
      taskId: origin.taskId, providerId: 'codex', profileId: 'codex', kind: 'interactive', config: {}, origin,
    }
    expect(createAgentSessionSchema.safeParse(input).success).toBe(true)
    expect(createAgentSessionSchema.safeParse({ ...input, taskId: '0c59631c-2f15-4f22-93af-e76e3b81e517' }).success).toBe(false)
    expect(createAgentSessionSchema.safeParse({ ...input, origin: { ...origin, source: 'pull-request' } }).success).toBe(false)
  })
})
