import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDefSummary } from '@acorn/protocol/workflow.ts'
import type { CommandExecutionContext, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({ defs: vi.fn(), start: vi.fn() }))
vi.mock('./workflowsClient', () => ({ workflowApi: { defs: mocks.defs, start: mocks.start } }))

import { workflowsCommands } from './commands'

// The search that replaced this plugin's `paletteRows` source on 2026-09-03. Start semantics are
// untouched: the whole definition goes to `start`, and an error comes back as the frame's message
// rather than as a closed palette.

const run = workflowsCommands[0] as SearchCommand

const context = (taskId: string): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId, paneId: null, surfaceId: null,
})
const signal = (): AbortSignal => new AbortController().signal

const def = (id: string, steps = 2): WorkflowDefSummary => ({
  id,
  name: id.toUpperCase(),
  source: 'repo',
  steps: Array.from({ length: steps }, (_, i) => ({ name: `step-${i}` })),
})

describe('the workflows plugin catalogue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.start.mockResolvedValue({})
  })

  it('is one task-scoped search, gated on a node that runs terminals', () => {
    // `{ plugin: 'terminal' }` because the runner is a node engine: the routes 503 without one. The gate
    // the row source declared, unchanged.
    expect(workflowsCommands.map((command) => command.id)).toEqual(['workflows.run'])
    expect(run).toMatchObject({ kind: 'search', scope: 'task', palette: true, requires: { plugin: 'terminal' } })
    expect(run.debounceMs).toBe(0)
    expect(run.minQueryLength).toBe(0)
  })

  it('maps definitions into rows with a step count, and floats config errors first', async () => {
    mocks.defs.mockResolvedValue({
      workflows: [def('ship', 3), def('review', 1)],
      errors: [{ source: 'repo', message: 'cycle: a → b → a' }],
    })
    expect(await run.query('', context('task-1'), signal())).toEqual([
      { id: 'problem:0', title: 'repo: cycle: a → b → a', badge: 'error' },
      { id: 'workflow:ship', title: 'SHIP', subtitle: '3 steps', ref: 'ship' },
      { id: 'workflow:review', title: 'REVIEW', subtitle: '1 steps', ref: 'review' },
    ])
  })

  it('asks the node once per frame, however much is typed', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    const world = context('task-1')
    await run.query('', world, signal())
    await run.query('shi', world, signal())
    expect(mocks.defs).toHaveBeenCalledTimes(1)
  })

  it('starts the picked definition, passing the whole thing rather than re-fetching', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    const world = context('task-1')
    const rows = await run.query('', world, signal())
    expect(await run.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.start).toHaveBeenCalledWith('task-1', def('ship'))
  })

  it('keeps the frame open with the node’s own refusal', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    mocks.start.mockResolvedValue({ error: 'repo configuration needs review' })
    const world = context('task-1')
    const rows = await run.query('', world, signal())
    await expect(run.select(rows[0], world)).rejects.toThrow('repo configuration needs review')
  })

  it('refuses a row naming a definition this task no longer has, and restates a config problem', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [{ source: 'repo', message: 'bad step' }] })
    const world = context('task-1')
    const rows = await run.query('', world, signal())
    await expect(run.select({ id: 'workflow:gone', title: 'x', ref: 'gone' }, world)).rejects.toThrow('no longer a workflow')
    expect(await run.select(rows[0], world)).toEqual({ effect: 'stay', status: 'repo: bad step' })
    expect(mocks.start).not.toHaveBeenCalled()
  })
})
