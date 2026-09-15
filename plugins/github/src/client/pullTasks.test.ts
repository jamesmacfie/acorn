import { QueryClient } from '@tanstack/solid-query'
import { describe, expect, it } from 'vitest'
import { projectsKey, tasksKey, workspaceExternalProjectsKey, type Task } from '@acorn/plugin-api/client'
import type { Integration } from '@acorn/protocol/api.ts'
import { activeTaskForPull, linearConnectionForProject, promotePullToTask } from './pullTasks'

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

const linear = (id: string): Integration => ({
  id,
  providerId: 'linear',
  label: `Linear · ${id}`,
  status: 'connected',
  authKind: 'api-key',
  account: null,
  scopes: [],
  capabilities: {},
  createdAt: 0,
  updatedAt: 0,
})

// The project map is seeded straight into the cache, the same way the promotion path reads it.
const clientWith = (mappings: { integrationId: string; externalId: string; projectId?: string }[]) => {
  const queryClient = new QueryClient()
  queryClient.setQueryData(projectsKey, [
    { id: 'project-1', name: 'Widget', path: null, workspaceId: 'ws-1', sort: 0, hidden: false, color: null },
  ])
  queryClient.setQueryData(workspaceExternalProjectsKey('ws-1'), { projects: mappings })
  return queryClient
}

describe('attributing a pull request reference to a Linear connection', () => {
  it('takes the only connected Linear without consulting the map', async () => {
    // No projects and no mappings in this cache, so answering at all proves the map was not needed.
    await expect(linearConnectionForProject(new QueryClient(), 'project-1', [linear('one')])).resolves.toBe('one')
  })

  it('has no connection to name when no Linear is connected', async () => {
    await expect(linearConnectionForProject(new QueryClient(), 'project-1', [])).resolves.toBeNull()
  })

  it('lets the project map pick between two workspaces', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a' },
      { integrationId: 'unmapped-elsewhere', externalId: 'lin-b' },
    ])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]))
      .resolves.toBe('work')
  })

  it('counts a link that names this project as well as one that names the whole workspace', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a', projectId: 'project-1' },
      { integrationId: 'side', externalId: 'lin-b', projectId: 'project-2' },
    ])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]))
      .resolves.toBe('work')
  })

  it('refuses to guess when the repo follows both Linears', async () => {
    const queryClient = clientWith([
      { integrationId: 'work', externalId: 'lin-a' },
      { integrationId: 'side', externalId: 'lin-b' },
    ])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]))
      .resolves.toBeNull()
  })

  it('refuses to guess when the repo follows neither', async () => {
    const queryClient = clientWith([])
    await expect(linearConnectionForProject(queryClient, 'project-1', [linear('work'), linear('side')]))
      .resolves.toBeNull()
  })
})
