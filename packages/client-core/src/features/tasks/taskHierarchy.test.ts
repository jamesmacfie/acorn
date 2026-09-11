import { describe, expect, it } from 'vitest'
import { taskHierarchy } from './taskHierarchy'

type Task = { id: string; parentId: string | null }
const task = (id: string, parentId: string | null = null): Task => ({ id, parentId })

describe('taskHierarchy', () => {
  it('groups descendants after parents while preserving root and sibling order', () => {
    expect(taskHierarchy([
      task('child-b', 'parent'),
      task('other'),
      task('parent'),
      task('child-a', 'parent'),
      task('grandchild', 'child-a'),
    ])).toEqual([
      { task: task('other'), depth: 0 },
      { task: task('parent'), depth: 0 },
      { task: task('child-b', 'parent'), depth: 1 },
      { task: task('child-a', 'parent'), depth: 1 },
      { task: task('grandchild', 'child-a'), depth: 2 },
    ])
  })

  it('keeps orphans and cycles visible once at depth zero', () => {
    expect(taskHierarchy([
      task('orphan', 'missing'),
      task('cycle-a', 'cycle-b'),
      task('cycle-b', 'cycle-a'),
      task('under-cycle', 'cycle-a'),
      task('self', 'self'),
    ])).toEqual([
      { task: task('orphan', 'missing'), depth: 0 },
      { task: task('cycle-a', 'cycle-b'), depth: 0 },
      { task: task('under-cycle', 'cycle-a'), depth: 1 },
      { task: task('cycle-b', 'cycle-a'), depth: 0 },
      { task: task('self', 'self'), depth: 0 },
    ])
  })
})
