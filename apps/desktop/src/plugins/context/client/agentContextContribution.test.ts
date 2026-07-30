import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TaskContext } from '../../../core/shared/api'
import { taskContextAgentContribution } from './agentContextContribution'
import { evictContextSelection, setSectionSelection } from './selectionState'

const context: TaskContext = {
  task: {
    id: 'task-1',
    title: 'Fix linked issue',
    repo: 'acorn/app',
    branch: 'fix/issue',
    worktreePath: '/worktree',
    pullNumber: null,
  },
  sections: [{
    id: 'issues',
    label: 'Linked issues',
    defaultIncluded: true,
    budget: { overflow: 'omit-with-marker' },
    items: [{ id: 'linear:ENG-1', kind: 'linear', label: 'ENG-1 Fix it' }],
    compact: '## Linked issues\n- ENG-1 Fix it',
    omitted: 0,
  }],
  issues: [{ provider: 'linear', identifier: 'ENG-1', title: 'Fix it', detail: 'Open', cache: 'present' }],
  notes: [],
  memory: [],
}

afterEach(() => {
  vi.unstubAllGlobals()
  evictContextSelection('task-1')
})

describe('task agent context contribution', () => {
  it('uses server defaults for untouched tasks and returns one explicit snapshot', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(context), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    const snapshots = await taskContextAgentContribution.capture({ taskId: 'task-1' })

    expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1/context', { signal: undefined })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toMatchObject({
      label: 'Task context',
      source: 'context.task',
      deepLink: { pane: 'context' },
    })
    expect(snapshots[0]?.content).toContain('ENG-1 Fix it')
  })

  it('requests only the sections selected in the Context pane', async () => {
    setSectionSelection('task-1', { issues: true, notes: false, memory: false })
    const fetch = vi.fn(async () => new Response(JSON.stringify(context), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await taskContextAgentContribution.capture({ taskId: 'task-1' })

    expect(fetch).toHaveBeenCalledWith('/api/tasks/task-1/context?include=issues', { signal: undefined })
  })

  it('lists selectable sections and captures the modal selection', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(context), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetch)

    await expect(taskContextAgentContribution.options({ taskId: 'task-1' })).resolves.toEqual([{
      id: 'issues',
      label: 'Linked issues',
      description: '1 item',
      defaultSelected: true,
    }])
    await taskContextAgentContribution.capture({ taskId: 'task-1' }, ['issues'])

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/tasks/task-1/context?include=*', { signal: undefined })
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/tasks/task-1/context?include=issues', { signal: undefined })
  })
})
