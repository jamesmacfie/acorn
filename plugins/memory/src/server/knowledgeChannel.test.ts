import { describe, expect, it, vi } from 'vitest'
import { registerKnowledgeChannel } from './knowledgeChannel'

describe('memory route task scope resolution', () => {
  it('resolves only the task project and fails closed when its task or project disappears', async () => {
    const load = vi.fn().mockResolvedValueOnce({ projectId: 'project-a' }).mockResolvedValueOnce(undefined).mockResolvedValueOnce({ projectId: 'missing' }).mockResolvedValueOnce({ projectId: null })
    const byId = vi.fn().mockResolvedValueOnce({ id: 'project-a' }).mockResolvedValueOnce(undefined)
    const runtime = registerKnowledgeChannel({} as never, { tasks: { load }, projects: { byId } } as never, {})
    expect(await runtime.route.taskMemoryScope('task-a')).toEqual({ projectId: 'project-a' })
    expect(await runtime.route.taskMemoryScope('missing-task')).toBeNull()
    expect(await runtime.route.taskMemoryScope('orphan-task')).toBeNull()
    expect(await runtime.route.taskMemoryScope('private-only-task')).toEqual({ projectId: null })
    expect(load.mock.calls).toEqual([['task-a'], ['missing-task'], ['orphan-task'], ['private-only-task']])
    expect(byId.mock.calls).toEqual([['project-a'], ['missing']])
    // No database handle or reconciliation facets are supplied. Scope checks must not touch them.
  })

  it('propagates scope lookup failures to the route denial boundary', async () => {
    const load = vi.fn().mockRejectedValue(new Error('scope lookup failed'))
    const runtime = registerKnowledgeChannel({} as never, { tasks: { load } } as never, {})
    await expect(runtime.route.taskMemoryScope('task-a')).rejects.toThrow('scope lookup failed')
  })
})
