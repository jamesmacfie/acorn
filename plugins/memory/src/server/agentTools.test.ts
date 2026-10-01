import { describe, expect, it, vi } from 'vitest'
import { memoryAgentTools } from './agentTools'

describe('memory agent read scope', () => {
  it('derives list, search, and get scope from the host task instead of input project IDs', async () => {
    const load = vi.fn().mockResolvedValue({ projectId: 'project-own' })
    const reconciled = vi.fn(async () => {})
    const list = vi.fn(async () => [])
    const search = vi.fn(async () => [])
    const get = vi.fn(async () => ({ name: 'convention' }))
    const tools = memoryAgentTools({ reconciled, list, search, get } as never, {} as never, { tasks: { load } } as never)
    const ctx = { taskId: 'task-own', userLogin: 'owner' }
    await tools.find((tool) => tool.name === 'memory_list')!.handler({ projectId: 'project-foreign' }, ctx)
    await tools.find((tool) => tool.name === 'memory_search')!.handler({ query: 'convention', projectId: 'project-foreign' }, ctx)
    await tools.find((tool) => tool.name === 'memory_get')!.handler({ name: 'convention', projectId: 'project-foreign' }, ctx)
    expect(load.mock.calls).toEqual([['task-own'], ['task-own'], ['task-own']])
    expect(list).toHaveBeenCalledWith({ projectId: 'project-own', type: undefined })
    expect(search).toHaveBeenCalledWith('convention', { projectId: 'project-own', type: undefined })
    expect(get).toHaveBeenCalledWith({ projectId: 'project-own', name: 'convention' })
    expect(reconciled).toHaveBeenCalledTimes(3)
  })

  it('does not query memory when the host task is absent', async () => {
    const list = vi.fn()
    const tools = memoryAgentTools({ reconciled: async () => {}, list } as never, {} as never, { tasks: { load: async () => undefined } } as never)
    await expect(tools.find((tool) => tool.name === 'memory_list')!.handler({}, { taskId: 'missing', userLogin: 'owner' })).rejects.toMatchObject({ kind: 'not_found' })
    expect(list).not.toHaveBeenCalled()
  })
})
