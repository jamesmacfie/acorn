import { describe, expect, it } from 'vitest'
import { taskHierarchy, workflowTaskHierarchy } from './taskHierarchy'

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

describe('workflowTaskHierarchy', () => {
  const workflow = (id: string, parentId: string | null, origin = 'workflows:child') => ({ id, parentId, origin })

  it('starts collapsed and reveals only the active descendant ancestor path', () => {
    const tasks = [
      workflow('root', null, 'local'),
      workflow('one', 'root'),
      workflow('two', 'root'),
      workflow('nested', 'one'),
      workflow('manual', 'root', 'local'),
    ]
    expect(workflowTaskHierarchy(tasks, new Set(), null).map(row => row.task.id)).toEqual(['root', 'manual'])
    expect(workflowTaskHierarchy(tasks, new Set(), 'nested').map(row => row.task.id)).toEqual(['root', 'one', 'nested', 'manual'])
    expect(workflowTaskHierarchy(tasks, new Set(['root']), null).map(row => row.task.id)).toEqual(['root', 'one', 'nested', 'two', 'manual'])
  })

  it('leaves delegated and orphaned tasks visible', () => {
    const tasks = [workflow('delegated', null, 'agents:delegated'), workflow('orphan', 'missing')]
    expect(workflowTaskHierarchy(tasks, new Set(), null).map(row => row.task.id)).toEqual(['delegated', 'orphan'])
  })
})
