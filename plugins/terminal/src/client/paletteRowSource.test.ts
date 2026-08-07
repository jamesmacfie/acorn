import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaletteItem } from '@acorn/client-core/palette/model.ts'

const mocks = vi.hoisted(() => ({
  targets: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  status: vi.fn(),
  setTerminalOpen: vi.fn(),
  refreshSessions: vi.fn(),
  dispatchLayout: vi.fn(),
  setRecipeBrowserUrl: vi.fn(),
  invokeLayoutRecipe: vi.fn(),
}))
vi.mock('@acorn/client-core/tasks/runClient.ts', () => ({
  runApi: { targets: mocks.targets, start: mocks.start, stop: mocks.stop, status: mocks.status },
}))
vi.mock('@acorn/client-core/tasks/tasks.ts', () => ({
  setTerminalOpen: mocks.setTerminalOpen,
  dispatchLayout: mocks.dispatchLayout,
  setRecipeBrowserUrl: mocks.setRecipeBrowserUrl,
}))
vi.mock('@acorn/client-core/tasks/agentSessions.ts', () => ({ refreshSessions: mocks.refreshSessions }))
vi.mock('./recipes', () => ({ invokeLayoutRecipe: mocks.invokeLayoutRecipe }))

import { terminalPaletteRowSource as source } from './paletteRowSource'

const target = (id: string, running: boolean) => ({ id, command: `pnpm ${id}`, running })
const runRow = (id: string, running: boolean): PaletteItem => ({ kind: 'run', id: `run:${id}`, label: 'x', hint: 'y', running })

describe('terminal palette rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invokeLayoutRecipe.mockResolvedValue({ ok: true })
  })

  it('declares its place in the list and its desktop requirement', () => {
    // `order: 10` puts run/layout rows ahead of workflows' (20), which is the order the palette produced when it
    // built all three itself. `requires: 'terminal'` is why these rows are absent rather than failing under
    // dev:node, where there is no session engine.
    expect(source).toMatchObject({ id: 'terminal.run', order: 10, requires: 'terminal' })
  })

  it('maps targets and layouts into rows, carrying the running flag and config errors', async () => {
    mocks.targets.mockResolvedValue({
      targets: [target('dev', false), target('stack', true)],
      layouts: [{ id: 'review', panes: ['pr'] }],
      errors: [{ source: 'repo', message: 'run.bad is missing command' }],
    })
    const result = await source.rows('task-1')
    expect(result.rows).toEqual([
      { kind: 'run', id: 'run:dev', label: 'Run: dev', hint: 'pnpm dev', running: false },
      { kind: 'run', id: 'run:stack', label: 'Stop: stack', hint: 'pnpm stack', running: true },
      { kind: 'layout', id: 'layout:review', label: 'Layout: review', hint: 'open panes + start target' },
    ])
    // Errors ride alongside rather than as rows: the palette floats every source's errors to the top, which is a
    // property of the whole list and so cannot be a source's to place.
    expect(result.errors).toEqual([{ source: 'repo', message: 'run.bad is missing command' }])
  })

  it('offers nothing without a task, and nothing when the config read failed', async () => {
    expect(await source.rows(null)).toEqual({ rows: [] })
    expect(mocks.targets).not.toHaveBeenCalled()
    mocks.targets.mockResolvedValue({ error: 'repo config is untrusted' })
    expect(await source.rows('task-1')).toEqual({ rows: [] })
  })

  it('starts a target, opens the drawer, and refreshes the roster', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    await source.rows('task-1')
    await source.invoke(runRow('dev', false), 'task-1')
    expect(mocks.start).toHaveBeenCalledWith('task-1', 'dev')
    expect(mocks.setTerminalOpen).toHaveBeenCalledWith('task-1', true)
    expect(mocks.refreshSessions).toHaveBeenCalled()
    expect(mocks.stop).not.toHaveBeenCalled()
  })

  it('stops a running target without opening the drawer', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('stack', true)], layouts: [], errors: [] })
    await source.rows('task-1')
    await source.invoke(runRow('stack', true), 'task-1')
    expect(mocks.stop).toHaveBeenCalledWith('task-1', 'stack')
    expect(mocks.setTerminalOpen).not.toHaveBeenCalled()
  })

  // The bug the review found. The layout branch had this guard; the run branch had none.
  it('drops a run row left over from ANOTHER task instead of acting in the current one', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', true)], layouts: [{ id: 'review', panes: ['pr'] }], errors: [] })
    await source.rows('task-A')
    // The palette is still showing task-A's rows when task-B becomes the active task. Both kinds must be dropped.
    await source.invoke(runRow('dev', true), 'task-B')
    await source.invoke({ kind: 'layout', id: 'layout:review', label: 'x', hint: 'y' }, 'task-B')
    expect(mocks.stop).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.invokeLayoutRecipe).not.toHaveBeenCalled()

    // And once task-B's own rows are fetched, its target works — so this is a guard, not a general refusal.
    mocks.targets.mockResolvedValue({ targets: [target('dev', true)], layouts: [], errors: [] })
    await source.rows('task-B')
    await source.invoke(runRow('dev', true), 'task-B')
    expect(mocks.stop).toHaveBeenCalledWith('task-B', 'dev')
  })

  // The second half of the same defect: the row's `running` flag is as old as the last palette render, so it is
  // not the value to act on even within one task.
  it('trusts the fetched running state over the stale flag on the row', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', true)], layouts: [], errors: [] })
    await source.rows('task-1')
    // The row says "not running" (it was rendered before the target started); the fetch says it is running.
    await source.invoke(runRow('dev', false), 'task-1')
    expect(mocks.stop).toHaveBeenCalledWith('task-1', 'dev')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('drops a run row naming a target this task does not have', async () => {
    mocks.targets.mockResolvedValue({ targets: [target('dev', false)], layouts: [], errors: [] })
    await source.rows('task-1')
    await source.invoke(runRow('gone', false), 'task-1')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('runs a layout recipe through the executor and surfaces its failure reason', async () => {
    mocks.targets.mockResolvedValue({ targets: [], layouts: [{ id: 'review', panes: ['pr', 'changes'] }], errors: [] })
    await source.rows('task-1')
    const pick: PaletteItem = { kind: 'layout', id: 'layout:review', label: 'x', hint: 'y' }
    expect(await source.invoke(pick, 'task-1')).toBeUndefined()
    expect(mocks.invokeLayoutRecipe).toHaveBeenCalledWith('task-1', { id: 'review', panes: ['pr', 'changes'] }, expect.any(Object))

    mocks.invokeLayoutRecipe.mockResolvedValue({ ok: false, reason: 'unknown pane' })
    expect(await source.invoke(pick, 'task-1')).toEqual({ error: 'unknown pane' })
  })
})
