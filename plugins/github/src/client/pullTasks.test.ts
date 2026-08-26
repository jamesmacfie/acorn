import { QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { tasksKey, type Task } from '@acorn/plugin-api/client'
import { activeTaskForPull, promotePullToTask } from './pullTasks'

const task = (overrides: Partial<Task> = {}): Task => ({
  id: 'task-1',
  title: 'Pull task',
  icon: null,
  origin: 'manual',
  projectId: 'project-1',
  branch: 'feature',
  github: { owner: 'acme', name: 'widget' },
  worktreePath: null,
  pullNumber: 42,
  status: 'active',
  parentId: null,
  sort: 0,
  links: [],
  ...overrides,
})

describe('pull task promotion', () => {
  it('recognises any active task whose primary is the pull', () => {
    const existing = task()
    expect(activeTaskForPull([
      task({ id: 'archived', status: 'archived' }),
      task({ id: 'other-project', projectId: 'project-2' }),
      existing,
    ], 'project-1', 42)).toBe(existing)
  })

  it('returns a cached task instead of creating a duplicate', async () => {
    const queryClient = new QueryClient()
    const existing = task()
    queryClient.setQueryData(tasksKey, [existing])

    await expect(promotePullToTask(queryClient, {
      owner: 'acme', repo: 'widget', number: '42', projectId: 'project-1', headRef: 'feature',
    })).resolves.toBe(existing)
  })

  it('requires a head branch', async () => {
    await expect(promotePullToTask(new QueryClient(), {
      owner: 'acme', repo: 'widget', number: '42', projectId: 'project-1', headRef: ' ',
    })).rejects.toThrow(/head branch/)
  })
})
