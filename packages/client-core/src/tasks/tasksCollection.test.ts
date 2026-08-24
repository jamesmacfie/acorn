import { describe, expect, it } from 'vitest'
import type { Project, Task, Workspace } from '@acorn/protocol/api.ts'
import { tasksPage } from './tasksCollection'

// The mapping and the filtering, which is everything about this collection that is not a read.

const task = (id: string, projectId: string, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  icon: null,
  origin: 'local',
  projectId,
  branch: `feature/${id}`,
  github: null,
  worktreePath: null,
  pullNumber: null,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
  ...over,
})

const project = (id: string, name: string, hidden = false): Project =>
  ({ id, name, hidden } as Project)

const workspace = (id: string, name: string, projectIds: string[]): Workspace =>
  ({ id, name, projects: projectIds.map((projectId) => ({ id: projectId })) } as Workspace)

const page = (workspaceId?: string) => tasksPage({
  tasks: [task('t1', 'p1'), task('t2', 'p2'), task('t3', 'hidden')],
  projects: [project('p1', 'Web'), project('p2', 'API'), project('hidden', 'Old', true)],
  workspaces: [workspace('w1', 'Product', ['p1']), workspace('w2', 'Platform', ['p2'])],
  ...(workspaceId ? { workspaceId } : {}),
  dirty: (id) => (id === 't1' ? true : null),
})

describe('the workspace tasks collection', () => {
  it('carries the task on the row, so a click has something to open', () => {
    const [row] = page().rows
    expect(row.taskId).toBe('t1')
    expect(row.action).toEqual({ verb: 'openTask' })
    expect(row.values).toEqual({
      title: 'Task t1',
      project: 'p1',
      workspace: 'w1',
      origin: 'local',
      branch: 'feature/t1',
      changes: true,
    })
  })

  it('leaves out a hidden project, exactly as the rail does', () => {
    expect(page().rows.map((row) => row.id)).toEqual(['t1', 't2'])
  })

  it('narrows to one workspace when the param names one', () => {
    expect(page('w2').rows.map((row) => row.id)).toEqual(['t2'])
    expect(page('nobody').rows).toEqual([])
  })

  it('labels the two id-valued columns from the rows own projects and workspaces', () => {
    const field = (id: string) => page().schema.fields.find((entry) => entry.id === id)
    expect(field('workspace')?.values).toEqual([
      { id: 'w2', label: 'Platform' },
      { id: 'w1', label: 'Product' },
    ])
    expect(field('project')?.values?.map((value) => value.label)).toEqual(['API', 'Old', 'Web'])
  })

  it('says "no value here" rather than "clean" for a status it cannot know', () => {
    expect(page().rows[1].values.changes).toBeNull()
  })
})
