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

  // The bug this exists for: a handler registered twice drew two identical rows in the archive
  // dialog, they shared a checkbox because the state map is keyed on `id`, and confirming ran the
  // side effect twice. Disposal is the real fix; this is the guard that keeps the next one cosmetic.
  it('keeps one row per feature and id', async () => {
    const concern = { id: 'containers', feature: 'docker', message: '8 running', severity: 'warn' } as const
    const offA = registerWillHandler('task:archive', 'docker', () => ({ ...concern }))
    const offB = registerWillHandler('task:archive', 'docker', () => ({ ...concern }))
    await expect(collectConcerns('task:archive', { taskId: 't1' }, 50)).resolves.toEqual([concern])
    offB(); offA()
  })

  it('keeps rows that share an id across different features', async () => {
    const offA = registerWillHandler('task:archive', 'docker', () => ({ id: 'x', feature: 'docker', message: 'a', severity: 'warn' as const }))
    const offB = registerWillHandler('task:archive', 'changes', () => ({ id: 'x', feature: 'changes', message: 'b', severity: 'warn' as const }))
    await expect(collectConcerns('task:archive', { taskId: 't1' }, 50)).resolves.toHaveLength(2)
    offB(); offA()
  })

  it('contains a throwing handler', async () => {
    const offBad = registerWillHandler('task:archive', 'bad', () => { throw new Error('boom') })
    const offGood = registerWillHandler('task:archive', 'good', () => ({ id: 'ok', feature: 'good', message: 'still here', severity: 'warn' as const }))
    await expect(collectConcerns('task:archive', { taskId: 't1' }, 50)).resolves.toHaveLength(1)
    offGood(); offBad()
  })
})
