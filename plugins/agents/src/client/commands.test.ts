import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProviderDescriptor, AgentSession } from '@acorn/protocol/managedAgents.ts'
import type { CommandExecutionContext, ContributedCommand, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({
  search: vi.fn(), providers: vi.fn(), startSession: vi.fn(),
  setSelectedSource: vi.fn(), openManagedSession: vi.fn(), requestComposerFocus: vi.fn(),
}))
vi.mock('./sessions/managedClient', () => ({
  managedAgentApi: { search: mocks.search, providers: mocks.providers },
}))
vi.mock('./sessions/managedSelection', () => ({
  openManagedSession: mocks.openManagedSession,
  requestComposerFocus: mocks.requestComposerFocus,
}))
vi.mock('./sessions/managedStore', () => ({ managedAgentStore: { startSession: mocks.startSession } }))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  setSelectedSource: mocks.setSelectedSource,
}))

import { agentsCommands } from './commands'

// Agent Center and the managed-session search. What is pinned is the scope the search asks the node
// for, the node it asks, and that picking a row goes through the retained selection path rather than
// through a second one of this plugin's own.

const session = (over: Partial<AgentSession> = {}): AgentSession => ({
  id: 's1', taskId: 'task-1', providerId: 'claude-code', profileId: 'claude-code',
  kind: 'interactive', driverKind: 'acp', driverVersion: '1', providerSessionRef: null,
  controller: 'acorn', runtimeState: 'ready', attention: 'none', statusAuthority: 'protocol',
  title: 'Fix the rail', model: 'opus', config: {}, parentSessionId: null, parentTurnId: null,
  subagents: [], queuedTurns: 0, lastEventSeq: 0, lastReadSeq: 0, archivedAt: null, createdAt: 0, updatedAt: 0,
  ...over,
})

const provider = (over: Partial<AgentProviderDescriptor> = {}): AgentProviderDescriptor => ({
  id: 'claude-code', profileId: 'claude-code', label: 'Claude Code', glyph: 'brand:agents/claude',
  driverKind: 'acp', driverVersion: '1', installed: true, authenticated: true, statusAuthority: 'protocol',
  executableVersion: '1.2.3', capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [],
  ...over,
})

const context = (over: Partial<CommandExecutionContext> = {}): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId: 'task-1',
  paneId: null, surfaceId: null, ...over,
})
const signal = (): AbortSignal => new AbortController().signal

const at = (id: string): ContributedCommand => agentsCommands.find((command) => command.id === id)!
const find = (): SearchCommand => at('agents.sessions.find') as SearchCommand
const start = (): SearchCommand => at('agents.sessions.new') as SearchCommand

describe('the agents plugin catalogue', () => {
  beforeEach(() => vi.clearAllMocks())

  it('is the rail source and two task-scoped searches, all gated on the plugin', () => {
    expect(agentsCommands.map((command) => command.id))
      .toEqual(['agents.sessions.new', 'source.agents.open', 'agents.sessions.find'])
    expect(start()).toMatchObject({ kind: 'search', scope: 'task', palette: true, requires: { plugin: 'agents' } })
    expect(at('source.agents.open')).toMatchObject({ palette: true, scope: 'none', requires: { plugin: 'agents' } })
    expect(find()).toMatchObject({ kind: 'search', scope: 'task', palette: true, requires: { plugin: 'agents' } })
    // Remote, so the defaults apply: it waits for the typing to stop and for two characters.
    expect(find().debounceMs).toBeUndefined()
    expect(find().minQueryLength).toBeUndefined()
  })

  it('opens the rail source rather than a pane', () => {
    ;(at('source.agents.open') as { run: (c: CommandExecutionContext) => void }).run(context())
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('agents')
  })

  it('asks the captured node about the captured task, and caps what it asks for', async () => {
    mocks.search.mockResolvedValue([session(), session({ id: 's2', title: '', attention: 'permission', model: null })])
    const world = context()
    const abort = signal()
    expect(await find().query('rail', world, abort)).toEqual([
      { id: 's1', title: 'Fix the rail', subtitle: 'claude-code · opus', taskId: 'task-1', ref: 's1' },
      // No title yet, so the provider names it; an attention reason becomes the badge.
      { id: 's2', title: 'claude-code', subtitle: 'claude-code', badge: 'permission', taskId: 'task-1', ref: 's2' },
    ])
    expect(mocks.search).toHaveBeenCalledWith('rail', { taskId: 'task-1', limit: 50 }, { nodeId: 'node-1', signal: abort })
  })

  it('opens the pick through the retained selection path', async () => {
    mocks.search.mockResolvedValue([session()])
    const world = context()
    const rows = await find().query('rail', world, signal())
    expect(find().select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.openManagedSession).toHaveBeenCalledWith('task-1', 's1')
  })

  it('acts on the task the row came from, not the one the palette happens to be over', async () => {
    // The row carries its own task, so a stale context cannot send the selection to the wrong pane.
    mocks.search.mockResolvedValue([session({ taskId: 'task-9' })])
    const world = context()
    const rows = await find().query('rail', world, signal())
    find().select(rows[0], world)
    expect(mocks.openManagedSession).toHaveBeenCalledWith('task-9', 's1')
  })

  it('offers the installed harnesses, filtered on this machine rather than per keystroke', async () => {
    mocks.providers.mockResolvedValue([
      provider(),
      provider({ id: 'codex', profileId: 'codex', label: 'Codex', glyph: undefined, executableVersion: undefined }),
      provider({ id: 'gone', profileId: 'gone', label: 'Uninstalled', installed: false }),
    ])
    // Loaded once when the frame opens and filtered here, so neither knob is set.
    expect(start().debounceMs).toBe(0)
    expect(start().minQueryLength).toBe(0)
    expect(await start().query('', context(), signal())).toEqual([
      { id: 'claude-code', title: 'Claude Code', subtitle: '1.2.3', icon: 'brand:agents/claude', ref: 'claude-code' },
      // No version reported, no mark of its own: both fall back rather than leaving the row half drawn.
      { id: 'codex', title: 'Codex', subtitle: 'Available', ref: 'codex' },
    ])
    expect(await start().query('codex', context(), signal())).toMatchObject([{ id: 'codex' }])
  })

  it('starts the session in the captured task and shows it', async () => {
    mocks.providers.mockResolvedValue([provider({ profileId: 'claude-code-fast' })])
    mocks.startSession.mockResolvedValue(session({ id: 'new-1' }))
    const world = context()
    const rows = await start().query('', world, signal())
    expect(await start().select(rows[0], world)).toEqual({ effect: 'close' })
    // The profile travels on the row, because the pick is all `select` is handed.
    expect(mocks.startSession).toHaveBeenCalledWith('task-1', { id: 'claude-code', profileId: 'claude-code-fast' })
    expect(mocks.openManagedSession).toHaveBeenCalledWith('task-1', 'new-1')
  })
})
