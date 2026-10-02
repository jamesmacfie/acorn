import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, ContributedCommand, SearchCommand } from '@acorn/plugin-api/client'
import type { MemoryRow } from './memoryClient'

const mocks = vi.hoisted(() => ({ search: vi.fn(), prepare: vi.fn(), openPane: vi.fn(), setSelectedSource: vi.fn(), projectPath: vi.fn((id: string) => `/p/${id}`) }))
vi.mock('./memoryClient', () => ({ memoryApi: () => ({ search: mocks.search, prepare: mocks.prepare }) }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  openPane: mocks.openPane,
  setSelectedSource: mocks.setSelectedSource,
  projectPath: mocks.projectPath,
}))

import { selectedMemory } from './memorySelection'
import { memoryCommands } from './commands'

// Search and review open the Memory page. Selection uses the scope and filename identity.

const memory = (over: Partial<MemoryRow> = {}): MemoryRow & { rank: number } => ({
  id: 'm1', scope: 'project', projectId: 'p-1', name: 'no-ponytail-comments', type: 'convention',
  description: 'strip the marker before committing', body: '', path: 'x.md',
  originSessionId: null, commitSha: null, supersededBy: null, createdAt: 0, updatedAt: 0, rank: -1,
  ...over,
})

const context = (over: Partial<CommandExecutionContext> = {}): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId: 'task-1',
  paneId: null, surfaceId: null, ...over,
})
const signal = (): AbortSignal => new AbortController().signal

const at = (id: string): ContributedCommand => memoryCommands.find((command) => command.id === id)!
const find = (): SearchCommand => at('memory.search') as SearchCommand

describe('the memory plugin catalogue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes explicit learning preparation, search, and the review page', () => {
    expect(memoryCommands.map((command) => command.id)).toEqual(['memory.learnings.review', 'memory.search', 'memory.proposals.open'])
    for (const command of memoryCommands) {
      expect(command.palette, command.id).toBe(true)
    }
    expect(at('memory.learnings.review').requires).toEqual({ plugin: 'findings' })
    expect(at('memory.search').requires).toEqual({ plugin: 'memory' })
    expect(at('memory.proposals.open').requires).toEqual({ plugin: 'memory' })
    // A search captures the task's project scope. A pending proposal is not
    // task-scoped and its page is a rail source, so it stays offered with no task in hand.
    expect(at('memory.search').scope).toBe('task')
    expect(at('memory.learnings.review').scope).toBe('task')
    expect(at('memory.proposals.open').scope).toBeUndefined()
    // Remote, so the defaults apply: it waits for the typing to stop and for two characters.
    expect(find().debounceMs).toBeUndefined()
    expect(find().minQueryLength).toBeUndefined()
  })

  it('asks about the captured project and badges each row with its type', async () => {
    mocks.search.mockResolvedValue([memory(), memory({ id: 'm2', name: 'rtk-grep', type: 'fix', description: 're-run through rtk proxy' })])
    expect(await find().query('grep', context(), signal())).toEqual([
      { id: 'm1', title: 'no-ponytail-comments', subtitle: 'strip the marker before committing', badge: 'convention', ref: '{"name":"no-ponytail-comments","scope":"project"}' },
      { id: 'm2', title: 'rtk-grep', subtitle: 're-run through rtk proxy', badge: 'fix', ref: '{"name":"rtk-grep","scope":"project"}' },
    ])
    expect(mocks.search).toHaveBeenCalledWith('grep', 'p-1')
  })

  it('keeps the frame open with the node’s own message', async () => {
    mocks.search.mockResolvedValue({ error: 'memory index is not built' })
    await expect(find().query('grep', context(), signal())).rejects.toThrow('memory index is not built')
  })

  it('opens the picked memory on the Memory page', async () => {
    mocks.search.mockResolvedValue([memory()])
    const navigate = vi.fn()
    const world = context({ navigate })
    const rows = await find().query('pony', world, signal())
    expect(find().select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('memory')
    expect(navigate).toHaveBeenCalledWith('/p/p-1')
    expect(selectedMemory()).toEqual({ name: 'no-ponytail-comments', scope: 'project' })
  })

  it('sends the proposals row to the routed project’s Memory page, not into a task', () => {
    const navigate = vi.fn()
    ;(at('memory.proposals.open') as { run: (c: CommandExecutionContext) => void }).run(context({ navigate }))
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('memory')
    expect(navigate).toHaveBeenCalledWith('/p/p-1')
    expect(mocks.openPane).not.toHaveBeenCalled()
  })

  it('prepares with server-owned settings and opens the bundle’s project', async () => {
    const navigate = vi.fn()
    mocks.prepare.mockResolvedValue({ scope: { kind: 'project', projectId: 'p-from-bundle' } })
    const command = at('memory.learnings.review') as { run: (c: CommandExecutionContext) => Promise<unknown> }
    await command.run(context({ projectId: null, navigate }))
    expect(mocks.prepare).toHaveBeenCalledWith('task-1', expect.stringMatching(/^manual:task-1:/))
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('memory')
    expect(navigate).toHaveBeenCalledWith('/p/p-from-bundle')
  })
})
