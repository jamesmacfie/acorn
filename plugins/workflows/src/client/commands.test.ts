import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowDefSummary } from '@acorn/protocol/workflow.ts'
import type { CommandExecutionContext, CommandOutcome, SearchCommand } from '@acorn/plugin-api/client'

const mocks = vi.hoisted(() => ({
  defs: vi.fn(), start: vi.fn(), createDef: vi.fn(), runs: vi.fn(),
  requestStart: vi.fn(), setSelectedSource: vi.fn(), openPane: vi.fn(),
}))
vi.mock('./workflowsClient', () => ({
  workflowApi: { defs: mocks.defs, start: mocks.start, createDef: mocks.createDef, runs: mocks.runs },
}))
// The real `needsStartDialog` is kept: it is the rule this row asks before it starts, and a stubbed
// one would let the row and the dialog disagree without the suite noticing.
vi.mock('./editor/startRequest', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requestWorkflowStart: mocks.requestStart,
}))
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setSelectedSource: mocks.setSelectedSource,
  openPane: mocks.openPane,
}))

import { workflowsCommands } from './commands'

// The search that replaced this plugin's `paletteRows` source on 2026-09-03. Start semantics are
// untouched: the whole definition goes to `start`, and an error comes back as the frame's message
// rather than as a closed palette.

const run = workflowsCommands[0] as SearchCommand
const find = workflowsCommands[1] as SearchCommand
const create = workflowsCommands[2] as { run: (context: CommandExecutionContext) => Promise<CommandOutcome> }

const navigate = vi.fn()
const context = (taskId: string): CommandExecutionContext => ({
  host: 'desktop', nodeId: 'node-1', workspaceId: 'w-1', projectId: 'p-1', taskId, paneId: null, surfaceId: null, navigate,
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

  it('is a task-scoped search and a project-scoped action, both gated on a node that runs terminals', () => {
    // `{ plugin: 'terminal' }` because the runner is a node engine: the routes 503 without one. The gate
    // the row source declared, unchanged.
    expect(workflowsCommands.map((command) => command.id)).toEqual(['workflows.run', 'workflows.runs.find', 'workflows.new'])
    expect(create).toMatchObject({ scope: 'project', category: 'action', requires: { plugin: 'terminal' } })
    expect(run).toMatchObject({ kind: 'search', scope: 'task', palette: true, requires: { plugin: 'terminal' } })
    expect(run.debounceMs).toBe(0)
    expect(run.minQueryLength).toBe(0)
  })

  // "Find a run" waited for somewhere to open one (docs/workflows.md § The run pane).
  it('lists this task\'s runs and opens the one that was picked', async () => {
    mocks.runs.mockResolvedValue([
      { id: 'run-2', name: 'Investigate an issue', status: 'running', createdAt: Date.now() },
    ])
    const rows = await find.query('', context('task-1'), signal())
    expect(rows[0]).toMatchObject({ id: 'run:run-2', title: 'Investigate an issue', ref: 'run-2' })
    expect(await find.select?.(rows[0], context('task-1'))).toEqual({ effect: 'close' })
    expect(mocks.openPane).toHaveBeenCalledWith('task-1', 'workflows', { kind: 'workflows:show-run', runId: 'run-2' })
  })

  it('maps definitions into rows with a step count, and floats config errors first', async () => {
    mocks.defs.mockResolvedValue({
      workflows: [def('ship', 3), def('review', 1)],
      errors: [{ source: 'repo', message: 'cycle: a → b → a' }],
    })
    expect(await run.query('', context('task-1'), signal())).toEqual([
      { id: 'problem:0', title: 'repo: cycle: a → b → a', badge: 'error' },
      { id: 'workflow:ship', title: 'SHIP', subtitle: '3 steps · repo', ref: 'ship' },
      { id: 'workflow:review', title: 'REVIEW', subtitle: '1 steps · repo', ref: 'review' },
    ])
  })

  it('asks the node once per frame, however much is typed', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship')], errors: [] })
    const world = context('task-1')
    await run.query('', world, signal())
    await run.query('shi', world, signal())
    expect(mocks.defs).toHaveBeenCalledTimes(1)
  })

  // By id, not by definition: the node resolves it, and for a committed file that is what makes the
  // repo trust snapshot apply to the bytes on disk rather than to whatever the request carried.
  it('starts the picked definition by its layered id', async () => {
    mocks.defs.mockResolvedValue({ workflows: [def('ship'), { ...def('mine'), source: 'database' }], errors: [] })
    const world = context('task-1')
    const rows = await run.query('', world, signal())
    expect(await run.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.start).toHaveBeenCalledWith('task-1', { defId: 'repo:ship' })
    // A row is addressed by its own id, because it belongs to no layer.
    await run.select(rows[1], world)
    expect(mocks.start).toHaveBeenLastCalledWith('task-1', { defId: 'mine' })
  })

  // A definition that asks for something opens the dialog instead of starting a run with an empty
  // required input (./editor/StartDialog.tsx).
  it('opens the start dialog for a definition whose required input has no value yet', async () => {
    const inputs = [{ name: 'issue', required: true }]
    mocks.defs.mockResolvedValue({ workflows: [{ ...def('ship'), inputs }], errors: [] })
    const world = context('task-1')
    const rows = await run.query('', world, signal())
    expect(await run.select(rows[0], world)).toEqual({ effect: 'close' })
    expect(mocks.requestStart).toHaveBeenCalledWith({
      defId: 'repo:ship', name: 'SHIP', inputs, taskId: 'task-1', projectId: 'p-1',
    })
    // The rail goes to Workflows, because that is the one place the dialog is mounted.
    expect(mocks.setSelectedSource).toHaveBeenCalledWith('workflows')
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('creates a row and opens it, for "New workflow"', async () => {
    mocks.createDef.mockResolvedValue({ id: 'row-1' })
    expect(await create.run(context('task-1'))).toEqual({ effect: 'close' })
    expect(mocks.createDef).toHaveBeenCalledWith({ workspaceId: 'w-1', projectId: 'p-1', def: { name: 'Untitled workflow', steps: [] } })
    expect(navigate).toHaveBeenCalledWith('/p/p-1/x/workflows/db%3Arow-1')
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
