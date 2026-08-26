import { describe, expect, it, vi } from 'vitest'
import type { CoreServices, PluginDatabase, StoredConnection } from '@acorn/plugin-api/node'
import { createPullRequest } from '../server/createPull'
import { githubAgentTools } from './agentTools'

vi.mock('../server/createPull', () => ({ createPullRequest: vi.fn() }))

const task = {
  id: 'task-1', title: 'Task', projectId: 'project-1', branch: 'feat/task', worktreePath: null, pullNumber: null,
}
const project = {
  id: 'project-1', name: 'widget', path: null, workspaceId: 'workspace-1',
  github: { owner: 'acme', name: 'widget', repoId: 1 },
}

describe('github_pull_create agent tool', () => {
  it('creates from the task branch, attaches agent provenance, and announces the change', async () => {
    vi.mocked(createPullRequest).mockResolvedValue({ ok: true, number: 73 })
    const attachPull = vi.fn().mockResolvedValue({
      taskId: 'task-1', repoOwner: 'acme', repoName: 'widget', pullNumber: 73,
      role: 'primary', provenance: 'agent', sessionId: 'session-1',
    })
    const core = {
      tasks: { load: vi.fn().mockResolvedValue(task), attachPull },
      projects: { byId: vi.fn().mockResolvedValue(project) },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const providers = {
      withConnection: async <T>(_userId: string, _providerId: string, visit: (connection: StoredConnection, secret: string) => Promise<T | undefined>) =>
        visit({ id: 'github-1' } as StoredConnection, 'token'),
    }
    const onAttached = vi.fn()
    const [tool] = githubAgentTools({} as PluginDatabase, core, providers, onAttached)

    expect(await tool.when?.({ taskId: 'task-1', userLogin: 'owner', sessionId: 'session-1' })).toBe(true)
    await expect(tool.handler(
      { title: 'Ship it', body: 'Details', base: 'main', draft: true },
      { taskId: 'task-1', userLogin: 'owner', sessionId: 'session-1' },
    )).resolves.toEqual({
      number: 73,
      relationship: 'primary',
      pull: { owner: 'acme', repo: 'widget', number: '73' },
    })
    expect(createPullRequest).toHaveBeenCalledWith('token', expect.anything(), 'owner', 'acme', 'widget', {
      title: 'Ship it', body: 'Details', base: 'main', draft: true, head: 'feat/task',
    })
    expect(attachPull).toHaveBeenCalledWith('task-1', {
      repoOwner: 'acme', repoName: 'widget', pullNumber: 73, sessionId: 'session-1',
    })
    expect(onAttached).toHaveBeenCalledOnce()
  })

  it('is unavailable without a managed session', async () => {
    const core = {
      tasks: { load: vi.fn().mockResolvedValue(task) },
      projects: { byId: vi.fn().mockResolvedValue(project) },
    } as unknown as Pick<CoreServices, 'projects' | 'tasks'>
    const [tool] = githubAgentTools({} as PluginDatabase, core, { withConnection: vi.fn() })

    expect(await tool.when?.({ taskId: 'task-1', userLogin: 'owner' })).toBe(false)
    await expect(tool.handler(
      { title: 'Ship it', base: 'main' },
      { taskId: 'task-1', userLogin: 'owner' },
    )).rejects.toThrow(/managed agent session/)
  })
})
