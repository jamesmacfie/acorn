import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoteSummary } from '@acorn/protocol/notes.ts'
import type { CommandExecutionContext, ContributedCommand, InputCommand, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), openPane: vi.fn() }))
vi.mock('./notesClient', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, notesApi: () => ({ list: mocks.list, create: mocks.create }) }
})
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  openPane: mocks.openPane,
}))

import { notesCommands } from './commands'

// Finding a note across the three scopes, and starting one. The property worth a test of its own is
// the id: a slug is unique inside a scope and nowhere else, so `task:deploy` and `global:deploy` have
// to be two rows or one of them becomes unreachable.

const note = (slug: string, over: Partial<NoteSummary> = {}): NoteSummary => ({
  slug, title: slug, author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 0, ...over,
})

const context = (over: Partial<CommandExecutionContext> = {}): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId: 'task-1',
  paneId: null, surfaceId: null, ...over,
})
const signal = (): AbortSignal => new AbortController().signal

const at = (id: string): ContributedCommand => notesCommands.find((command) => command.id === id)!
const find = (): SearchCommand => at('notes.find') as SearchCommand
const create = (): InputCommand => at('notes.create') as InputCommand

describe('the notes plugin catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockImplementation((location: { scope: string }) =>
      Promise.resolve(location.scope === 'task' ? [note('deploy'), note('seed', { author: 'workflow' })]
        : location.scope === 'workspace' ? [note('standards', { kind: 'plan' })]
        : [note('deploy')]))
  })

  it('is a search and an input, both task-scoped and gated on the plugin', () => {
    expect(notesCommands.map((command) => command.id)).toEqual(['notes.find', 'notes.create'])
    for (const command of notesCommands) {
      expect(command.scope, command.id).toBe('task')
      expect(command.requires, command.id).toEqual({ plugin: 'notes' })
      expect(command.palette, command.id).toBe(true)
    }
    expect(find().debounceMs).toBe(0)
  })

  it('combines the three lists under ids that cannot collide across scopes', async () => {
    expect(await find().query('', context(), signal())).toEqual([
      { id: 'task:deploy', title: 'deploy', subtitle: 'task', ref: 'deploy' },
      { id: 'workspace:standards', title: 'standards', subtitle: 'workspace · plan', ref: 'standards' },
      // Same slug, different scope, different row — and both are reachable.
      { id: 'global:deploy', title: 'deploy', subtitle: 'global', ref: 'deploy' },
    ])
  })

  it('reads each scope once per frame and skips one the session cannot address', async () => {
    const world = context({ workspaceId: null })
    await find().query('', world, signal())
    await find().query('dep', world, signal())
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.list.mock.calls.map((call) => (call[0] as { scope: string }).scope)).toEqual(['task', 'global'])
  })

  it('says why a scope is missing rather than leaving a gap', async () => {
    mocks.list.mockImplementation((location: { scope: string }) =>
      Promise.resolve(location.scope === 'workspace' ? { error: 'device credential required' } : []))
    const rows = await find().query('', context(), signal())
    expect(rows).toEqual([{ id: 'problem:workspace', title: 'workspace notes: device credential required', badge: 'error' }])
    // Enter on it restates the message rather than opening nothing.
    expect(find().select(rows[0], context())).toEqual({ effect: 'stay', status: 'workspace notes: device credential required' })
  })

  it('opens the pick through the retained notes intent, in its own scope', async () => {
    const world = context()
    const rows = await find().query('', world, signal())
    expect(find().select(rows[2], world)).toEqual({ effect: 'close' })
    expect(mocks.openPane).toHaveBeenCalledWith('task-1', 'notes', { kind: 'notes:open', slug: 'deploy', scope: 'global' })
  })

  it('creates a task note from a title and opens what the node named it', async () => {
    mocks.create.mockResolvedValue({ slug: 'ship-it-2' })
    expect(await create().submit('Ship it', context(), signal())).toEqual({ effect: 'close' })
    // No kind and no slug: the node owns the default kind and the collision rule.
    expect(mocks.create).toHaveBeenCalledWith({ scope: 'task', taskId: 'task-1' }, 'Ship it')
    expect(mocks.openPane).toHaveBeenCalledWith('task-1', 'notes', { kind: 'notes:open', slug: 'ship-it-2', scope: 'task' })
  })

  it('keeps the typed title when the node refuses', async () => {
    mocks.create.mockResolvedValue({ error: 'notes are unavailable on this node' })
    await expect(create().submit('Ship it', context(), signal())).rejects.toThrow('notes are unavailable')
    expect(mocks.openPane).not.toHaveBeenCalled()
  })
})
