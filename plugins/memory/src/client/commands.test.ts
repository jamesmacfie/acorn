import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandExecutionContext, ContributedCommand, SearchCommand } from '@acorn/plugin-api/client'
import type { MemoryRow } from './memoryClient'

const mocks = vi.hoisted(() => ({ search: vi.fn(), openPane: vi.fn(), setSelectedSource: vi.fn() }))
vi.mock('./memoryClient', () => ({ memoryApi: () => ({ search: mocks.search }) }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  openPane: mocks.openPane,
  setSelectedSource: mocks.setSelectedSource,
}))

import { memoryCommands } from './commands'

// The two memory commands. What is pinned is the scope each carries, the fact that a search row
// reveals by the memory's NAME (the context section keys its rows that way, and revealing by the
// database id would silently scroll to nothing), and the fact that the proposals row goes to the
// Memory page rather than into a task's Context pane.

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

  it('is a search and one open action, gated on the plugin, and only the search needs a task', () => {
    expect(memoryCommands.map((command) => command.id)).toEqual(['memory.search', 'memory.proposals.open'])
    for (const command of memoryCommands) {
      expect(command.requires, command.id).toEqual({ plugin: 'memory' })
      expect(command.palette, command.id).toBe(true)
    }
    // A search hit opens in a task's Context pane, so it needs one. A pending proposal is not
    // task-scoped and its page is a rail source, so it stays offered with no task in hand.
    expect(at('memory.search').scope).toBe('task')
    expect(at('memory.proposals.open').scope).toBeUndefined()
    // Remote, so the defaults apply: it waits for the typing to stop and for two characters.
    expect(find().debounceMs).toBeUndefined()
    expect(find().minQueryLength).toBeUndefined()
  })

  it('asks about the captured project and badges each row with its type', async () => {
    mocks.search.mockResolvedValue([memory(), memory({ id: 'm2', name: 'rtk-grep', type: 'fix', description: 're-run through rtk proxy' })])
    expect(await find().query('grep', context(), signal())).toEqual([
      { id: 'm1', title: 'no-ponytail-comments', subtitle: 'strip the marker before committing', badge: 'convention', ref: 'no-ponytail-comments' },
      { id: 'm2', title: 'rtk-grep', subtitle: 're-run through rtk proxy', badge: 'fix', ref: 'rtk-grep' },
    ])
    expect(mocks.search).toHaveBeenCalledWith('grep', 'p-1')
  })

  it('keeps the frame open with the node’s own message', async () => {
    mocks.search.mockResolvedValue({ error: 'memory index is not built' })
    await expect(find().query('grep', context(), signal())).rejects.toThrow('memory index is not built')
  })

  it('reveals the picked memory by name, which is how the context section keys its rows', async () => {
    mocks.search.mockResolvedValue([memory()])
    const world = context()
    const rows = await find().query('pony', world, signal())
    expect(find().select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.openPane).toHaveBeenCalledWith('task-1', 'context', {
      kind: 'context:reveal', sectionId: 'memory', itemId: 'no-ponytail-comments',
    })
  })

  it('sends the proposals row to the Memory page, not into a task', () => {
    ;(at('memory.proposals.open') as { run: (c: CommandExecutionContext) => void }).run(context())
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('memory')
    expect(mocks.openPane).not.toHaveBeenCalled()
  })
})
