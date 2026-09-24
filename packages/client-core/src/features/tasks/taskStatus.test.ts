import { describe, expect, it } from 'vitest'
import type { TaskStatus } from '@acorn/protocol/task.ts'
import { publishTaskStatuses, statuses, taskStatusesChanged, taskStatusRevision } from './taskStatus'

const clean: TaskStatus = {
  taskId: 'task-1',
  worktreePath: '/tmp/acorn/task-1',
  dirty: false,
  dirtyCount: 0,
  branch: null,
  head: null,
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

  it('publishes every completed poll without replacing an unchanged rail snapshot', () => {
    publishTaskStatuses([clean])
    const snapshot = statuses()
    const revision = taskStatusRevision()

    publishTaskStatuses([{ ...clean }])

    expect(statuses()).toBe(snapshot)
    expect(taskStatusRevision()).toBe(revision + 1)
  })
})
