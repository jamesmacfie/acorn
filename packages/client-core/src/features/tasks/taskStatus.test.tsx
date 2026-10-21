import { describe, expect, it, vi } from 'vitest'
import type { TaskStatus } from '@acorn/protocol/task.ts'
import {
  publishTaskStatuses,
  setRailTaskIds,
  statuses,
  taskStatusesChanged,
  taskStatusRevision,
  taskStatusScheduleContribution,
} from './taskStatus'
import { setActiveTaskId } from './tasks'

const events = vi.hoisted(() => new Map<string, () => void>())
vi.mock('../../infra/node/wsClient', () => ({
  wsOnNodeEvent: (channel: string, cb: () => void) => {
    events.set(channel, cb)
    return () => events.delete(channel)
  },
}))
const readStatuses = vi.hoisted(() => vi.fn(async (_ids?: readonly string[]): Promise<TaskStatus[]> => []))
vi.mock('./taskBridge', () => ({ taskBridge: () => ({ task: { statuses: readStatuses } }) }))

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

describe('the task status poll', () => {
  it('refreshes on a worktree write, and not on an agent session frame', () => {
    const refresh = vi.fn()
    const off = taskStatusScheduleContribution.subscribe!(refresh)
    events.get('agent-session:changed')?.()
    expect(refresh).not.toHaveBeenCalled()
    events.get('worktree:status-changed')!()
    expect(refresh).toHaveBeenCalledOnce()
    off()
  })

  it("asks only about the rail's rows and the open task, and asks again when the rows change", async () => {
    const refresh = vi.fn()
    const off = taskStatusScheduleContribution.subscribe!(refresh)
    try {
      setRailTaskIds(['a', 'b'])
      setActiveTaskId('c')
      await taskStatusScheduleContribution.run()
      expect(readStatuses).toHaveBeenLastCalledWith(['a', 'b', 'c'])
      refresh.mockClear()

      setRailTaskIds(['b', 'a'])
      expect(refresh).not.toHaveBeenCalled()
      setRailTaskIds(['a', 'd'])
      expect(refresh).toHaveBeenCalledOnce()

      // An empty rail with nothing open has nothing to ask about.
      setActiveTaskId(null)
      setRailTaskIds([])
      readStatuses.mockClear()
      await taskStatusScheduleContribution.run()
      expect(readStatuses).not.toHaveBeenCalled()

      // No rail, as in the terminal client, asks about every active task.
      setRailTaskIds(null)
      await taskStatusScheduleContribution.run()
      expect(readStatuses).toHaveBeenLastCalledWith(undefined)
    } finally {
      off()
      setRailTaskIds(null)
      setActiveTaskId(null)
    }
  })
})
