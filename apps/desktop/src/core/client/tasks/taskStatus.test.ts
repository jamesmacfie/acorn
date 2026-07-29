import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '../../shared/terminal'
import { taskStatusesChanged } from './taskStatus'

const clean: TaskStatus = {
  taskId: 'task-1',
  worktreePath: '/tmp/acorn/task-1',
  dirty: false,
  dirtyCount: 0,
  missing: false,
}

describe('task status snapshots', () => {
  it('preserves an unchanged snapshot so reactive rail consumers do not rerun', () => {
    expect(taskStatusesChanged({ [clean.taskId]: clean }, [{ ...clean }])).toBe(false)
  })

  it('publishes additions, removals, and material status changes', () => {
    expect(taskStatusesChanged({}, [clean])).toBe(true)
    expect(taskStatusesChanged({ [clean.taskId]: clean }, [])).toBe(true)
    expect(taskStatusesChanged({ [clean.taskId]: clean }, [{ ...clean, dirty: true, dirtyCount: 1 }])).toBe(true)
  })
})
