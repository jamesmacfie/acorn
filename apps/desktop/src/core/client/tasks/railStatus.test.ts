import { describe, expect, it } from 'vitest'
import { railStatusItems } from './railStatus'
import type { TaskStatus } from '../../shared/terminal'

const status = (p: Partial<TaskStatus>): TaskStatus => ({ taskId: 't', worktreePath: null, dirty: false, dirtyCount: 0, missing: false, ...p })

describe('railStatusItems', () => {
  it('emits nothing when the task is idle and clean', () => {
    expect(railStatusItems({ checks: null, working: 0, unread: false, status: status({}) })).toEqual([])
  })

  it('surfaces each active marker with a glyph or dot and a meaning', () => {
    const items = railStatusItems({ checks: 'failure', working: 2, unread: true, status: status({ dirty: true, dirtyCount: 3 }) })
    expect(items.map((i) => i.key)).toEqual(['checks', 'working', 'needs', 'dirty'])
    expect(items.every((i) => i.label && (i.glyph || i.dotCls))).toBe(true)
    expect(items.find((i) => i.key === 'working')?.label).toBe('2 agents working')
    expect(items.find((i) => i.key === 'dirty')?.label).toBe('Uncommitted changes (3)')
  })

  it('shows repair, not dirty, when the worktree is missing', () => {
    const keys = railStatusItems({ checks: null, working: 0, unread: false, status: status({ dirty: true, dirtyCount: 1, missing: true }) }).map((i) => i.key)
    expect(keys).toEqual(['repair'])
  })
})
