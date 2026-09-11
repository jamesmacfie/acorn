import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommandSearchItem } from '@acorn/protocol/commands.ts'
import type { CommandExecutionContext, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({
  targets: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  setTerminalOpen: vi.fn(),
  refreshSessions: vi.fn(),
  dispatchLayout: vi.fn(),
  previewRecipeSelection: { set: vi.fn() },
  invokeLayoutRecipe: vi.fn(),
  sessions: vi.fn(),
  rememberActiveTerminal: vi.fn(),
  requestTerminalFocus: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  runApi: { targets: mocks.targets, start: mocks.start, stop: mocks.stop, status: mocks.status },
  setTerminalOpen: mocks.setTerminalOpen,
  dispatchLayout: mocks.dispatchLayout,
  clientCapability: vi.fn(() => mocks.previewRecipeSelection),
  refreshSessions: mocks.refreshSessions,
  sessions: mocks.sessions,
  rememberActiveTerminal: mocks.rememberActiveTerminal,
  requestTerminalFocus: mocks.requestTerminalFocus,
}))
vi.mock('./recipes', () => ({ invokeLayoutRecipe: mocks.invokeLayoutRecipe }))

import { terminalCommands, TERMINAL_GROUP } from './commands'

// The three searches that replaced this plugin's `paletteRows` source on 2026-09-03. What is pinned is
// what the old source's tests pinned — the run/stop decision, the guards that kept one task's row from
// acting in another, and the error a failed layout reports — plus the two things the migration adds: a
// failed configuration read is now a message rather than an empty list, and one frame is one fetch.

const search = (id: string): SearchCommand => terminalCommands.find((command) => command.id === id) as SearchCommand

const context = (taskId: string): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId, paneId: null, surfaceId: null,
})

const signal = (): AbortSignal => new AbortController().signal
const target = (id: string, running: boolean) => ({ id, command: `pnpm ${id}`, running })
const ids = (items: readonly CommandSearchItem[]): string[] => items.map((item) => item.id)

describe('the terminal plugin catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invokeLayoutRecipe.mockResolvedValue({ ok: true })
    mocks.sessions.mockReturnValue([])
    mocks.start.mockResolvedValue({ ok: true })
    mocks.stop.mockResolvedValue({ ok: true })
  })

  it('hangs three task-scoped searches under its own group, never core’s', () => {
    // `terminal.run`, not `core.terminal`: the drawer and the plain shell belong to the shell, and a
    // plugin may not name another owner's group as its parent (graph.ts § cross-owner-parent).
    expect(terminalCommands.map((command) => command.id)).toEqual([
      TERMINAL_GROUP, 'terminal.run.targets', 'terminal.run.layouts', 'terminal.run.sessions',
    ])
    for (const command of terminalCommands) {
      expect(command.scope, command.id).toBe('task')
      expect(command.requires, command.id).toEqual({ plugin: 'terminal' })
      expect(command.palette, command.id).toBe(true)
    }
    expect(terminalCommands.slice(1).every((command) => command.parentId === TERMINAL_GROUP)).toBe(true)
    // Load-once, so entering a frame costs one request whatever gets typed afterwards.
    for (const id of ['terminal.run.targets', 'terminal.run.layouts', 'terminal.run.sessions']) {
      expect(search(id).debounceMs, id).toBe(0)
      expect(search(id).minQueryLength, id).toBe(0)
    }
  })

  it('maps targets into run/stop rows, carries the command line and floats config errors first', async () => {
    mocks.targets.mockResolvedValue({
      targets: [target('dev', false), target('stack', true)],
      layouts: [{ id: 'review', panes: ['pr'] }],
      errors: [{ source: 'repo', message: 'run.bad is missing command' }],
    })
    const rows = await search('terminal.run.targets').query('', context('task-1'), signal())
    expect(rows).toEqual([
      { id: 'problem:0', title: 'repo: run.bad is missing command', badge: 'error' },
      { id: 'target:dev', title: 'Run: dev', subtitle: 'pnpm dev', ref: 'dev' },
      { id: 'target:stack', title: 'Stop: stack', subtitle: 'pnpm stack', badge: 'running', ref: 'stack' },
    ])
  })

  it('asks the node once per frame, however much is typed', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [{ id: 'review', panes: ['pr'] }], errors: [] })
    const world = context('task-1')
    const targets = search('terminal.run.targets')
    expect(ids(await targets.query('', world, signal()))).toEqual(['target:dev'])
    expect(ids(await targets.query('de', world, signal()))).toEqual(['target:dev'])
    // The layout frame reads the same fetch: one `targets` call answers both.
    expect(ids(await search('terminal.run.layouts').query('', world, signal()))).toEqual(['layout:review'])
    expect(mocks.targets).toHaveBeenCalledTimes(1)
  })

  it('says why the list is empty when the configuration read failed', async () => {
    mocks.targets.mockResolvedValue({ error: 'repo config is untrusted' })
    // The old source answered with no rows here, so a reader saw an empty list and no reason for it.
    await expect(search('terminal.run.targets').query('', context('task-1'), signal())).rejects.toThrow('repo config is untrusted')
    // Not cached: pressing Enter on the failure asks again.
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    expect(ids(await search('terminal.run.targets').query('', context('task-1'), signal()))).toEqual(['target:dev'])
  })

  it('starts a target, opens the drawer and refreshes the roster', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    const world = context('task-1')
    const rows = await search('terminal.run.targets').query('', world, signal())
    expect(await search('terminal.run.targets').select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.start).toHaveBeenCalledWith('task-1', 'dev')
    expect(mocks.setTerminalOpen).toHaveBeenCalledWith('task-1', true)
    expect(mocks.refreshSessions).toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('stops a running target without opening the drawer', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('stack', true)], layouts: [], errors: [] })
    const world = context('task-1')
    const rows = await search('terminal.run.targets').query('', world, signal())
    await search('terminal.run.targets').select(rows[0], world)
    expect(mocks.stop).toHaveBeenCalledWith('task-1', 'stack')
    expect(mocks.setTerminalOpen).not.toHaveBeenCalled()
  })

  // The second half of the defect the old source's guard was written for: the row's label is as old as
  // the last time the frame drew, so it is not what the decision is made on.
  it('trusts this session’s fetch over the label the row was drawn with', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    const world = context('task-1')
    const rows = await search('terminal.run.targets').query('', world, signal())
    expect(rows[0].title).toBe('Run: dev')
    // The target started from the drawer since the frame drew. A second session over the same task is a
    // second context, so it fetches again and gets the truth.
    mocks.targets.mockResolvedValue({ targets: [target('dev', true)], layouts: [], errors: [] })
    const later = context('task-1')
    const fresh = await search('terminal.run.targets').query('', later, signal())
    await search('terminal.run.targets').select(fresh[0], later)
    expect(mocks.stop).toHaveBeenCalledWith('task-1', 'dev')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('refuses a row naming a target this task no longer has', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    const world = context('task-1')
    await search('terminal.run.targets').query('', world, signal())
    await expect(search('terminal.run.targets').select({ id: 'target:gone', title: 'x', ref: 'gone' }, world))
      .rejects.toThrow('no longer a target')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('reports a start that the node refused', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    mocks.start.mockResolvedValue({ ok: false, reason: 'port 4317 is in use' })
    const world = context('task-1')
    const rows = await search('terminal.run.targets').query('', world, signal())
    await expect(search('terminal.run.targets').select(rows[0], world)).rejects.toThrow('port 4317 is in use')
  })

  it('restates a config problem and keeps the frame open, since there is nothing to run', async () => {
    mocks.targets.mockResolvedValue({ targets: [], layouts: [], errors: [{ source: 'repo', message: 'cycle: a → b → a' }] })
    const world = context('task-1')
    const rows = await search('terminal.run.targets').query('', world, signal())
    expect(await search('terminal.run.targets').select(rows[0], world))
      .toEqual({ effect: 'stay', status: 'repo: cycle: a → b → a' })
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('runs a layout recipe through the executor and surfaces its failure reason', async () => {
    mocks.targets.mockResolvedValue({ targets: [], layouts: [{ id: 'review', panes: ['pr', 'changes'] }], errors: [] })
    const world = context('task-1')
    const layouts = search('terminal.run.layouts')
    const rows = await layouts.query('', world, signal())
    expect(rows).toEqual([{ id: 'layout:review', title: 'review', subtitle: 'open panes + start target', ref: 'review' }])
    expect(await layouts.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.invokeLayoutRecipe).toHaveBeenCalledWith('task-1', { id: 'review', panes: ['pr', 'changes'] }, expect.any(Object))

    mocks.invokeLayoutRecipe.mockResolvedValue({ ok: false, reason: 'unknown pane' })
    await expect(layouts.select(rows[0], world)).rejects.toThrow('unknown pane')
  })

  it('lists this task’s sessions off the roster signal and focuses the picked one', async () => {
    mocks.sessions.mockReturnValue([
      { id: 's1', taskId: 'task-1', title: 'zsh', command: '/bin/zsh', status: 'running' },
      { id: 's2', taskId: 'task-2', title: 'other', command: '/bin/zsh', status: 'running' },
      { id: 's3', taskId: 'task-1', title: 'dev', command: 'pnpm dev', status: 'exited' },
    ])
    const world = context('task-1')
    const found = search('terminal.run.sessions')
    const rows = await found.query('', world, signal())
    expect(rows).toEqual([
      { id: 's1', title: 'zsh', subtitle: '/bin/zsh', ref: 's1' },
      { id: 's3', title: 'dev', subtitle: 'pnpm dev', badge: 'exited', ref: 's3' },
    ])
    expect(found.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.setTerminalOpen).toHaveBeenCalledWith('task-1', true)
    expect(mocks.rememberActiveTerminal).toHaveBeenCalledWith('task-1', 's1')
    expect(mocks.requestTerminalFocus).toHaveBeenCalledWith('task-1', 's1')
    // No request at all: the roster is a signal this window already keeps.
    expect(mocks.targets).not.toHaveBeenCalled()
  })
})
