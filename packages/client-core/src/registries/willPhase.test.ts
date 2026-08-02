import { describe, expect, it } from 'vitest'
import { collectConcerns, registerWillHandler } from './willPhaseModel'

describe('will phase', () => {
  it('collects concerns and drops slow handlers at the timeout', async () => {
    const offFast = registerWillHandler('task:archive', 'changes', ({ taskId }) => ({ id: taskId, feature: 'Changes', message: 'dirty', severity: 'danger' }))
    const offSlow = registerWillHandler('task:archive', 'slow', () => new Promise(() => {}))
    await expect(collectConcerns('task:archive', { taskId: 't1' }, 5)).resolves.toEqual([
      { id: 't1', feature: 'Changes', message: 'dirty', severity: 'danger' },
    ])
    offSlow(); offFast()
  })
})
